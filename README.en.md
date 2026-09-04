<p align="right">
  <a href="README.md">Русский</a> · <strong>English</strong>
</p>

# Ozon Shopping MCP

[![npm](https://img.shields.io/npm/v/ozon-shopping-mcp.svg)](https://www.npmjs.com/package/ozon-shopping-mcp)
[![CI](https://github.com/neosheps/ozon-shopping-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/neosheps/ozon-shopping-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Compare Ozon products with your AI agent.** Ozon Shopping MCP turns search results, product cards, and
reviews into tools your MCP client can use — locally, without Seller API credentials or dozens of open tabs.

The server is read-only: it does not manage a seller cabinet, cart, orders, or customer account. The browser
session stays on your machine.

> **Alpha:** Ozon does not offer a public buyer API, so the project uses internal website endpoints. They
> and Ozon's anti-automation behavior can change without notice.

## Features

- find products sorted by popularity, price, rating, recency, or discount;
- narrow results to a chosen price range;
- collect current prices, availability, ratings, sellers, images, and characteristics;
- break down recent reviews, scores, pros, and cons;
- run locally through a protected session with serialized, rate-limited requests.

## Quick start

Requires Node.js 24 LTS or newer and Google Chrome. Set up a local Ozon session with one command:

```bash
npx -y ozon-shopping-mcp@latest setup
```

Add the server to Codex:

```bash
codex mcp add ozon-shopping -- npx -y ozon-shopping-mcp@latest serve
```

For another MCP client, use the equivalent stdio configuration:

```json
{
  "mcpServers": {
    "ozon-shopping": {
      "command": "npx",
      "args": ["-y", "ozon-shopping-mcp@latest", "serve"]
    }
  }
}
```

Ozon may present an interactive check during the first setup. Afterwards, requests run in headless Chrome
without opening a visible browser.

## Example prompts

```text
Find 5 wireless mice under RUB 4,000. Prioritize models rated at least 4.7
with 300+ reviews. Compare the current price, availability, seller, connection,
and weight, then recommend the best one for everyday work.
```

```text
Compare 5 air fryers under RUB 12,000 with at least a 5-liter capacity. Check
power, programs, and dimensions in the product cards, summarize recurring pros
and problems from recent reviews, and pick the best option for a family.
```

```text
Find a 20,000 mAh power bank with USB-C PD of at least 65 W under RUB 7,000.
Check its ports and weight, then scan reviews for heat, capacity, and fast-charging
issues. Flag anything you cannot confirm from the product card.
```

```text
Find Samsung Galaxy S24 256 GB offers from different sellers on Ozon. Collect
up to 5 matching product cards, verify the exact model and storage, then compare
current prices, availability, sellers, characteristics, and recent reviews.
Show the best-value offer and the important differences between listings.
```

Each prompt runs the full flow: search → candidate product cards → reviews → final comparison.

## Tools

| Tool | Purpose |
| --- | --- |
| `ozon_search` | Search with sorting, price filters, and a result limit |
| `ozon_product` | Read price, availability, seller, rating, images, and characteristics |
| `ozon_reviews` | Read recent reviews, pros, cons, and scores |
| `ozon_health` | Check whether the local session is ready |
| `ozon_setup_session` | Create or refresh the session in a separate browser window |

## How it works

1. `setup` creates an anonymous Ozon browser session and stores it outside the repository.
2. MCP tools reuse the session in headless Chrome.
3. Requests run serially with rate limiting.
4. If the session expires, the server asks the user to run `setup` again explicitly.

## Security and limitations

- the session file contains cookies and uses private filesystem permissions (`0700`/`0600` where supported);
- cookies, blocked response bodies, and unknown internal errors are not returned through MCP;
- product names, characteristics, and reviews are untrusted data — agents must not follow instructions found in them;
- prices, availability, and ranking vary by region, session, and time;
- the project is intended for interactive personal use, not bulk collection or a public HTTP bridge.

See [SECURITY.md](SECURITY.md) for reporting guidance. This project is not affiliated with, endorsed by,
or sponsored by Ozon.

## Development

```bash
git clone https://github.com/neosheps/ozon-shopping-mcp.git
cd ozon-shopping-mcp
npm ci
npm run check
npm run build
```

See [docs/architecture.md](docs/architecture.md) for the design and [CONTRIBUTING.md](CONTRIBUTING.md) to
contribute.

## License

[MIT](LICENSE) © 2026 [Maxim Zaytcev](https://github.com/neosheps) and contributors.
