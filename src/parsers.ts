import type { ProductDetails, ProductReview, ReviewsResult, SearchItem } from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    const currentObject = object(current);
    if (!currentObject) return undefined;
    current = currentObject[key];
  }
  return current;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeWidget(value: unknown): JsonObject | null {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value)) ?? null;
    } catch {
      return null;
    }
  }
  return object(value) ?? null;
}

function widgets(page: unknown, wantedName: string): JsonObject[] {
  const states = object(at(page, "widgetStates"));
  if (!states) return [];

  const result: JsonObject[] = [];
  for (const [key, value] of Object.entries(states)) {
    if (key.split("-", 1)[0] !== wantedName) continue;
    const decoded = decodeWidget(value);
    if (decoded) result.push(decoded);
  }
  return result;
}

function firstWidget(page: unknown, ...names: string[]): JsonObject | null {
  for (const name of names) {
    const widget = widgets(page, name)[0];
    if (widget) return widget;
  }
  return null;
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

function parseDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/[+-]?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanOzonUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, "https://www.ozon.ru");
    if (url.hostname !== "ozon.ru" && !url.hostname.endsWith(".ozon.ru")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function skuFromUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const trailing = candidate.match(/-(\d{6,})\/?(?:[?#]|$)/);
  const fallback = candidate.match(/(?:^|\/)(\d{6,})(?:\/|$)/);
  return trailing?.[1] ?? fallback?.[1] ?? null;
}

function searchRating(mainState: unknown[]): { rating: number | null; reviewCount: number | null } {
  const ratingBlock = mainState.find((entry) => {
    const labels = at(entry, "labelListV2");
    return labels !== undefined && /star/i.test(JSON.stringify(labels));
  });
  const items = array(at(ratingBlock, "labelListV2", "items"));
  const labels = items.map((item) => text(at(item, "text", "text"))).filter((value): value is string => !!value);
  const ratingIndex = labels.findIndex((label) => {
    const value = parseDecimal(label);
    return value !== null && value >= 1 && value <= 5;
  });
  const rating = ratingIndex >= 0 ? parseDecimal(labels[ratingIndex]) : null;
  const explicitReviewLabel = labels.find((label) => /отзыв|оцен/i.test(label));
  const reviewCount =
    parseMoney(explicitReviewLabel) ??
    labels
      .slice(ratingIndex + 1)
      .map(parseMoney)
      .find((value) => value !== null && value >= 0) ??
    null;
  return { rating, reviewCount };
}

function parseSearchItem(value: unknown): SearchItem | null {
  const item = object(value);
  if (!item) return null;
  const mainState = array(item.mainState);
  const priceState = mainState.find((entry) => at(entry, "type") === "priceV2");
  const prices = array(at(priceState, "priceV2", "price"));
  const currentPrice = prices.find((entry) => at(entry, "textStyle") === "PRICE");
  const originalPrice = prices.find((entry) => at(entry, "textStyle") === "ORIGINAL_PRICE");
  const price = parseMoney(at(currentPrice, "text"));
  if (price === null) return null;

  const nameState = mainState.find((entry) => at(entry, "id") === "name");
  const url = cleanOzonUrl(at(item, "action", "link"));
  const sku = text(item.sku) ?? text(item.id) ?? skuFromUrl(url);
  if (!sku) return null;

  const oldPriceCandidate = parseMoney(at(originalPrice, "text"));
  const { rating, reviewCount } = searchRating(mainState);
  const imageItem = array(at(item, "tileImage", "items")).find((entry) => text(at(entry, "image", "link")));

  return {
    sku,
    name: text(at(nameState, "textDS", "text")),
    price,
    oldPrice: oldPriceCandidate !== null && oldPriceCandidate > price ? oldPriceCandidate : null,
    discount: text(at(priceState, "priceV2", "discount")),
    rating,
    reviewCount,
    url,
    image: text(at(imageItem, "image", "link")) ?? text(at(item, "tileImage", "coverImage")),
  };
}

export function parseSearch(page: unknown, limit = 12): SearchItem[] {
  const grids = widgets(page, "tileGridDesktop");
  const items = grids.flatMap((grid) => array(grid.items));
  return items.map(parseSearchItem).filter((item): item is SearchItem => item !== null).slice(0, limit);
}

function stringsIn(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") {
    result.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, result);
  } else {
    const valueObject = object(value);
    if (valueObject) {
      for (const child of Object.values(valueObject)) stringsIn(child, result);
    }
  }
  return result;
}

function parseScore(page: unknown): { rating: number | null; reviewCount: number | null } {
  const score = firstWidget(page, "webSingleProductScore", "webReviewProductScore");
  if (!score) return { rating: null, reviewCount: null };
  const directRating = parseDecimal(score.totalScore ?? score.rating);
  const directReviewCount = parseMoney(score.reviewsCount ?? score.reviewCount);
  const joined = stringsIn(score).join(" ");
  const ratingMatch = joined.match(/(?:^|\s)([1-5](?:[.,]\d)?)\s*(?:[•·]|из\s*5|$)/i);
  const reviewsMatch = joined.match(/(\d[\d\s\u00a0]*)\s*(?:отзыв|оцен)/i);
  return {
    rating: directRating ?? (ratingMatch?.[1] ? parseDecimal(ratingMatch[1]) : null),
    reviewCount: directReviewCount ?? (reviewsMatch?.[1] ? parseMoney(reviewsMatch[1]) : null),
  };
}

function richText(value: unknown): string {
  return array(value)
    .map((entry) => text(at(entry, "text")) ?? text(at(entry, "content")))
    .filter((entry): entry is string => !!entry)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function characteristics(page: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const widget = firstWidget(page, "webShortCharacteristics");
  for (const characteristic of array(widget?.characteristics)) {
    const name = richText(at(characteristic, "title", "textRs")) || text(at(characteristic, "title"));
    const value =
      richText(at(characteristic, "values")) ||
      richText(at(characteristic, "contentRS")) ||
      richText(at(characteristic, "valueRs"));
    if (name && value) result[name] = value;
  }
  return result;
}

function seller(page: unknown): ProductDetails["seller"] {
  const widget = firstWidget(page, "webCurrentSeller");
  if (!widget) return null;
  const name = text(at(widget, "sellerCell", "centerBlock", "title", "text")) ?? text(at(widget, "title", "text"));
  if (!name) return null;
  return {
    name,
    rating: parseDecimal(at(widget, "rating", "title", "text")),
    url: cleanOzonUrl(at(widget, "sellerCell", "common", "action", "link")),
  };
}

function trackingSku(page: unknown): string | null {
  const raw = text(at(page, "layoutTrackingInfo"));
  if (!raw) return null;
  try {
    return text(at(JSON.parse(raw), "sku"));
  } catch {
    return null;
  }
}

export function parseProduct(page: unknown): ProductDetails {
  const heading = firstWidget(page, "webProductHeading");
  const price = firstWidget(page, "webPrice");
  const gallery = firstWidget(page, "webGallery");
  const seoLink = at(page, "seo", "link", "0", "href");
  const sku = text(gallery?.sku) ?? trackingSku(page) ?? skuFromUrl(seoLink);
  const url = cleanOzonUrl(seoLink) ?? (sku ? `https://www.ozon.ru/product/${sku}/` : null);
  const score = parseScore(page);
  const images = [text(gallery?.coverImage), ...array(gallery?.images).map((image) => text(at(image, "src")) ?? text(at(image, "image")) ?? text(image))]
    .filter((image): image is string => !!image);

  return {
    sku,
    name: text(heading?.title) ?? text(at(page, "seo", "title")),
    url,
    price: parseMoney(price?.cardPrice) ?? parseMoney(price?.price),
    regularPrice: parseMoney(price?.price),
    oldPrice: parseMoney(price?.originalPrice),
    available: typeof price?.isAvailable === "boolean" ? price.isAvailable : null,
    rating: score.rating,
    reviewCount: score.reviewCount,
    seller: seller(page),
    images: [...new Set(images)].slice(0, 10),
    characteristics: characteristics(page),
    pricingContext: "Prices and availability reflect the location and session selected by Ozon.",
  };
}

function reviewDate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseReview(value: unknown): ProductReview | null {
  const review = object(value);
  if (!review) return null;
  const content = object(review.content) ?? {};
  const author =
    text(at(review, "author", "title")) ??
    ([text(at(review, "author", "firstName")), text(at(review, "author", "lastName"))].filter(Boolean).join(" ") ||
      (review.isAnonymous === true ? "Аноним" : null));

  return {
    author: author || null,
    score: parseDecimal(content.score),
    comment: text(content.comment) ?? "",
    pros: text(content.positive) ?? "",
    cons: text(content.negative) ?? "",
    date: reviewDate(review.publishedAt ?? review.createdAt),
    useful: typeof at(review, "usefulness", "useful") === "number" ? (at(review, "usefulness", "useful") as number) : null,
    purchased: typeof review.isItemPurchased === "boolean" ? review.isItemPurchased : null,
    hasPhotos: array(content.photos).length > 0,
  };
}

export function parseReviews(page: unknown, limit = 10): ReviewsResult {
  const widget = firstWidget(page, "webListReviews");
  const raw = array(widget?.reviews).length ? array(widget?.reviews) : array(widget?.items);
  const reviews = raw.map(parseReview).filter((review): review is ProductReview => review !== null).slice(0, limit);
  const score = parseScore(page);
  return {
    rating: score.rating,
    totalReviews: score.reviewCount,
    count: reviews.length,
    reviews,
  };
}

export const parserInternals = { cleanOzonUrl, skuFromUrl, widgets };
