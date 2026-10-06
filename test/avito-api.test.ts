import { describe, expect, it } from "vitest";

import {
  isAllowedOutputUrl,
  isAllowedRequestUrl,
  locationsApiUrl,
  publicUrl,
  searchApiUrl,
  sellerRatingsUrl,
} from "../src/avito-api.js";

describe("searchApiUrl", () => {
  it("maps sort and price range to Avito parameters", () => {
    const url = new URL(
      searchApiUrl({ query: "кофемашина delonghi", locationId: 650_400, sort: "date", page: 2, priceMin: 5_000, priceMax: 60_000 }),
    );
    expect(url.origin + url.pathname).toBe("https://www.avito.ru/web/1/js/items");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "кофемашина delonghi",
      locationId: "650400",
      s: "104",
      p: "2",
      pmin: "5000",
      pmax: "60000",
    });
  });

  it("omits an open price bound", () => {
    const url = new URL(searchApiUrl({ query: "iphone", locationId: 637_640, sort: "discount", page: 1, priceMax: 100 }));
    expect(url.searchParams.get("s")).toBe("172297_desc");
    expect(url.searchParams.has("pmin")).toBe(false);
    expect(url.searchParams.get("pmax")).toBe("100");
  });
});

describe("locationsApiUrl", () => {
  it("queries location suggestions by Cyrillic name", () => {
    expect(new URL(locationsApiUrl("Казань")).searchParams.get("q")).toBe("Казань");
  });
});

describe("sellerRatingsUrl", () => {
  it("requests the newest reviews of a seller from the live ratings version", () => {
    const url = new URL(sellerRatingsUrl("badabb72"));
    expect(url.pathname).toBe("/web/7/user/badabb72/ratings");
    expect(url.searchParams.get("sortRating")).toBe("date_desc");
    expect(url.searchParams.get("offset")).toBe("0");
  });
});

describe("publicUrl", () => {
  it("resolves site paths and drops tracking parameters", () => {
    expect(publicUrl("/brands/03ce308a?src=search_seller_info&iid=1")).toBe("https://www.avito.ru/brands/03ce308a");
    expect(publicUrl("https://www.avito.ru/moskva/x_1?context=abc#top")).toBe("https://www.avito.ru/moskva/x_1");
  });

  it("rejects links outside Avito", () => {
    expect(publicUrl("https://example.com/brands/1")).toBeNull();
    expect(publicUrl("//example.com/x")).toBeNull();
    expect(publicUrl("http://www.avito.ru/x")).toBeNull();
  });
});

describe("host allowlists", () => {
  it("sends requests only to www.avito.ru over HTTPS", () => {
    expect(isAllowedRequestUrl("https://www.avito.ru/web/1/js/items")).toBe(true);
    expect(isAllowedRequestUrl("https://m.avito.ru/api/19/items/1")).toBe(false);
    expect(isAllowedRequestUrl("http://www.avito.ru/")).toBe(false);
    expect(isAllowedRequestUrl("https://www.avito.ru.example.com/")).toBe(false);
  });

  it("returns only Avito site and image CDN links", () => {
    expect(isAllowedOutputUrl("https://70.img.avito.st/image/1/1.abc")).toBe(true);
    expect(isAllowedOutputUrl("https://www.avito.ru/brands/1")).toBe(true);
    expect(isAllowedOutputUrl("https://evilavito.st/image")).toBe(false);
    expect(isAllowedOutputUrl("http://70.img.avito.st/image")).toBe(false);
  });
});
