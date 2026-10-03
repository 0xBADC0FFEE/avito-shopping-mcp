import { describe, expect, it } from "vitest";

import {
  parseBasketRoutes,
  parseCatalogProducts,
  parseFeedbackHost,
  parseProductCard,
  parseReviews,
} from "../src/parsers.js";

describe("parseCatalogProducts", () => {
  it("converts kopeck prices and picks the cheapest size", () => {
    const [product] = parseCatalogProducts({
      products: [
        {
          id: 1222039104,
          root: 2893516906,
          name: "Смартфон iPhone 15 128 ГБ",
          brand: "Apple",
          supplier: "Example Seller",
          supplierId: 1121282,
          supplierRating: 4.8,
          pics: 11,
          reviewRating: 4.9,
          rating: 5,
          feedbacks: 6,
          totalQuantity: 31,
          sizes: [
            { price: { basic: 11_486_300, product: 4_503_900 } },
            { price: { basic: 11_486_300, product: 4_203_950 } },
            { name: "sold out" },
          ],
        },
      ],
    });

    expect(product).toEqual({
      article: 1_222_039_104,
      rootId: 2_893_516_906,
      name: "Смартфон iPhone 15 128 ГБ",
      brand: "Apple",
      price: 42_040,
      oldPrice: 114_863,
      stock: 31,
      rating: 4.9,
      reviewCount: 6,
      seller: { id: 1_121_282, name: "Example Seller", rating: 4.8 },
      imageCount: 11,
    });
  });

  it("treats products without reviews as unrated and without discount as full price", () => {
    const [product] = parseCatalogProducts({
      products: [{ id: 1, rating: 0, reviewRating: 0, feedbacks: 0, sizes: [{ price: { basic: 1_000, product: 1_000 } }] }],
    });
    expect(product).toMatchObject({ rating: null, oldPrice: null, price: 10, stock: 0, seller: null });
  });

  it("skips entries without an article", () => {
    expect(parseCatalogProducts({ products: [{ name: "broken" }] })).toEqual([]);
    expect(parseCatalogProducts({})).toEqual([]);
  });
});

describe("parseProductCard", () => {
  it("extracts category, description, and characteristics", () => {
    expect(
      parseProductCard({
        subj_name: "Смартфоны",
        description: " Оригинальный смартфон ",
        options: [{ name: "Цвет", value: "голубой" }, { name: "Пустое", value: "" }, { value: "без имени" }],
      }),
    ).toEqual({ category: "Смартфоны", description: "Оригинальный смартфон", characteristics: { Цвет: "голубой" } });
  });
});

describe("parseBasketRoutes", () => {
  it("reads origin range routes and drops foreign hosts", () => {
    const routes = parseBasketRoutes({
      origin: {
        mediabasket_route_map: [
          {
            method: "range",
            hosts: [
              { vol_range_from: 0, vol_range_to: 143, host: "basket-01.wbbasket.ru" },
              { vol_range_from: 144, vol_range_to: 287, host: "basket.example.com" },
            ],
          },
        ],
      },
    });
    expect(routes).toEqual([{ volFrom: 0, volTo: 143, host: "basket-01.wbbasket.ru" }]);
  });
});

describe("parseFeedbackHost", () => {
  it("returns the first Wildberries review host", () => {
    expect(parseFeedbackHost(["https://example.com", "https://feedback-view-02.wb.ru"])).toBe(
      "https://feedback-view-02.wb.ru",
    );
    expect(parseFeedbackHost({})).toBeNull();
  });
});

describe("parseReviews", () => {
  it("returns the newest reviews first", () => {
    const result = parseReviews(
      {
        valuation: "4.5",
        feedbackCount: 819,
        feedbacks: [
          {
            wbUserDetails: { name: "Павел" },
            productValuation: 4,
            text: "Нормально",
            createdDate: "2026-07-01T10:00:00Z",
          },
          {
            wbUserDetails: { name: "Вероника" },
            productValuation: 5,
            text: "Всё работает",
            pros: "Быстро",
            color: "черный",
            createdDate: "2026-09-12T18:18:50Z",
            votes: { pluses: 7, minuses: 0 },
            photos: [{ key: "2/photo" }],
          },
        ],
      },
      1,
    );

    expect(result).toEqual({
      rating: 4.5,
      totalReviews: 819,
      count: 1,
      reviews: [
        {
          author: "Вероника",
          score: 5,
          comment: "Всё работает",
          pros: "Быстро",
          cons: "",
          variant: "черный",
          date: "2026-09-12",
          useful: 7,
          hasPhotos: true,
        },
      ],
    });
  });
});
