import { describe, expect, it } from "vitest";

import { OzonMcpError } from "../src/errors.js";
import { buildSearchPath, normalizeProductPath } from "../src/ozon-client.js";

describe("normalizeProductPath", () => {
  it("supports SKUs, slugs, and Ozon URLs", () => {
    expect(normalizeProductPath("1681720585")).toBe("/product/1681720585/");
    expect(normalizeProductPath("iphone-1681720585")).toBe("/product/iphone-1681720585/");
    expect(normalizeProductPath("https://www.ozon.ru/product/iphone-1681720585/?at=x")).toBe(
      "/product/iphone-1681720585/",
    );
  });

  it("rejects non-Ozon and non-product URLs", () => {
    expect(() => normalizeProductPath("https://example.com/product/1681720585")).toThrow(OzonMcpError);
    expect(() => normalizeProductPath("http://www.ozon.ru/product/1681720585")).toThrow(OzonMcpError);
    expect(() => normalizeProductPath("https://seller.ozon.ru/product/1681720585")).toThrow(OzonMcpError);
    expect(() => normalizeProductPath("https://www.ozon.ru/category/telefony/")).toThrow(OzonMcpError);
    expect(() => normalizeProductPath("https://www.ozon.ru/product/good%2Freviews")).toThrow(OzonMcpError);
    expect(() => normalizeProductPath("product/valid/extra")).toThrow(OzonMcpError);
  });
});

describe("buildSearchPath", () => {
  it("encodes filters and sort order", () => {
    const path = buildSearchPath({ query: "iphone 15", sort: "price", priceMin: 10_000, priceMax: 80_000 });
    expect(path).toContain("text=iphone+15");
    expect(path).toContain("sorting=price");
    expect(path).toContain("currency_price=10000.000%3B80000.000");
  });

  it("rejects an inverted price range", () => {
    expect(() => buildSearchPath({ query: "phone", priceMin: 10, priceMax: 5 })).toThrow(OzonMcpError);
  });

  it("rejects an excessively long search query", () => {
    expect(() => buildSearchPath({ query: "x".repeat(201) })).toThrow(OzonMcpError);
  });
});
