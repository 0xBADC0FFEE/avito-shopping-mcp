import { describe, expect, it } from "vitest";

import { htmlToText, parseItem, parseSellerUserKey, readBuyerItem } from "../src/item-page.js";
import { at } from "../src/json-fields.js";
import { jsonFixture } from "./fixture.js";

const PAGE_URL = "https://www.avito.ru/moskva/bytovaya_tehnika/kofemashina_delonghi_magnifica_rapid_cappuccino_8457820574";

function itemPageHtml(buyerItem: unknown): string {
  const state = { loaderData: { "catalog-or-main-or-item": { buyerItem } } };
  return `<html><body><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(state))});</script></body></html>`;
}

describe("readBuyerItem", () => {
  const buyerItem = readBuyerItem(itemPageHtml(at(jsonFixture("item-hydration-buyerItem.json"), "buyerItem")));

  it("decodes the double-encoded hydration state into listing details", () => {
    expect(parseItem(buyerItem, PAGE_URL)).toEqual({
      id: 8_457_820_574,
      title: "Кофемашина delonghi magnifica rapid cappuccino",
      url: PAGE_URL,
      active: true,
      price: 14_000,
      priceText: "14 000 ₽",
      description: expect.stringMatching(/^Кофе машина Делонги , регулярное/),
      characteristics: [
        { name: "Состояние", value: "Б/у" },
        { name: "Тип кофемашины", value: "Автоматическая" },
        { name: "Производитель", value: "Delonghi" },
      ],
      address: "Москва, ул. Охотный Ряд",
      coords: { lat: 55.757_537_84, lng: 37.616_413_12 },
      images: [expect.stringMatching(/^https:\/\/b00\.img\.avito\.st\/image\//)],
      publishedText: "сегодня в 21:11",
      views: { total: 0, today: 0 },
      seller: {
        name: "<public seller first name>",
        isCompany: false,
        type: "Частное лицо",
        replyTimeText: "Отвечает за несколько часов",
        tenureSince: "марта 2015",
        rating: { score: 5, summary: "155 отзывов" },
        url: "https://www.avito.ru/brands/03ce308a3e5989378d53c4f1b2f80718",
      },
    });
  });

  it("finds the seller key used by the reviews endpoint", () => {
    expect(parseSellerUserKey(buyerItem)).toBe("badabb72359d5efbfcfa34413989c41d0cef27381d6000072e45cd298ea3c607");
  });

  it("names the missing path when the item lacks required fields", () => {
    expect(() => parseItem({ item: { id: 1 } }, PAGE_URL)).toThrow(/buyerItem\.item\.title/);
    expect(() => parseSellerUserKey({})).toThrow(expect.objectContaining({ code: "AVITO_RESPONSE_INVALID" }));
  });
});

describe("readBuyerItem on unexpected pages", () => {
  it("rejects pages without hydration data", () => {
    expect(() => readBuyerItem("<title>Доступ ограничен</title>")).toThrow(/__staticRouterHydrationData/);
  });

  it("rejects hydration data for a non-item route", () => {
    const html = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify({ loaderData: { main: {} } }))});</script>`;
    expect(() => readBuyerItem(html)).toThrow(/buyerItem/);
  });
});

describe("htmlToText", () => {
  it("keeps paragraph and list structure and decodes entities", () => {
    expect(htmlToText("<p>Состояние&nbsp;отличное</p><p>В&nbsp;комплекте:<br>кабель &amp; чехол</p><ul><li>гарантия</li></ul>")).toBe(
      "Состояние отличное\nВ комплекте:\nкабель & чехол\n• гарантия",
    );
    expect(htmlToText("&#1055;&#x440;и")).toBe("При");
    expect(htmlToText("<p> </p>")).toBeNull();
  });
});
