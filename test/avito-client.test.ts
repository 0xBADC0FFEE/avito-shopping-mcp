import { describe, expect, it } from "vitest";

import { MAX_QUERY_LENGTH, parseItemId, validSearchQuery } from "../src/avito-client.js";

describe("parseItemId", () => {
  it("accepts listing ids and Avito listing URLs", () => {
    expect(parseItemId(" 8457820574 ")).toBe(8_457_820_574);
    expect(
      parseItemId("https://www.avito.ru/moskva/bytovaya_tehnika/kofemashina_delonghi_magnifica_rapid_cappuccino_8457820574?context=x"),
    ).toBe(8_457_820_574);
    expect(parseItemId("https://avito.ru/8457820574")).toBe(8_457_820_574);
    expect(parseItemId("https://m.avito.ru/kazan/telefony/iphone_15_123/")).toBe(123);
  });

  it.each([
    "https://example.com/moskva/telefony/iphone_123",
    "http://www.avito.ru/moskva/telefony/iphone_123",
    "https://www.avito.ru/moskva/telefony",
    "https://www.avito.ru/brands/03ce308a3e5989378d53c4f1b2f80718",
    "https://www.avito.ru/moskva/telefony/iphone",
    "iphone_123",
    "0",
    "99999999999999999999",
  ])("rejects %s", (input) => {
    expect(() => parseItemId(input)).toThrow(expect.objectContaining({ code: "INVALID_ITEM" }));
  });
});

describe("validSearchQuery", () => {
  it("trims the query", () => {
    expect(validSearchQuery({ query: "  iphone 15 " })).toBe("iphone 15");
  });

  it.each([
    { query: "phone", priceMin: 10, priceMax: 5 },
    { query: "x".repeat(MAX_QUERY_LENGTH + 1) },
    { query: "   " },
  ])("rejects invalid input %#", (input) => {
    expect(() => validSearchQuery(input)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
