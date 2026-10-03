# Contributing

Keep changes small, testable, and honest about live verification.

1. Create an issue describing the Wildberries behavior or schema change.
2. Add or update a synthetic fixture test without copying customer data, access tokens, or full live responses.
3. Run `npm run check` and `npm run build`.
4. State whether the change was verified live, and on which OS/browser combination.

Do not commit browser storage state, cookies, raw account data, or high-volume scraping features.
