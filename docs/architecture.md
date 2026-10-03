# Architecture

## Components

- `cli.ts` owns process modes: session setup, diagnostics, and stdio serving.
- `mcp-server.ts` defines MCP schemas and converts internal failures into safe tool errors.
- `wb-client.ts` validates tool input and composes domain operations from several Wildberries calls.
- `wb-api.ts` owns Wildberries endpoint URLs, media-host routing, and the host allowlist.
- `browser-session.ts` owns Chrome, session bootstrap, throttling, and the internal JSON transport.
- `session-store.ts` atomically persists browser state with private permissions.
- `parsers.ts` converts unknown Wildberries JSON into stable typed values.

The MCP layer does not know about cookies or browser pages. Parsers do not perform network access. This separation keeps fixture tests deterministic and makes schema changes easier to isolate.

## Wildberries endpoints

| Operation | Calls |
| --- | --- |
| Search | `www.wildberries.ru/__internal/u-search/…/search`, media routes |
| Product | `www.wildberries.ru/__internal/u-card/cards/v4/detail`, media routes, `basket-*.wbbasket.ru/…/info/ru/card.json` |
| Reviews | product detail, `feedback-bt.wildberries.ru` review-host lookup, `feedback*.wb.ru/feedbacks/v2/<card id>` |

Media routes (`cdn.wbbasket.ru/api/v3/upstreams`) map an article's volume to its `basket-*` host and are cached for an hour. Prices arrive in kopecks; the cheapest size defines the product price.

## Session lifecycle

1. The explicit setup command launches a clean headful browser context.
2. Setup polls a small product search until the internal API returns HTTP 200, which happens once the anti-bot challenge has issued its token.
3. Cookies, local storage, and the observed user agent are saved atomically.
4. The first MCP request launches headless Chrome with the saved state and matching user agent.
5. A live probe must succeed before the requested operation runs.
6. HTTP 401, 403, or 498 closes the browser and produces `SESSION_EXPIRED`.
7. An idle timer closes Chrome without deleting the saved session.

Same-origin API requests carry the session's device id (`wbx__sessionID` in local storage) as the `deviceid` header; Wildberries rejects them without it. The delivery region comes from the session's `geo-data-v1-0` local storage entry and falls back to Moscow.

The read-only tools never silently fall back to a visible browser. UI and local credential changes remain explicit user actions.

## Request discipline

All Wildberries requests share one serial queue. A configurable minimum interval is enforced between calls. There is no automatic retry storm: a rejected session stops immediately and asks for setup.

Browser-side fetches use `AbortController`, so an MCP timeout does not leave unbounded network work running in the page.

## Trust boundaries

- Tool input selects an article number, never a URL to fetch.
- Only HTTPS product URLs on `wildberries.ru` or `www.wildberries.ru` are accepted.
- Every request URL, including hosts returned by Wildberries for media and reviews, must be HTTPS on `wildberries.ru`, `wb.ru`, or `wbbasket.ru`.
- Response JSON is treated as unknown data until parsers validate individual fields.
- Product, seller, and review strings are treated as untrusted marketplace content, never as instructions.
- Cookie values and response bodies from blocked requests are not logged.
- Unknown internal errors and local session paths are not exposed to MCP clients.
- The browser session never lives inside the repository by default.
- On Unix-like systems, a session file with group or public access is rejected before it is loaded.

## Deliberate omissions

- No account login, orders, cart mutation, seller APIs, or advertising APIs.
- No remote HTTP transport.
- No Docker workflow until headful bootstrap and secure state injection have a clear cross-platform design.
- No "best deal" sort: the search API silently falls back to popularity for it.
