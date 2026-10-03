import type { ProductReview, ReviewsResult } from "./types.js";
import { isAllowedApiUrl, isAllowedHost } from "./wb-api.js";
import type { BasketRoute } from "./wb-api.js";

type JsonObject = Record<string, unknown>;

const KOPECKS_PER_RUBLE = 100;

export interface CatalogSeller {
  id: number;
  name: string;
  rating: number | null;
}

export interface CatalogProduct {
  article: number;
  rootId: number | null;
  name: string | null;
  brand: string | null;
  price: number | null;
  oldPrice: number | null;
  stock: number;
  rating: number | null;
  reviewCount: number | null;
  seller: CatalogSeller | null;
  imageCount: number;
}

export interface ProductCardInfo {
  category: string | null;
  description: string | null;
  characteristics: Record<string, string>;
}

interface Offer {
  price: number;
  oldPrice: number | null;
}

export function parseCatalogProducts(response: unknown): CatalogProduct[] {
  return array(at(response, "products")).map(catalogProduct).filter(isPresent);
}

export function parseProductCard(card: unknown): ProductCardInfo {
  const characteristics: Record<string, string> = {};
  for (const option of array(at(card, "options"))) {
    const name = text(at(option, "name"));
    const value = text(at(option, "value"));
    if (name && value) characteristics[name] = value;
  }
  return {
    category: text(at(card, "subj_name")),
    description: text(at(card, "description")),
    characteristics,
  };
}

export function parseBasketRoutes(upstreams: unknown): BasketRoute[] {
  const rangeMap = array(at(upstreams, "origin", "mediabasket_route_map")).find((map) => at(map, "method") === "range");
  return array(at(rangeMap, "hosts")).flatMap((entry) => {
    const volFrom = integer(at(entry, "vol_range_from"));
    const volTo = integer(at(entry, "vol_range_to"));
    const host = text(at(entry, "host"));
    return volFrom !== null && volTo !== null && host && isAllowedHost(host) ? [{ volFrom, volTo, host }] : [];
  });
}

export function parseFeedbackHost(response: unknown): string | null {
  return array(response).map(text).find((host): host is string => host !== null && isAllowedApiUrl(host)) ?? null;
}

export function parseReviews(response: unknown, limit = 10): ReviewsResult {
  const reviews = array(at(response, "feedbacks"))
    .map(object)
    .filter(isPresent)
    .sort((left, right) => (text(right.createdDate) ?? "").localeCompare(text(left.createdDate) ?? ""))
    .slice(0, limit)
    .map(review);
  return {
    rating: decimal(at(response, "valuation")),
    totalReviews: integer(at(response, "feedbackCount")),
    count: reviews.length,
    reviews,
  };
}

function catalogProduct(value: unknown): CatalogProduct | null {
  const article = integer(at(value, "id"));
  if (article === null) return null;
  const offer = cheapestOffer(at(value, "sizes"));
  const reviewCount = integer(at(value, "feedbacks"));
  return {
    article,
    rootId: integer(at(value, "root")),
    name: text(at(value, "name")),
    brand: text(at(value, "brand")),
    price: offer?.price ?? null,
    oldPrice: offer?.oldPrice ?? null,
    stock: integer(at(value, "totalQuantity")) ?? 0,
    // Unrated products report a rating of 0.
    rating: reviewCount ? (decimal(at(value, "reviewRating")) ?? decimal(at(value, "rating"))) : null,
    reviewCount,
    seller: catalogSeller(value),
    imageCount: integer(at(value, "pics")) ?? 0,
  };
}

function catalogSeller(product: unknown): CatalogSeller | null {
  const id = integer(at(product, "supplierId"));
  const name = text(at(product, "supplier"));
  return id !== null && name ? { id, name, rating: decimal(at(product, "supplierRating")) } : null;
}

function cheapestOffer(sizes: unknown): Offer | null {
  let cheapest: Offer | null = null;
  for (const size of array(sizes)) {
    const price = rubles(at(size, "price", "product"));
    if (price === null || (cheapest && cheapest.price <= price)) continue;
    const basic = rubles(at(size, "price", "basic"));
    cheapest = { price, oldPrice: basic !== null && basic > price ? basic : null };
  }
  return cheapest;
}

function review(feedback: JsonObject): ProductReview {
  return {
    author: text(at(feedback, "wbUserDetails", "name")),
    score: decimal(feedback.productValuation),
    comment: text(feedback.text) ?? "",
    pros: text(feedback.pros) ?? "",
    cons: text(feedback.cons) ?? "",
    variant: text(feedback.color),
    date: text(feedback.createdDate)?.slice(0, "YYYY-MM-DD".length) ?? null,
    useful: integer(at(feedback, "votes", "pluses")),
    hasPhotos: array(feedback.photos).length > 0,
  };
}

function rubles(kopecks: unknown): number | null {
  return typeof kopecks === "number" && Number.isFinite(kopecks) ? Math.round(kopecks / KOPECKS_PER_RUBLE) : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function decimal(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    current = object(current)?.[key];
  }
  return current;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
