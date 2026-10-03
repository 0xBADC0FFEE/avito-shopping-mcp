import { WbBrowserSession } from "./browser-session.js";
import type { RuntimeConfig } from "./config.js";
import { WbMcpError } from "./errors.js";
import { parseBasketRoutes, parseCatalogProducts, parseFeedbackHost, parseProductCard, parseReviews } from "./parsers.js";
import type { CatalogProduct } from "./parsers.js";
import type { ProductDetails, ReviewsResult, SearchItem, SearchResult } from "./types.js";
import {
  BASKET_ROUTES_URL,
  feedbackHostApiUrl,
  feedbacksUrl,
  productApiUrl,
  productCardUrl,
  productImageUrls,
  productPageUrl,
  searchApiUrl,
  searchImageUrl,
  sellerPageUrl,
} from "./wb-api.js";
import type { BasketRoute } from "./wb-api.js";

export type SearchSort = "popular" | "price" | "price_desc" | "rating" | "new";

export interface SearchInput {
  query: string;
  sort?: SearchSort;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  limit?: number | undefined;
}

const SORT_VALUES: Record<SearchSort, string> = {
  popular: "popular",
  price: "priceup",
  price_desc: "pricedown",
  rating: "rate",
  new: "newly",
};

const MAX_QUERY_LENGTH = 200;
const UNBOUNDED_PRICE_RUB = 99_999_999;
const KOPECKS_PER_RUBLE = 100;
const MAX_PRODUCT_IMAGES = 10;
const BASKET_ROUTES_TTL_MS = 60 * 60_000;
const PRICING_CONTEXT = "Prices and availability reflect the delivery region stored in the Wildberries session.";

export function parseArticle(product: string): number {
  const value = product.trim();
  if (!value) throw new WbMcpError("INVALID_PRODUCT", "Product must be a Wildberries URL or article number.");
  if (value.length > 2_048) throw new WbMcpError("INVALID_PRODUCT", "Product value is too long.");

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new WbMcpError("INVALID_PRODUCT", "Product URL is invalid.", { cause: error });
    }
    if (url.protocol !== "https:" || (url.hostname !== "wildberries.ru" && url.hostname !== "www.wildberries.ru")) {
      throw new WbMcpError("INVALID_PRODUCT", "Only HTTPS product URLs on wildberries.ru are accepted.");
    }
    const article = url.pathname.match(/^\/catalog\/(\d+)\/detail\.aspx$/)?.[1];
    if (!article) throw new WbMcpError("INVALID_PRODUCT", "The URL is not a Wildberries product page.");
    return validArticle(article);
  }

  if (!/^\d+$/.test(value)) {
    throw new WbMcpError("INVALID_PRODUCT", "Product must be a Wildberries URL or article number.");
  }
  return validArticle(value);
}

export function buildSearchFilters(input: SearchInput): Record<string, string> {
  const query = input.query.trim();
  if (!query) throw new WbMcpError("REQUEST_FAILED", "Search query cannot be empty.");
  if (query.length > MAX_QUERY_LENGTH) throw new WbMcpError("REQUEST_FAILED", "Search query is too long.");
  if (input.priceMin !== undefined && input.priceMax !== undefined && input.priceMin > input.priceMax) {
    throw new WbMcpError("REQUEST_FAILED", "priceMin cannot be greater than priceMax.");
  }

  const filters: Record<string, string> = { query, sort: SORT_VALUES[input.sort ?? "popular"] };
  if (input.priceMin !== undefined || input.priceMax !== undefined) {
    const from = (input.priceMin ?? 0) * KOPECKS_PER_RUBLE;
    const to = (input.priceMax ?? UNBOUNDED_PRICE_RUB) * KOPECKS_PER_RUBLE;
    filters.priceU = `${from};${to}`;
  }
  return filters;
}

export class WbClient {
  private readonly session: WbBrowserSession;
  private cachedRoutes: { routes: BasketRoute[]; fetchedAt: number } | undefined;

  constructor(private readonly config: RuntimeConfig) {
    this.session = new WbBrowserSession(config);
  }

  setup(timeoutMs?: number, report?: (message: string) => void) {
    return this.session.setup(timeoutMs, report);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const limit = input.limit ?? 12;
    const filters = buildSearchFilters(input);
    const region = await this.session.regionQuery();
    const products = parseCatalogProducts(await this.session.requestJson(searchApiUrl(region, filters)));
    const routes = await this.basketRoutes();
    const items = products
      .flatMap((product) => (product.price === null ? [] : [searchItem(product, product.price, routes)]))
      .slice(0, limit);
    return {
      query: input.query.trim(),
      sort: input.sort ?? "popular",
      count: items.length,
      items,
      pricingContext: PRICING_CONTEXT,
    };
  }

  async product(product: string): Promise<ProductDetails> {
    const catalog = await this.catalogProduct(parseArticle(product));
    const routes = await this.basketRoutes();
    const cardUrl = productCardUrl(routes, catalog.article);
    if (!cardUrl) throw new WbMcpError("WB_RESPONSE_INVALID", "Wildberries has no media host for this product.");
    const card = parseProductCard(await this.session.requestJson(cardUrl));

    return {
      article: catalog.article,
      name: catalog.name,
      brand: catalog.brand,
      category: card.category,
      url: productPageUrl(catalog.article),
      price: catalog.price,
      oldPrice: catalog.oldPrice,
      available: catalog.stock > 0,
      rating: catalog.rating,
      reviewCount: catalog.reviewCount,
      seller: catalog.seller
        ? { name: catalog.seller.name, rating: catalog.seller.rating, url: sellerPageUrl(catalog.seller.id) }
        : null,
      images: productImageUrls(routes, catalog.article, Math.min(catalog.imageCount, MAX_PRODUCT_IMAGES)),
      characteristics: card.characteristics,
      description: card.description,
      pricingContext: PRICING_CONTEXT,
    };
  }

  async reviews(product: string, limit = 10): Promise<ReviewsResult> {
    const { rootId } = await this.catalogProduct(parseArticle(product));
    if (rootId === null) throw new WbMcpError("WB_RESPONSE_INVALID", "Wildberries returned a product without a card id.");
    const host = parseFeedbackHost(await this.session.requestJson(feedbackHostApiUrl(rootId)));
    if (!host) throw new WbMcpError("WB_RESPONSE_INVALID", "Wildberries returned no review host for this product.");
    return parseReviews(await this.session.requestJson(feedbacksUrl(host, rootId)), limit);
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

  private async catalogProduct(article: number): Promise<CatalogProduct> {
    const region = await this.session.regionQuery();
    const products = parseCatalogProducts(await this.session.requestJson(productApiUrl(region, article)));
    const product = products.find((candidate) => candidate.article === article);
    if (!product) throw new WbMcpError("PRODUCT_NOT_FOUND", `Wildberries has no product with article ${article}.`);
    return product;
  }

  private async basketRoutes(): Promise<BasketRoute[]> {
    if (this.cachedRoutes && Date.now() - this.cachedRoutes.fetchedAt < BASKET_ROUTES_TTL_MS) {
      return this.cachedRoutes.routes;
    }
    const routes = parseBasketRoutes(await this.session.requestJson(BASKET_ROUTES_URL));
    if (!routes.length) throw new WbMcpError("WB_RESPONSE_INVALID", "Wildberries returned no media hosts.");
    this.cachedRoutes = { routes, fetchedAt: Date.now() };
    return routes;
  }
}

function validArticle(digits: string): number {
  const article = Number(digits);
  if (!Number.isSafeInteger(article) || article <= 0) {
    throw new WbMcpError("INVALID_PRODUCT", "Article number is out of range.");
  }
  return article;
}

function searchItem(product: CatalogProduct, price: number, routes: BasketRoute[]): SearchItem {
  return {
    article: product.article,
    name: product.name,
    brand: product.brand,
    price,
    oldPrice: product.oldPrice,
    discountPercent: product.oldPrice ? Math.round((1 - price / product.oldPrice) * 100) : null,
    rating: product.rating,
    reviewCount: product.reviewCount,
    seller: product.seller?.name ?? null,
    url: productPageUrl(product.article),
    image: searchImageUrl(routes, product.article),
  };
}
