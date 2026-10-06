import type { Location, SearchSort } from "./types.js";

export const AVITO_ORIGIN = "https://www.avito.ru";
export const AVITO_HOME_URL = `${AVITO_ORIGIN}/`;
export const MOSCOW: Location = { id: 637_640, name: "Москва" };

const REQUEST_HOST = new URL(AVITO_ORIGIN).hostname;
const OUTPUT_HOST_SUFFIXES = ["avito.ru", "avito.st"];
const SEARCH_API_PATH = "/web/1/js/items";
const LOCATIONS_API_PATH = "/web/1/slocations";
const LOCATION_CANDIDATES = 10;
const RATINGS_PAGE_SIZE = 25;
const SORT_PARAMS: Record<SearchSort, string> = {
  default: "101",
  price: "1",
  price_desc: "2",
  date: "104",
  discount: "172297_desc",
};

export interface SearchQuery {
  query: string;
  locationId: number;
  sort: SearchSort;
  page: number;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
}

export function searchApiUrl(search: SearchQuery): string {
  const params = new URLSearchParams({
    query: search.query,
    locationId: String(search.locationId),
    s: SORT_PARAMS[search.sort],
    p: String(search.page),
  });
  if (search.priceMin !== undefined) params.set("pmin", String(search.priceMin));
  if (search.priceMax !== undefined) params.set("pmax", String(search.priceMax));
  return `${AVITO_ORIGIN}${SEARCH_API_PATH}?${params.toString()}`;
}

export const SEARCH_PROBE_URL = searchApiUrl({ query: "iphone", locationId: MOSCOW.id, sort: "default", page: 1 });

export function locationsApiUrl(name: string, limit = LOCATION_CANDIDATES): string {
  const params = new URLSearchParams({ limit: String(limit), q: name });
  return `${AVITO_ORIGIN}${LOCATIONS_API_PATH}?${params.toString()}`;
}

export const LIVENESS_PROBE_URL = locationsApiUrl(MOSCOW.name, 1);

export function itemPageUrl(id: number): string {
  return `${AVITO_ORIGIN}/${id}`;
}

export function sellerRatingsUrl(userKey: string): string {
  const params = new URLSearchParams({
    summary_redesign: "1",
    sortRating: "date_desc",
    limit: String(RATINGS_PAGE_SIZE),
    offset: "0",
  });
  return `${AVITO_ORIGIN}/web/7/user/${encodeURIComponent(userKey)}/ratings?${params.toString()}`;
}

export function apiUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, AVITO_ORIGIN).toString();
}

/**
 * Turns a site path or URL from an Avito response into a shareable absolute link.
 * @param pathOrUrl Relative path (resolved against www.avito.ru) or absolute URL.
 * @returns HTTPS URL on an Avito host without query and fragment, or `null` for anything else.
 */
export function publicUrl(pathOrUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pathOrUrl, AVITO_ORIGIN);
  } catch {
    return null;
  }
  if (!isAllowedOutputUrl(url.toString())) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isAllowedRequestUrl(value: string): boolean {
  const url = parsedUrl(value);
  return url?.protocol === "https:" && url.hostname === REQUEST_HOST;
}

export function isAllowedOutputUrl(value: string): boolean {
  const url = parsedUrl(value);
  return (
    url?.protocol === "https:" &&
    OUTPUT_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))
  );
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
