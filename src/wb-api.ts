export const WB_HOME_URL = "https://www.wildberries.ru/";
export const BASKET_ROUTES_URL = "https://cdn.wbbasket.ru/api/v3/upstreams";

// Moscow delivery point, used when the session has no stored region.
const DEFAULT_REGION_QUERY = "appType=1&curr=rub&dest=-1257786&spp=30";
const SEARCH_API_URL = "https://www.wildberries.ru/__internal/u-search/exactmatch/ru/common/v18/search";
const PRODUCT_API_URL = "https://www.wildberries.ru/__internal/u-card/cards/v4/detail";
const FEEDBACK_HOST_API_URL = "https://feedback-bt.wildberries.ru/feedback/api/v2/host";
const ALLOWED_HOST_SUFFIXES = ["wildberries.ru", "wb.ru", "wbbasket.ru"];
const ARTICLES_PER_VOL = 100_000;
const ARTICLES_PER_PART = 1_000;
const SEARCH_IMAGE_SIZE = "c516x688";

export interface BasketRoute {
  volFrom: number;
  volTo: number;
  host: string;
}

export function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export function isAllowedApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isAllowedHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Turns the region query Wildberries stores in the session (`geo-data-v1-0.data.xinfo`) into API parameters.
 * @param xinfo Raw stored value; anything without a numeric `dest` is ignored.
 * @returns Query string with currency and delivery destination.
 */
export function regionQuery(xinfo: unknown): string {
  if (typeof xinfo !== "string") return DEFAULT_REGION_QUERY;
  const params = new URLSearchParams(xinfo);
  return /^-?\d+$/.test(params.get("dest") ?? "") ? params.toString() : DEFAULT_REGION_QUERY;
}

export function searchApiUrl(region: string, filters: Record<string, string>): string {
  const params = new URLSearchParams(region);
  params.set("lang", "ru");
  params.set("resultset", "catalog");
  params.set("page", "1");
  for (const [name, value] of Object.entries(filters)) params.set(name, value);
  return `${SEARCH_API_URL}?${params.toString()}`;
}

export const SESSION_PROBE_URL = searchApiUrl(DEFAULT_REGION_QUERY, { query: "wildberries", sort: "popular" });

export function productApiUrl(region: string, article: number): string {
  const params = new URLSearchParams(region);
  params.set("lang", "ru");
  params.set("nm", String(article));
  return `${PRODUCT_API_URL}?${params.toString()}`;
}

export function feedbackHostApiUrl(rootId: number): string {
  return `${FEEDBACK_HOST_API_URL}?imt=${rootId}`;
}

export function feedbacksUrl(feedbackHost: string, rootId: number): string {
  return `${feedbackHost.replace(/\/+$/, "")}/feedbacks/v2/${rootId}`;
}

export function productPageUrl(article: number): string {
  return `https://www.wildberries.ru/catalog/${article}/detail.aspx`;
}

export function sellerPageUrl(sellerId: number): string {
  return `https://www.wildberries.ru/seller/${sellerId}`;
}

function basketUrl(routes: BasketRoute[], article: number, path: string): string | null {
  const vol = Math.floor(article / ARTICLES_PER_VOL);
  const part = Math.floor(article / ARTICLES_PER_PART);
  const route = routes.find((candidate) => vol >= candidate.volFrom && vol <= candidate.volTo);
  return route ? `https://${route.host}/vol${vol}/part${part}/${article}/${path}` : null;
}

export function productCardUrl(routes: BasketRoute[], article: number): string | null {
  return basketUrl(routes, article, "info/ru/card.json");
}

export function searchImageUrl(routes: BasketRoute[], article: number): string | null {
  return basketUrl(routes, article, `images/${SEARCH_IMAGE_SIZE}/1.webp`);
}

export function productImageUrls(routes: BasketRoute[], article: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => basketUrl(routes, article, `images/big/${index + 1}.webp`)).filter(
    (url): url is string => url !== null,
  );
}
