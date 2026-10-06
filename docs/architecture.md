# Architecture

## Components

- `cli.ts` owns process modes: session setup, diagnostics, and stdio serving.
- `mcp-server.ts` defines MCP schemas and converts internal failures into safe tool errors.
- `avito-client.ts` validates tool input, resolves locations, and composes operations from several Avito calls.
- `avito-api.ts` owns Avito endpoint URLs, public link normalization, and the host allowlists.
- `block-detection.ts` classifies Avito responses into ok, challenge, rate limit, rejected session, or not found.
- `browser-session.ts` owns Chrome, session bootstrap, throttling, challenge retry, and the internal transport.
- `session-store.ts` atomically persists browser state with private permissions.
- `parsers.ts` and `item-page.ts` convert unknown Avito JSON and item-page HTML into stable typed values.

The MCP layer does not know about cookies or browser pages. Parsers do not perform network access. This
separation keeps fixture tests deterministic and makes schema changes easier to isolate.

## Avito endpoints

All requests go to `https://www.avito.ru`. See [research/avito-data-access.md](research/avito-data-access.md)
for the field paths and the evidence behind them.

| Operation | Calls |
| --- | --- |
| Location | `GET /web/1/slocations?limit=10&q=<name>`; cached per process, Москва (637640) is built in |
| Search | `GET /web/1/js/items?query=…&locationId=…&s=…&p=…[&pmin=…&pmax=…]` → `catalog.items[type=item]` |
| Item | `GET /<id>` (redirects to the canonical page) → `window.__staticRouterHydrationData` → `loaderData["catalog-or-main-or-item"].buyerItem` |
| Seller reviews | item page → `buyerItem.rating.userKey` → `GET /web/7/user/<userKey>/ratings?sortRating=date_desc…`, then `nextPage` (25 reviews per page); no `userKey` means no reviews, so the result has `rating: null` and no reviews |

Every search passes `locationId` explicitly, because Avito also stores the last searched location in the
session. Sort values map to Avito's `s` parameter: `default` → 101, `price` → 1, `price_desc` → 2, `date` → 104,
`discount` → `172297_desc`. Search results expose `sortTimeStamp` as an ISO time; the item card only has a
human-readable date.

The hydration state is a JSON string literal passed to `JSON.parse` in the page, so it is decoded twice. The
listing description arrives as HTML and is converted to plain text.

## Session lifecycle

1. The explicit setup command launches a clean headful browser context on the home page.
2. Setup waits until the page title is no longer an Avito block page, then probes search once. A 439 challenge
   reloads the home page once and probes again. Any other failure is never retried on a timer, because repeated
   probes keep a throttled IP flagged: setup waits for a page load the user causes in the window (reload, solved
   CAPTCHA) and probes once more. The user passes any CAPTCHA in that window; the server never solves one. On
   timeout, setup reports `AVITO_RATE_LIMITED` if the last probe was throttled, otherwise `AVITO_BLOCKED`.
3. Cookies, local storage, and the observed user agent are saved atomically.
4. The first MCP request launches headless Chrome with the saved state and matching user agent and parks a page
   on the home page. All requests are `fetch()` calls made from that page.
5. An idle timer closes Chrome without deleting the saved session.

## Block handling

Avito sits behind Qrator. Responses are classified as follows:

| Signal | Handling |
| --- | --- |
| HTTP 439 (JS proof-of-work) | Reload the home page so the browser solves the challenge, then retry once. A second 439 closes the browser and returns `SESSION_EXPIRED`. |
| HTTP 429, a firewall HTML page (`firewall-container`), or JSON with a `too-many-requests` key | `AVITO_RATE_LIMITED`, then a 20-minute backoff (below). |
| Other HTTP 401/403 | Close the browser and return `SESSION_EXPIRED`. |
| HTTP 404 on an item page | `ITEM_NOT_FOUND`. |
| A required response path is missing | `AVITO_RESPONSE_INVALID` naming the path. |

After any `AVITO_RATE_LIMITED`, including a setup that timed out while throttled, the server pauses for 20
minutes: every request fails fast with `AVITO_RATE_LIMITED` and the remaining minutes, without touching Avito.
On each request during the pause the server reads the stored session; if its `createdAt` is newer than the
limit (setup succeeded, possibly in another process), the pause ends and the browser restarts with the new
session.

Invalid tool input fails before any request: `INVALID_INPUT` for search queries and price ranges,
`INVALID_ITEM` for listing references.

## Request discipline

All Avito requests share one serial queue. A configurable minimum interval (default 5 seconds) plus up to
2 seconds of random jitter is enforced between calls. There is no retry storm: apart from the single challenge
retry, a blocked request stops immediately. The challenge retry also waits the minimum interval after the home
page reload.

`avito_health` with `live=true` sends `GET /web/1/slocations?limit=1&q=Москва`, the lightest request that proves
the saved session and browser transport work. It does not prove search quota: Avito has answered location
lookups while throttling search. Setup therefore keeps probing search itself.

Browser-side fetches use `AbortController`, so an MCP timeout does not leave unbounded network work running in
the page.

## Trust boundaries

- Tool input selects a listing id, never a URL to fetch.
- Only HTTPS listing URLs on `avito.ru`, `www.avito.ru`, or `m.avito.ru` are accepted as input.
- Every request URL, including `nextPage` links returned by Avito and redirect targets, must be HTTPS on
  `www.avito.ru`.
- Links in results must be HTTPS on `avito.ru`, `avito.st`, or their subdomains; tracking query strings are dropped.
- Response data is treated as unknown until parsers validate individual fields.
- Listing, seller, and review strings are treated as untrusted marketplace content, never as instructions.
- Cookie values and response bodies from blocked requests are not logged.
- Unknown internal errors and local session paths are not exposed to MCP clients.
- The browser session never lives inside the repository by default.
- On Unix-like systems, a session file with group or public access is rejected before it is loaded.

## Deliberate omissions

- No account login, messaging, favorites, phone numbers, or listing management.
- No seller lookup by `/brands/<slug>` URL: the slug-to-`userKey` endpoint is unverified.
- No remote HTTP transport.
- No Docker workflow until headful bootstrap and secure state injection have a clear cross-platform design.
