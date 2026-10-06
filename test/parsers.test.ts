import { describe, expect, it } from "vitest";

import { at } from "../src/json-fields.js";
import { parseLocations, parseRatingsPage, parseSearchPage } from "../src/parsers.js";
import { jsonFixture } from "./fixture.js";

const INVALID_RESPONSE = { code: "AVITO_RESPONSE_INVALID" };

describe("parseSearchPage", () => {
  const response = jsonFixture("search-web1-js-items.json");

  it("extracts listings with absolute URLs, ISO timestamps, and the seller block", () => {
    const page = parseSearchPage(response);
    expect(page.totalCount).toBe(600);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual({
      id: 8_457_820_574,
      title: "Кофемашина delonghi magnifica rapid cappuccino",
      price: 14_000,
      priceText: "14 000 ₽",
      url: "https://www.avito.ru/moskva/bytovaya_tehnika/kofemashina_delonghi_magnifica_rapid_cappuccino_8457820574",
      location: null,
      publishedAt: "2026-10-06T18:11:34.000Z",
      image: expect.stringMatching(/^https:\/\/b00\.img\.avito\.st\/image\//),
      seller: {
        name: "<public seller first name>",
        url: "https://www.avito.ru/brands/03ce308a3e5989378d53c4f1b2f80718",
        rating: 5,
      },
    });
  });

  it("leaves the seller empty when Avito shows no seller block", () => {
    expect(parseSearchPage(response).items[1]).toMatchObject({ id: 8_544_880_758, price: 9_500, seller: null });
  });

  it("skips non-listing entries and reports a missing price", () => {
    const page = parseSearchPage({
      totalCount: 1,
      catalog: {
        items: [
          { type: "banner" },
          { type: "item", id: 1, title: "Диван", urlPath: "/kazan/mebel/divan_1", priceDetailed: { hasValue: false, fullString: "Цена не указана" } },
        ],
      },
    });
    expect(page.items).toEqual([expect.objectContaining({ id: 1, price: null, priceText: "Цена не указана", publishedAt: null })]);
  });

  it("names the missing path when the format changes", () => {
    expect(() => parseSearchPage({ url: "/moskva" })).toThrow(expect.objectContaining(INVALID_RESPONSE));
    expect(() => parseSearchPage({ url: "/moskva" })).toThrow(/catalog\.items/);
    expect(() => parseSearchPage({ totalCount: 1, catalog: { items: [{ type: "item", title: "x" }] } })).toThrow(
      /catalog\.items\[0\]\.id/,
    );
  });
});

describe("parseLocations", () => {
  it("reads location ids and names", () => {
    expect(parseLocations(at(jsonFixture("slocations-web1.json"), "kazan"))).toEqual([
      { id: 650_400, name: "Казань" },
      { id: 650_130, name: "Республика Татарстан" },
    ]);
  });

  it("rejects a response without a location list", () => {
    expect(() => parseLocations({ result: {} })).toThrow(/result\.locations/);
  });
});

describe("parseRatingsPage", () => {
  const page = parseRatingsPage(jsonFixture("seller-ratings-web7.json"));

  it("summarizes the seller rating", () => {
    expect(page.summary).toEqual({
      score: 5,
      reviewCount: 155,
      distribution: [
        { score: 5, count: 154 },
        { score: 4, count: 1 },
        { score: 3, count: 0 },
        { score: 2, count: 0 },
        { score: 1, count: 0 },
      ],
    });
  });

  it("reads reviews with the reviewer role, deal stage, and seller answer", () => {
    expect(page.reviews).toHaveLength(3);
    expect(page.reviews[0]).toEqual({
      score: 5,
      date: "сегодня",
      role: "Продавец",
      itemTitle: null,
      stage: null,
      text: "Всё отлично 👍 Покупателя рекомендую",
      answer: null,
    });
    expect(page.reviews[2]).toMatchObject({
      role: "Покупатель",
      itemTitle: "Велосипед Paruisi U8 26''",
      stage: "Сделка сорвалась",
      answer: "Спасибо большое",
    });
  });

  it("exposes the next page link until the last page", () => {
    expect(page.nextPage).toMatch(/^\/web\/7\/user\/[0-9a-f]+\/ratings\?.*offset=25/);
    expect(parseRatingsPage({ entries: [] })).toEqual({ summary: null, reviews: [], nextPage: null });
  });
});
