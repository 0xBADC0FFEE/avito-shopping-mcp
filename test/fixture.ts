import { readFileSync } from "node:fs";

export function textFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function jsonFixture(name: string): unknown {
  return JSON.parse(textFixture(name)) as unknown;
}

export function itemPageHtml(buyerItem: unknown): string {
  const state = { loaderData: { "catalog-or-main-or-item": { buyerItem } } };
  return `<html><body><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(state))});</script></body></html>`;
}
