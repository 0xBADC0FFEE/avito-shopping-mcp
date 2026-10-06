import { apiUrl, itemPageUrl, locationsApiUrl, MOSCOW, searchApiUrl, sellerRatingsUrl } from "./avito-api.js";
import { AvitoBrowserSession } from "./browser-session.js";
import type { RuntimeConfig } from "./config.js";
import { AvitoMcpError } from "./errors.js";
import { parseItem, parseSellerUserKey, readBuyerItem } from "./item-page.js";
import { parseLocations, parseRatingsPage, parseSearchPage } from "./parsers.js";
import type { ItemDetails, Location, SearchResult, SearchSort, SellerReview, SellerReviewsResult } from "./types.js";

export interface SearchInput {
  query: string;
  location?: string | undefined;
  sort?: SearchSort | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

const MAX_QUERY_LENGTH = 200;
const MAX_ITEM_INPUT_LENGTH = 2_048;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_REVIEWS_LIMIT = 10;
const ITEM_HOSTS = new Set(["avito.ru", "www.avito.ru", "m.avito.ru"]);
const ITEM_PATH = /^\/(?:(\d+)|[^/]+\/[^/]+\/[^/]+_(\d+))\/?$/;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const ITEM_INPUT_HINT = "Item must be an avito.ru listing URL or a numeric listing id.";

export function parseItemId(input: string): number {
  const value = input.trim();
  if (!value) throw new AvitoMcpError("INVALID_ITEM", ITEM_INPUT_HINT);
  if (value.length > MAX_ITEM_INPUT_LENGTH) throw new AvitoMcpError("INVALID_ITEM", "Item value is too long.");
  if (/^\d+$/.test(value)) return validItemId(value);
  if (!/^https?:\/\//i.test(value)) throw new AvitoMcpError("INVALID_ITEM", ITEM_INPUT_HINT);

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AvitoMcpError("INVALID_ITEM", "Item URL is invalid.", { cause: error });
  }
  if (url.protocol !== "https:" || !ITEM_HOSTS.has(url.hostname)) {
    throw new AvitoMcpError("INVALID_ITEM", "Only HTTPS listing URLs on avito.ru are accepted.");
  }
  const match = url.pathname.match(ITEM_PATH);
  const id = match?.[1] ?? match?.[2];
  if (!id) throw new AvitoMcpError("INVALID_ITEM", "The URL is not an Avito listing page.");
  return validItemId(id);
}

export function validSearchQuery(input: SearchInput): string {
  const query = input.query.trim();
  if (!query) throw new AvitoMcpError("REQUEST_FAILED", "Search query cannot be empty.");
  if (query.length > MAX_QUERY_LENGTH) throw new AvitoMcpError("REQUEST_FAILED", "Search query is too long.");
  if (input.priceMin !== undefined && input.priceMax !== undefined && input.priceMin > input.priceMax) {
    throw new AvitoMcpError("REQUEST_FAILED", "priceMin cannot be greater than priceMax.");
  }
  return query;
}

export class AvitoClient {
  private readonly session: AvitoBrowserSession;
  private readonly locations = new Map<string, Location>([[locationKey(MOSCOW.name), MOSCOW]]);

  constructor(private readonly config: RuntimeConfig) {
    this.session = new AvitoBrowserSession(config);
  }

  setup(timeoutMs?: number, report?: (message: string) => void) {
    return this.session.setup(timeoutMs, report);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const query = validSearchQuery(input);
    const location = await this.resolveLocation(input.location ?? MOSCOW.name);
    const sort = input.sort ?? "default";
    const page = input.page ?? 1;
    const result = parseSearchPage(
      await this.session.requestJson(
        searchApiUrl({ query, locationId: location.id, sort, page, priceMin: input.priceMin, priceMax: input.priceMax }),
      ),
    );
    const items = result.items.slice(0, input.limit ?? DEFAULT_SEARCH_LIMIT);
    return { query, location, sort, page, totalCount: result.totalCount, count: items.length, items };
  }

  async item(item: string): Promise<ItemDetails> {
    const { buyerItem, url } = await this.loadBuyerItem(parseItemId(item));
    return parseItem(buyerItem, url);
  }

  async sellerReviews(item: string, limit = DEFAULT_REVIEWS_LIMIT): Promise<SellerReviewsResult> {
    const { buyerItem, url } = await this.loadBuyerItem(parseItemId(item));
    const listing = parseItem(buyerItem, url);
    let page = parseRatingsPage(await this.session.requestJson(sellerRatingsUrl(parseSellerUserKey(buyerItem))));
    const summary = page.summary;
    const reviews: SellerReview[] = [...page.reviews];
    while (reviews.length < limit && page.nextPage !== null && page.reviews.length > 0) {
      page = parseRatingsPage(await this.session.requestJson(apiUrl(page.nextPage)));
      reviews.push(...page.reviews);
    }
    const selected = reviews.slice(0, limit);
    return {
      listing: { id: listing.id, title: listing.title, url: listing.url },
      seller: listing.seller,
      rating: summary,
      count: selected.length,
      reviews: selected,
    };
  }

  async health(live = false) {
    const [stored, permissions] = await Promise.all([this.session.sessionInfo(), this.session.sessionMode()]);
    const liveResult = live ? await this.session.checkLive() : undefined;
    return {
      ok: stored.exists && (!liveResult || liveResult.ok),
      session: {
        exists: stored.exists,
        ...(stored.createdAt ? { createdAt: stored.createdAt } : {}),
        ...(stored.ageSeconds !== undefined ? { ageSeconds: stored.ageSeconds } : {}),
        permissions: permissions === null ? null : `0${permissions.toString(8)}`,
      },
      browserChannel: this.config.browserChannel,
      ...(liveResult ? { live: liveResult } : {}),
    };
  }

  shutdown() {
    return this.session.close();
  }

  private async resolveLocation(name: string): Promise<Location> {
    const key = locationKey(name);
    const cached = this.locations.get(key);
    if (cached) return cached;
    if (!CYRILLIC.test(key)) {
      throw new AvitoMcpError("LOCATION_NOT_FOUND", "Location must be a Russian city or region name, e.g. Казань.");
    }

    const candidates = parseLocations(await this.session.requestJson(locationsApiUrl(name.trim())));
    const location = candidates.find((candidate) => locationKey(candidate.name) === key) ?? candidates[0];
    if (!location) throw new AvitoMcpError("LOCATION_NOT_FOUND", `Avito knows no location named "${name.trim()}".`);
    this.locations.set(key, location);
    return location;
  }

  private async loadBuyerItem(id: number) {
    const page = await this.session.requestHtml(itemPageUrl(id));
    if (!page) throw new AvitoMcpError("ITEM_NOT_FOUND", `Avito has no listing with id ${id}.`);
    return { buyerItem: readBuyerItem(page.html), url: page.url };
  }
}

function locationKey(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU");
}

function validItemId(digits: string): number {
  const id = Number(digits);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AvitoMcpError("INVALID_ITEM", "Listing id is out of range.");
  }
  return id;
}
