# Avito data access: research notes (2026-10-06)

Empirical probe of www.avito.ru for a buyer-side, read-only MCP server. I used no login and solved no CAPTCHAs. Requests went out from one residential IP, through two channels:

- **raw curl**: Chrome UA, no cookies.
- **page-context `fetch()`**: run inside a real Chromium tab on `https://www.avito.ru`, which is the same mechanism as Playwright `page.evaluate(fetch)`.

Sanitized samples are in [`test/fixtures/`](../../test/fixtures/), where the parser tests use them.

## 1. Main finding: transport

| Channel | HTML pages | `/web/1/js/items` | `/web/1/slocations` |
| --- | --- | --- | --- |
| curl, 1st request | 200 | — | — |
| curl, 2nd request (seconds later) | **429** "Доступ ограничен: проблема с IP" | **439** PoW challenge, then **403** `{"too-many-requests":…}` | 200 |
| Browser top-level navigation (same IP, same time) | **429 firewall page with CAPTCHA** | — | — |
| Browser page-context `fetch()` (same IP, same time) | **200** (search, item, profile HTML) | **200** | 200 |

The IP was already banned for both raw HTTP and top-level navigation. Same-origin `fetch()` from an already-open avito.ru tab, even one showing the block page, kept returning 200 for about 25 requests over about 15 minutes. After that it also got `429 {"too-many-requests":…}` JSON.

**Recommendation:** reuse the WB architecture.

- A persistent Playwright profile and a headless page parked on `https://www.avito.ru/`.
- All data calls go through `page.evaluate(fetch(url, {headers:{accept:'application/json'}}))`.
- A serial queue with at least 3–5 s between calls, plus jitter.
- No raw Node HTTP.

The protection is **Qrator**: the response header is `server: QRATOR`. Cookies set on first contact are `srv_id`, `_avisc`, `gMltIuegZN2COuSe`, `u`, `v`, `h_u`, plus `pow_challenge` on 439. A real browser solves the 439 JS proof-of-work by itself. The 429 CAPTCHA (hCaptcha or Geetest) needs a human. Only headed `setup` can do that.

## 2. Endpoints and field paths

All URLs are relative to `https://www.avito.ru`. Responses are JSON unless noted.

### avito_search: `GET /web/1/js/items`

Query params (verified):

| Param | Meaning |
| --- | --- |
| `query` (or `q`) | search text |
| `locationId` | location id (Москва 637640, Россия 621540) |
| `categoryId` | category id (optional; e.g. 84 = телефоны) |
| `pmin`, `pmax` | price range in ₽ (verified: results ≥ pmin, sorted) |
| `s` | sort: `101` default, `1` cheaper, `2` more expensive, `104` by date, `172297_desc` by discount; list is in `catalog.sorts[]` |
| `p` | page, 1-based; 50 items per page (`itemsOnPage`) |
| `localPriority=0` | optional; mirrors the site |

Response:

- `totalCount`, `count`, `itemsOnPage`.
- `url`: canonical SERP path. It includes the **location slug** and resolved category, e.g. `/moskva/telefony/mobilnye_telefony/apple-…`.
- `catalog.items[]`. Keep only `type === "item"`; other types (`banner`, `vip`, `xl`, …) appear in mixed feeds.

Per item:

| Output | Path |
| --- | --- |
| id | `id` |
| title | `title` |
| price | `priceDetailed.value` (number), `priceDetailed.fullString` (e.g. "14 000 ₽"); `priceDetailed.hasValue=false` means no price ("Цена не указана") |
| url | `"https://www.avito.ru" + urlPath` (strip the `?context=` query) |
| location | `locationId`; `geo.formattedAddress` (often empty); `addressDetailed.locationName` |
| date | `sortTimeStamp` (ms epoch); human form in `iva.DateInfoStep[component=date-info].payload.relative` |
| seller | `iva.UserInfoStep[component=seller-info].payload.profile.{title, link:/brands/<slug>}`, `.rating.{score, summary}`; also top-level `rating.{score,summary}`. **Often empty**: shops/companies frequently have no UserInfoStep |
| image | `images[0]["636x636"]` (other keys: 208x208 … 472x472); `gallery.imageLargeUrl` is usually empty now |
| description snippet | `description` |
| misc | `category.{id,name,slug}`, `isReserved`, `contacts.delivery`, `iva.BadgeBarStep[].payload.badges[].title` |

Sample: `test/fixtures/search-web1-js-items.json`.

The same JSON is embedded in SERP HTML as `<script type="mime/invalid" data-mfe-state="true">` → `.loaderData.data` (same `catalog.items`). A free-text URL like `/moskva?q=iphone` returns only an SSR redirect stub (`loaderData.data = {status:{code:301}, url}`), so the JSON endpoint is simpler.

### avito_item: HTML card plus embedded hydration JSON

There is no working JSON item endpoint on www:

- `/web/1/items/<id>` → 404.
- `/web/2/items/<id>` → 404.
- The mobile `m.avito.ru/api/19/items/<id>?key=af0deccbgcgidddjgnvljitntccdduijhdinfgjgfjir` is dead: m.avito.ru 301s to www and sits behind the same Qrator, per the avito_bot research.

What works:

1. `GET /<id>`: the bare numeric id redirects to the canonical item URL (verified). `fetch` follows the redirect, and `response.url` gives the canonical URL.
2. In the HTML, find `window.__staticRouterHydrationData = JSON.parse("<JSON string literal>")`. Parse it twice, then go to `.loaderData["catalog-or-main-or-item"].buyerItem`.

Field paths under `buyerItem`:

| Output | Path |
| --- | --- |
| title | `item.title` |
| price | `item.price`, `item.formattedPrice.{value,string,oldString}` |
| description | `item.description`: **HTML** (`<p>…`, `<br>`). Strip tags, or use DOM `[data-marker="item-view/item-description"]` |
| params | `paramsBlock.items[] {title, description, attributeId}` (also `paramsDto.items`) |
| address | `item.address`, `item.geo.{address,coords}`, `item.location.{name,slug}`, `item.sellerAddressInfo.geoReferences[].content` (metro) |
| photos | `item.imageUrls[] {"1280x960","640x480","150x110","75x55"}` |
| published | `item.sortFormatedDate` ("сегодня в 21:11"); DOM `[data-marker="item-view/item-date"]`; no absolute timestamp in the card. Use search `sortTimeStamp` when available |
| views | `viewStat.{totalViews,todayViews}`; DOM `item-view/total-views`, `item-view/today-views` (showed 0 on a 1-hour-old item, so it may lag) |
| seller | `seller.{name, isCompany, labels.nominative ("Частное лицо"), replyTimeText, tenureSince}`, `item.sellerBadgeBar.iconsBadges[].title`, `publicProfile.{link,summary}`, `item.shop.{isShop,name}` |
| seller rating | `rating.{scoreFloat, summary, activeReviewsCount, userKey}`. **`userKey` (64 hex) is the key for review endpoints** |
| status | `item.{isActive,isClosed,isExpired,statusId}`, `closedItem` |
| other | `item.category`, `item.breadcrumbs`, `item.seo.ld` (schema.org JSON-LD as string), `item.phone` (masked only) |

Sample: `test/fixtures/item-hydration-buyerItem.json`.

Fallback (Duff89): the same item URL HTML also has `script[type="mime/invalid"][data-mfe-state]` → `loaderData.data.item.description` on some layouts.

### avito_seller_reviews

| Purpose | Request | Key paths |
| --- | --- | --- |
| Rating summary + profile | `GET /web/3/user/{userKey}/extended-profile` | `result.value.data.{username,profileType}`, `result.value.widgets[name=base_info].value.{description ("На Авито с …"), rating.{scoreFloat,summary,activeReviewsCount}, subscribeInfo}` |
| Reviews | `GET /web/7/user/{userKey}/ratings?summary_redesign=1&sortRating=date_desc&limit=25&offset=0` | `entries[type=score].value.{scoreFloat,reviewCount,ratingStat[{score,count}]}`; `entries[type=rating].value.{id,score,rated,title (reviewer first name),titleCaption ("Покупатель"/"Продавец" = role of the reviewer),itemTitle,stageTitle ("Сделка состоялась"/"сорвалась"),textSections[].text,images[],answer.{text,answered}}`; `nextPage` (relative URL, absent at end) |

Notes:

- `sortRating` accepts `date_desc|date_asc|score_desc|score_asc`, and `photoOnly=true|false` filters to reviews with photos. Page size is fixed at 25.
- `/web/4|5|6/.../ratings` all return nginx 404, even though `base_info.rating.nextPage` still advertises `/web/4`. `/web/7` is the live version (also used by DaniilL12321/openAvito).
- Resolving `userKey`:
  - From a listing: fetch the item (above) and read `buyerItem.rating.userKey`. This works.
  - From a `/brands/<32-hex slug>` URL: the profile HTML is client-rendered, and its `data-props` has only `domain:<slug>`. The page calls `GET /web/1/domain/{slug}/extended-profile`; I hit the throttle before getting a 200 from it (see open risks). `/web/3/user/<slug>/…` answers "Пользователь не найден", and `/web/7/user/<slug>/ratings` returns `{"entries":[]}`.

Samples: `seller-extended-profile-web3.json`, `seller-ratings-web7.json`.

### Location resolution: `GET /web/1/slocations?limit=10&q=<Cyrillic name>`

- Response shape: `result.locations[] {id, names["1"], parent?{id,names["1"]}}`. Example: Казань → 650400 (parent Татарстан 650130).
- An ASCII query ("kazan") returned `[]`. Transliterate or require Cyrillic.
- There is no slug in the response. Get it from the `url` of `/web/1/js/items?locationId=<id>` (e.g. `/kazan/…`) or from `buyerItem.item.location.slug`.
- Known ids: 621540 all Russia, 637640 Москва, 107620 Москва и МО, 637680 Московская обл.
- Caution: a search with `locationId` updates the profile's stored location, so item cards then show `searchLocation` for that city.

## 3. Block detection

| Signal | Meaning | Action |
| --- | --- | --- |
| HTTP 439, HTML `<title>Доступ ограничен: проверка безопасности</title>`, `Set-Cookie: pow_challenge=…`, `server: QRATOR` | JS PoW challenge | A real browser passes it automatically: navigate the page to `/` and retry once |
| HTTP 429 (or 403), HTML `<title>Доступ ограничен: проблема с IP</title>`, `.firewall-container`, hCaptcha (`hcaptcha.com/1/api.js`) / Geetest (`avito.st/s/captcha/gt4.js`), text "Что не так с IP" | IP ban with CAPTCHA | Stop. Return `SESSION_BLOCKED`/`RATE_LIMITED`; the user runs headed `setup` and solves the CAPTCHA. Back off ≥ 20 min (avito_bot observed 30–60+ min bans) |
| HTTP 403/429 JSON `{"too-many-requests":{"message":"Доступ с вашего IP-адреса временно ограничен","link":"ru.avito://1/firewall/captcha/show"}}` | Throttle on JSON endpoints | Same as above. Match the JSON key, not the phrase in ad text |
| 200 JSON whose `catalog.items` is missing, or `{"url":…}` with no catalog | schema drift or redirect stub | Report schema error |

No `Retry-After` header was seen. Samples: `block-429-ip-restricted.html`, `block-403-too-many-requests.json`. A 439 page capture is in newnout6-a11y/avito_bot `research/challenge_page.html`.

## 4. Open-source references (checked 2026-10)

- **Duff89/parser_avito** (≈756★, pushed 2026-09-30, Python):
  - Converts SERP URLs to mobile-API URLs (`m.avito.ru/api/9/items`) through the paid third-party **spfa.pro**.
  - Parses `script[type=mime/invalid][data-mfe-state]` → `loaderData.data`.
  - Item stats come from `m.avito.ru/api/1/card/items/{id}`.
  - Its anti-block guidance is a mobile proxy plus purchased cookies. Not usable for us.
- **newnout6-a11y/avito_bot** (pushed 2026-09-04): best live research.
  - `/web/1/js/items` with `categoryId,locationId,query,sort`, at 50 items per page.
  - Block taxonomy: 403 JSON throttle, 429 IP ban, 439 PoW.
  - A PoW solver (`/web/3/firewallPow/get|verify`) and a 20-min base backoff.
  - "mobile API dead" (m.avito.ru → www, same Qrator).
  - Sitemaps stay 200 during bans.
- **DaniilL12321/openAvito** (SvelteKit, 2025-11):
  - `/web/1/js/items` with `q,p,locationId,categoryId,pmin,pmax,sort`.
  - `/web/1/slocations`, `/web/3/suggest`, `/web/1/category/tree`.
  - `/web/7/user/{id}/ratings`.
  - Uses the dead `m.avito.ru/api/19/items` for descriptions.
- **domovoyproj/avito-parser**: Playwright plus `__initialData__` / data-marker fallbacks. Older embedding; I saw no `__initialData__` on current pages.

## 5. Recommended strategy per tool

- **avito_health**: page-context `fetch('/web/1/slocations?limit=1&q=Москва')` plus a 1-item `/web/1/js/items` probe. Classify the result as ok, challenge, ip_block or throttle.
- **avito_setup_session**: headed browser on `/`. Wait until the title is not "Доступ ограничен…" and `/web/1/js/items` returns 200 JSON, then save the profile. The user solves any CAPTCHA themselves.
- **avito_search**: `/web/1/js/items`. Resolve the city with `/web/1/slocations`. Map sort to `s`.
- **avito_item**: `fetch('/<id>')` or the given URL. Parse `__staticRouterHydrationData` (JSON-in-string) → `buyerItem`. DOM `data-marker` fallbacks: `item-view/title-info`, `item-view/item-params`, `item-view/item-description`, `item-view/item-date`, `item-view/total-views`.
- **avito_seller_reviews**: from a listing, item → `rating.userKey` → `/web/3/user/{key}/extended-profile` plus `/web/7/user/{key}/ratings` (follow `nextPage`).

## 6. Open risks

- **Rate limits are tight.** About 25 page-context requests in about 15 min (after the IP was already flagged by curl) produced a JSON 429. Budget about 1 request per 5–10 s and cache aggressively. A healthy, unflagged profile probably tolerates more, but I could not measure that.
- **Seller-by-URL is unresolved.** `/brands/<slug>` → `userKey` is not verified. Retry `/web/1/domain/{slug}/extended-profile` when not throttled. Until then, `avito_seller_reviews` should accept a listing URL/id, or the profile URL only if that endpoint proves out.
- Version churn is real: ratings moved v4 → v7, the mobile API died, `__initialData__` was replaced by `__staticRouterHydrationData` and `data-mfe-state`. Validate all fields as unknown and fail with a schema error.
- `item.description` is HTML, and published date and views are human strings that may lag.
- SERP seller info is missing for many items. The tool must treat seller as optional.
- Search with `locationId` mutates the stored profile location.
- Raw HTTP (curl/undici) is unusable. Even curl-impersonate-class TLS gets 439 and then 403. The browser transport is mandatory.
