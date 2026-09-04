import { describe, expect, it } from "vitest";

import { parseMoney, parseProduct, parseReviews, parseSearch } from "../src/parsers.js";

function pageWith(widgets: Record<string, unknown>) {
  return {
    widgetStates: Object.fromEntries(Object.entries(widgets).map(([key, value]) => [`${key}-fixture-1`, JSON.stringify(value)])),
  };
}

describe("parseMoney", () => {
  it("normalizes formatted ruble prices", () => {
    expect(parseMoney("57 158 ₽")).toBe(57_158);
    expect(parseMoney("not a price")).toBeNull();
  });
});

describe("parseSearch", () => {
  it("parses product tiles without treating badges as brands", () => {
    const page = pageWith({
      tileGridDesktop: {
        items: [
          {
            sku: "1681720585",
            action: { link: "/product/iphone-1681720585/?at=tracking" },
            tileImage: { items: [{ image: { link: "https://cdn.example/image.jpg" } }] },
            mainState: [
              {
                type: "priceV2",
                priceV2: {
                  price: [
                    { textStyle: "PRICE", text: "57 158 ₽" },
                    { textStyle: "ORIGINAL_PRICE", text: "79 725 ₽" },
                  ],
                  discount: "−28%",
                },
              },
              { id: "name", textDS: { text: "Apple iPhone 15" } },
              {
                labelListV2: {
                  items: [
                    { type: "icon", icon: { name: "star" } },
                    { type: "text", text: { text: "5" } },
                    { type: "text", text: { text: "3 422 отзыва" } },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(parseSearch(page, 3)).toEqual([
      {
        sku: "1681720585",
        name: "Apple iPhone 15",
        price: 57_158,
        oldPrice: 79_725,
        discount: "−28%",
        rating: 5,
        reviewCount: 3_422,
        url: "https://www.ozon.ru/product/iphone-1681720585/",
        image: "https://cdn.example/image.jpg",
      },
    ]);
  });
});

describe("parseProduct", () => {
  it("accepts integer ratings and extracts the current product fields", () => {
    const page = {
      ...pageWith({
        webProductHeading: { title: "Apple iPhone 15" },
        webPrice: { cardPrice: "57 158 ₽", price: "60 533 ₽", originalPrice: "79 725 ₽", isAvailable: true },
        webGallery: { sku: "1681720585", coverImage: "cover.jpg", images: [{ src: "second.jpg" }] },
        webSingleProductScore: { text: "5 • 3 422 отзыва" },
        webCurrentSeller: {
          sellerCell: {
            centerBlock: { title: { text: "Example Seller" } },
            common: { action: { link: "/seller/example/" } },
          },
          rating: { title: { text: "4,9" } },
        },
        webShortCharacteristics: {
          characteristics: [{ title: { textRs: [{ text: "Цвет" }] }, values: [{ text: "чёрный" }] }],
        },
      }),
      seo: { link: [{ href: "/product/iphone-1681720585/?tracking=1" }] },
    };

    const product = parseProduct(page);
    expect(product.rating).toBe(5);
    expect(product.reviewCount).toBe(3_422);
    expect(product.seller?.name).toBe("Example Seller");
    expect(product.characteristics).toEqual({ Цвет: "чёрный" });
    expect(product.url).toBe("https://www.ozon.ru/product/iphone-1681720585/");
  });
});

describe("parseReviews", () => {
  it("parses review content and unix dates", () => {
    const page = pageWith({
      webReviewProductScore: { totalScore: 5, reviewsCount: 819 },
      webListReviews: {
        reviews: [
          {
            author: { title: "Павел" },
            content: { score: 5, comment: "Всё работает", positive: "Быстро", photos: [{}] },
            publishedAt: 1_747_526_400,
            usefulness: { useful: 7 },
            isItemPurchased: true,
          },
        ],
      },
    });

    const result = parseReviews(page, 10);
    expect(result.rating).toBe(5);
    expect(result.totalReviews).toBe(819);
    expect(result.reviews[0]).toMatchObject({
      author: "Павел",
      score: 5,
      comment: "Всё работает",
      pros: "Быстро",
      purchased: true,
      hasPhotos: true,
    });
  });
});
