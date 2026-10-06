import { describe, expect, it } from "vitest";

import { AvitoMcpError } from "../src/errors.js";
import { buildSearchFilters, parseArticle } from "../src/avito-client.js";

describe("parseArticle", () => {
  it("supports article numbers and Wildberries product URLs", () => {
    expect(parseArticle("1222039104")).toBe(1_222_039_104);
    expect(parseArticle("https://www.wildberries.ru/catalog/1222039104/detail.aspx?size=1798158794")).toBe(1_222_039_104);
    expect(parseArticle("https://wildberries.ru/catalog/1222039104/detail.aspx")).toBe(1_222_039_104);
  });

  it("rejects non-Wildberries and non-product inputs", () => {
    expect(() => parseArticle("https://example.com/catalog/1222039104/detail.aspx")).toThrow(AvitoMcpError);
    expect(() => parseArticle("http://www.wildberries.ru/catalog/1222039104/detail.aspx")).toThrow(AvitoMcpError);
    expect(() => parseArticle("https://seller.wildberries.ru/catalog/1222039104/detail.aspx")).toThrow(AvitoMcpError);
    expect(() => parseArticle("https://www.wildberries.ru/catalog/elektronika/smartfony")).toThrow(AvitoMcpError);
    expect(() => parseArticle("iphone-15")).toThrow(AvitoMcpError);
    expect(() => parseArticle("0")).toThrow(AvitoMcpError);
    expect(() => parseArticle("99999999999999999999")).toThrow(AvitoMcpError);
  });
});

describe("buildSearchFilters", () => {
  it("maps sort order and converts the price range to kopecks", () => {
    expect(buildSearchFilters({ query: " iphone 15 ", sort: "price", priceMin: 10_000, priceMax: 80_000 })).toEqual({
      query: "iphone 15",
      sort: "priceup",
      priceU: "1000000;8000000",
    });
  });

  it("leaves an open price bound unlimited", () => {
    expect(buildSearchFilters({ query: "phone", priceMin: 500 }).priceU).toBe("50000;9999999900");
    expect(buildSearchFilters({ query: "phone" })).not.toHaveProperty("priceU");
  });

  it("rejects an inverted price range", () => {
    expect(() => buildSearchFilters({ query: "phone", priceMin: 10, priceMax: 5 })).toThrow(AvitoMcpError);
  });

  it("rejects an excessively long search query", () => {
    expect(() => buildSearchFilters({ query: "x".repeat(201) })).toThrow(AvitoMcpError);
  });
});
