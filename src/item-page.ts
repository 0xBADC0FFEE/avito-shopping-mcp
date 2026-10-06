import { isAllowedOutputUrl, publicUrl } from "./avito-api.js";
import { AvitoMcpError } from "./errors.js";
import { array, at, boolean, decimal, integer, isPresent, object, required, text } from "./json-fields.js";
import type { JsonObject } from "./json-fields.js";
import type { Characteristic, Coordinates, ItemDetails, ItemSeller, ItemViews, SellerRatingBadge } from "./types.js";

const HYDRATION_SCRIPT = /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/s;
const HYDRATION_PATH = "window.__staticRouterHydrationData";
const ITEM_ROUTE = "catalog-or-main-or-item";
const BUYER_ITEM_PATH = `loaderData.${ITEM_ROUTE}.buyerItem`;
const ITEM_IMAGE_SIZE = "1280x960";
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/**
 * Extracts the listing state Avito embeds in its item page.
 * @param html Item page HTML.
 * @returns The `buyerItem` object of the page's router hydration data.
 * @throws AvitoMcpError `AVITO_RESPONSE_INVALID` when the page carries no listing state.
 */
export function readBuyerItem(html: string): JsonObject {
  return required(object(at(hydrationData(html), "loaderData", ITEM_ROUTE, "buyerItem")), BUYER_ITEM_PATH);
}

export function parseItem(buyerItem: JsonObject, pageUrl: string): ItemDetails {
  const item = required(object(buyerItem.item), `${BUYER_ITEM_PATH}.item`);
  const hasPrice = at(item, "formattedPrice", "isHasValue") !== false;
  return {
    id: required(integer(item.id), `${BUYER_ITEM_PATH}.item.id`),
    title: required(text(item.title), `${BUYER_ITEM_PATH}.item.title`),
    url: required(publicUrl(text(item.url) ?? pageUrl), `${BUYER_ITEM_PATH}.item.url`),
    active: activeStatus(item),
    price: hasPrice ? (integer(item.price) ?? integer(at(item, "formattedPrice", "value"))) : null,
    priceText: hasPrice ? htmlToText(at(item, "formattedPrice", "formatedString")) : null,
    description: htmlToText(item.description),
    characteristics: array(at(buyerItem, "paramsBlock", "items")).map(characteristic).filter(isPresent),
    address: text(item.address) ?? text(at(item, "geo", "address")),
    coords: coordinates(at(item, "geo", "coords")) ?? coordinates(at(item, "location", "coords")),
    images: array(item.imageUrls)
      .map((image) => text(at(image, ITEM_IMAGE_SIZE)))
      .filter((url): url is string => url !== null && isAllowedOutputUrl(url)),
    publishedText: text(item.sortFormatedDate),
    views: views(buyerItem.viewStat),
    seller: seller(buyerItem),
  };
}

/**
 * Finds the seller key used by the reviews endpoint.
 * @param buyerItem Listing state from {@link readBuyerItem}.
 * @returns The key, or `null` when Avito omits it because the seller has no reviews.
 */
export function parseSellerUserKey(buyerItem: JsonObject): string | null {
  return text(at(buyerItem, "rating", "userKey"));
}

export function htmlToText(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const plain = decodeEntities(
    html
      .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<\s*li\b[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, ""),
  );
  return text(
    plain
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

function hydrationData(html: string): unknown {
  const literal = html.match(HYDRATION_SCRIPT)?.[1];
  const encoded = required(literal, HYDRATION_PATH);
  try {
    return JSON.parse(JSON.parse(encoded) as string) as unknown;
  } catch (error) {
    throw new AvitoMcpError("AVITO_RESPONSE_INVALID", `Avito returned unreadable ${HYDRATION_PATH}.`, { cause: error });
  }
}

function activeStatus(item: JsonObject): boolean | null {
  const active = boolean(item.isActive);
  if (active === null) return null;
  return active && boolean(item.isClosed) !== true;
}

function characteristic(entry: unknown): Characteristic | null {
  const name = text(at(entry, "title"));
  const value = text(at(entry, "description"));
  return name && value ? { name, value } : null;
}

function coordinates(value: unknown): Coordinates | null {
  const lat = decimal(at(value, "lat"));
  const lng = decimal(at(value, "lng"));
  return lat === null || lng === null ? null : { lat, lng };
}

function views(value: unknown): ItemViews | null {
  const total = integer(at(value, "totalViews"));
  const today = integer(at(value, "todayViews"));
  return total === null && today === null ? null : { total, today };
}

function seller(buyerItem: JsonObject): ItemSeller | null {
  const name = text(at(buyerItem, "seller", "name"));
  if (!name) return null;
  const profileLink = text(at(buyerItem, "publicProfile", "link"));
  return {
    name,
    isCompany: (boolean(at(buyerItem, "seller", "isCompany")) ?? boolean(buyerItem.isCompany)) === true,
    type: text(at(buyerItem, "seller", "labels", "nominative")),
    replyTimeText: text(at(buyerItem, "seller", "replyTimeText")),
    tenureSince: text(at(buyerItem, "seller", "tenureSince")),
    rating: ratingBadge(buyerItem.rating),
    url: profileLink === null ? null : publicUrl(profileLink),
  };
}

function ratingBadge(value: unknown): SellerRatingBadge | null {
  const score = decimal(at(value, "scoreFloat"));
  const summary = text(at(value, "summary"));
  return score === null && summary === null ? null : { score, summary };
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return codePoint(Number.parseInt(name.slice(2), 16), entity);
    if (name.startsWith("#")) return codePoint(Number.parseInt(name.slice(1), 10), entity);
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function codePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}
