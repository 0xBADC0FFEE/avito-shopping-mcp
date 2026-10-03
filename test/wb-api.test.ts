import { describe, expect, it } from "vitest";

import { isAllowedApiUrl, productCardUrl, productImageUrls, regionQuery, searchApiUrl } from "../src/wb-api.js";

const routes = [
  { volFrom: 0, volTo: 143, host: "basket-01.wbbasket.ru" },
  { volFrom: 12_000, volTo: 12_500, host: "basket-44.wbbasket.ru" },
];

describe("regionQuery", () => {
  it("keeps the region stored by Wildberries", () => {
    expect(regionQuery("appType=1&curr=rub&dest=1259570991&spp=30")).toBe("appType=1&curr=rub&dest=1259570991&spp=30");
  });

  it("falls back to Moscow when the stored region has no destination", () => {
    expect(regionQuery(undefined)).toContain("dest=-1257786");
    expect(regionQuery("curr=rub&dest=moscow")).toContain("dest=-1257786");
  });
});

describe("searchApiUrl", () => {
  it("lets filters override region parameters", () => {
    const url = new URL(searchApiUrl("curr=rub&dest=1&sort=popular", { query: "мышь", sort: "priceup" }));
    expect(url.searchParams.get("query")).toBe("мышь");
    expect(url.searchParams.getAll("sort")).toEqual(["priceup"]);
    expect(url.searchParams.get("dest")).toBe("1");
  });
});

describe("basket routing", () => {
  it("routes an article to the host serving its volume", () => {
    expect(productCardUrl(routes, 1_222_039_104)).toBe(
      "https://basket-44.wbbasket.ru/vol12220/part1222039/1222039104/info/ru/card.json",
    );
    expect(productImageUrls(routes, 12_345, 2)).toEqual([
      "https://basket-01.wbbasket.ru/vol0/part12/12345/images/big/1.webp",
      "https://basket-01.wbbasket.ru/vol0/part12/12345/images/big/2.webp",
    ]);
  });

  it("returns nothing for a volume no host serves", () => {
    expect(productCardUrl(routes, 500_000_000)).toBeNull();
    expect(productImageUrls(routes, 500_000_000, 3)).toEqual([]);
  });
});

describe("isAllowedApiUrl", () => {
  it("accepts only HTTPS Wildberries hosts", () => {
    expect(isAllowedApiUrl("https://feedbacks1.wb.ru/feedbacks/v2/1")).toBe(true);
    expect(isAllowedApiUrl("https://www.wildberries.ru/__internal/x")).toBe(true);
    expect(isAllowedApiUrl("http://feedbacks1.wb.ru/feedbacks/v2/1")).toBe(false);
    expect(isAllowedApiUrl("https://evilwb.ru/")).toBe(false);
    expect(isAllowedApiUrl("https://wb.ru.example.com/")).toBe(false);
  });
});
