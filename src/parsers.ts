import { isAllowedOutputUrl, publicUrl } from "./avito-api.js";
import { array, at, decimal, integer, isPresent, list, required, text } from "./json-fields.js";
import type { Location, RatingSummary, ScoreCount, SearchItem, SearchSeller, SellerReview } from "./types.js";

export interface SearchPage {
  totalCount: number;
  items: SearchItem[];
}

export interface RatingsPage {
  summary: RatingSummary | null;
  reviews: SellerReview[];
  nextPage: string | null;
}

const LISTING_TYPE = "item";
const SEARCH_IMAGE_SIZE = "636x636";
const SELLER_INFO_COMPONENT = "seller-info";
const SCORE_ENTRY = "score";
const REVIEW_ENTRY = "rating";

export function parseSearchPage(response: unknown): SearchPage {
  const entries = required(list(at(response, "catalog", "items")), "catalog.items");
  return {
    totalCount: required(integer(at(response, "totalCount")), "totalCount"),
    items: entries
      .map((entry, index) => (at(entry, "type") === LISTING_TYPE ? searchItem(entry, `catalog.items[${index}]`) : null))
      .filter(isPresent),
  };
}

export function parseLocations(response: unknown): Location[] {
  return required(list(at(response, "result", "locations")), "result.locations").map((entry, index) => ({
    id: required(integer(at(entry, "id")), `result.locations[${index}].id`),
    name: required(text(at(entry, "names", "1")), `result.locations[${index}].names.1`),
  }));
}

export function parseRatingsPage(response: unknown): RatingsPage {
  const entries = required(list(at(response, "entries")), "entries");
  const score = entries.find((entry) => at(entry, "type") === SCORE_ENTRY);
  return {
    summary: score === undefined ? null : ratingSummary(at(score, "value")),
    reviews: entries.filter((entry) => at(entry, "type") === REVIEW_ENTRY).map((entry) => review(at(entry, "value"))),
    nextPage: text(at(response, "nextPage")),
  };
}

function searchItem(entry: unknown, path: string): SearchItem {
  const hasPrice = at(entry, "priceDetailed", "hasValue") !== false;
  const publishedAt = integer(at(entry, "sortTimeStamp"));
  const image = text(at(array(at(entry, "images"))[0], SEARCH_IMAGE_SIZE));
  return {
    id: required(integer(at(entry, "id")), `${path}.id`),
    title: required(text(at(entry, "title")), `${path}.title`),
    price: hasPrice ? integer(at(entry, "priceDetailed", "value")) : null,
    priceText: displayText(at(entry, "priceDetailed", "fullString")),
    url: required(publicUrl(required(text(at(entry, "urlPath")), `${path}.urlPath`)), `${path}.urlPath`),
    location: text(at(entry, "addressDetailed", "locationName")) ?? text(at(entry, "geo", "formattedAddress")),
    publishedAt: publishedAt === null ? null : new Date(publishedAt).toISOString(),
    image: image !== null && isAllowedOutputUrl(image) ? image : null,
    seller: searchSeller(entry),
  };
}

function searchSeller(entry: unknown): SearchSeller | null {
  const sellerInfo = array(at(entry, "iva", "UserInfoStep")).find(
    (step) => at(step, "componentData", "component") === SELLER_INFO_COMPONENT,
  );
  const name = text(at(sellerInfo, "payload", "profile", "title"));
  if (!name) return null;
  const link = text(at(sellerInfo, "payload", "profile", "link"));
  return {
    name,
    url: link === null ? null : publicUrl(link),
    rating: decimal(at(sellerInfo, "payload", "rating", "score")) ?? decimal(at(entry, "rating", "score")),
  };
}

function displayText(value: unknown): string | null {
  return text(typeof value === "string" ? value.replace(/\u00a0/g, " ") : value);
}

function ratingSummary(value: unknown): RatingSummary {
  return {
    score: decimal(at(value, "scoreFloat")) ?? decimal(at(value, "score")),
    reviewCount: integer(at(value, "reviewCount")),
    distribution: array(at(value, "ratingStat")).map(scoreCount).filter(isPresent),
  };
}

function scoreCount(value: unknown): ScoreCount | null {
  const score = integer(at(value, "score"));
  const count = integer(at(value, "count"));
  return score === null || count === null ? null : { score, count };
}

function review(value: unknown): SellerReview {
  return {
    score: integer(at(value, "score")),
    date: text(at(value, "rated")),
    role: text(at(value, "titleCaption")),
    itemTitle: text(at(value, "itemTitle")),
    stage: text(at(value, "stageTitle")),
    text: array(at(value, "textSections"))
      .map((section) => text(at(section, "text")))
      .filter(isPresent)
      .join("\n"),
    answer: text(at(value, "answer", "text")),
  };
}
