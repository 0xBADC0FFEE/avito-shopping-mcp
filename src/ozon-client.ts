import type { RuntimeConfig } from "./config.js";
import { OzonMcpError } from "./errors.js";
import { parseProduct, parseReviews, parseSearch } from "./parsers.js";
import { OzonBrowserSession } from "./browser-session.js";
import type { ProductDetails, ReviewsResult, SearchResult } from "./types.js";

export type SearchSort = "popular" | "price" | "price_desc" | "rating" | "new" | "discount";

export interface SearchInput {
  query: string;
  sort?: SearchSort;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  limit?: number | undefined;
}

const SORT_VALUES: Record<SearchSort, string | undefined> = {
  popular: undefined,
  price: "price",
  price_desc: "price_desc",
  rating: "rating",
  new: "new",
  discount: "discount",
};

export function normalizeProductPath(product: string): string {
  const value = product.trim();
  if (!value) throw new OzonMcpError("INVALID_PRODUCT", "Product must be an Ozon URL, SKU, or slug.");
  if (value.length > 2_048) throw new OzonMcpError("INVALID_PRODUCT", "Product value is too long.");

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new OzonMcpError("INVALID_PRODUCT", "Product URL is invalid.", { cause: error });
    }
    if (url.protocol !== "https:" || (url.hostname !== "ozon.ru" && url.hostname !== "www.ozon.ru")) {
      throw new OzonMcpError("INVALID_PRODUCT", "Only HTTPS product URLs on ozon.ru are accepted.");
    }
    let productPath: string;
    try {
      productPath = decodeURIComponent(url.pathname);
    } catch (error) {
      throw new OzonMcpError("INVALID_PRODUCT", "Product URL contains invalid encoding.", { cause: error });
    }
    if (!/^\/product\/[\p{L}\p{N}_-]+\/?$/u.test(productPath)) {
      throw new OzonMcpError("INVALID_PRODUCT", "The URL is not an Ozon product page.");
    }
    return `${productPath.replace(/\/+$/, "")}/`;
  }

  if (/^\d{6,}$/.test(value)) return `/product/${value}/`;
  const normalized = value.replace(/^\/+|\/+$/g, "").replace(/^product\//, "");
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new OzonMcpError("INVALID_PRODUCT", "Product slug contains unsupported characters.");
  }
  return `/product/${normalized}/`;
}

export function buildSearchPath(input: SearchInput): string {
  const query = input.query.trim();
  if (!query) throw new OzonMcpError("REQUEST_FAILED", "Search query cannot be empty.");
  if (query.length > 200) throw new OzonMcpError("REQUEST_FAILED", "Search query is too long.");
  if (input.priceMin !== undefined && input.priceMax !== undefined && input.priceMin > input.priceMax) {
    throw new OzonMcpError("REQUEST_FAILED", "priceMin cannot be greater than priceMax.");
  }

  const params = new URLSearchParams({ text: query, from_global: "true" });
  const sort = input.sort ?? "popular";
  const sorting = SORT_VALUES[sort];
  if (sorting) params.set("sorting", sorting);
  if (input.priceMin !== undefined || input.priceMax !== undefined) {
    params.set("currency_price", `${input.priceMin ?? 0}.000;${input.priceMax ?? 99_999_999}.000`);
  }
  return `/search/?${params.toString()}`;
}

export class OzonClient {
  private readonly session: OzonBrowserSession;

  constructor(private readonly config: RuntimeConfig) {
    this.session = new OzonBrowserSession(config);
  }

  setup(timeoutMs?: number, report?: (message: string) => void) {
    return this.session.setup(timeoutMs, report);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const limit = input.limit ?? 12;
    const page = await this.session.requestJson(buildSearchPath(input));
    const items = parseSearch(page, limit);
    return {
      query: input.query.trim(),
      sort: input.sort ?? "popular",
      count: items.length,
      items,
      pricingContext: "Prices and availability reflect the location and session selected by Ozon.",
    };
  }

  async product(product: string): Promise<ProductDetails> {
    const page = await this.session.requestJson(normalizeProductPath(product));
    return parseProduct(page);
  }

  async reviews(product: string, limit = 10): Promise<ReviewsResult> {
    const path = normalizeProductPath(product);
    const page = await this.session.requestJson(`${path}reviews/`);
    return parseReviews(page, limit);
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
}
