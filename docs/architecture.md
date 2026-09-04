# Architecture

## Components

- `cli.ts` owns process modes: session setup, diagnostics, and stdio serving.
- `mcp-server.ts` defines MCP schemas and converts internal failures into safe tool errors.
- `ozon-client.ts` builds Ozon paths and exposes domain operations.
- `browser-session.ts` owns Chrome, session bootstrap, throttling, and the internal JSON transport.
- `session-store.ts` atomically persists browser state with private permissions.
- `parsers.ts` converts unknown Ozon widget JSON into stable public result types.

The MCP layer does not know about cookies or browser pages. Parsers do not perform network access. This separation keeps fixture tests deterministic and makes schema changes easier to isolate.

## Session lifecycle

1. The explicit setup command launches a clean headful browser context.
2. Setup polls a small product search until the internal API returns HTTP 200.
3. Cookies, local storage, and the observed user agent are saved atomically.
4. The first MCP request launches headless Chrome with the saved state and matching user agent.
5. A live probe must succeed before the requested operation runs.
6. HTTP 401, 403, or 307 closes the browser and produces `SESSION_EXPIRED`.
7. An idle timer closes Chrome without deleting the saved session.

The read-only tools never silently fall back to a visible browser. UI and local credential changes remain explicit user actions.

## Request discipline

All Ozon requests share one serial queue. A configurable minimum interval is enforced between calls. There is no automatic retry storm: a rejected session stops immediately and asks for setup.

Browser-side fetches use `AbortController`, so an MCP timeout does not leave unbounded network work running in the page.

## Trust boundaries

- Tool input can select an Ozon product path but cannot select an arbitrary hostname.
- Only HTTPS product URLs on `ozon.ru` or `www.ozon.ru` are accepted.
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
- No product-description layout request while that endpoint is consistently rejected.
