import { describe, expect, it } from "vitest";

import { classifyResponse, isBlockPageTitle } from "../src/block-detection.js";
import { textFixture } from "./fixture.js";

describe("classifyResponse", () => {
  it("recognizes the Qrator proof-of-work challenge", () => {
    expect(classifyResponse({ status: 439, text: "<title>Доступ ограничен: проверка безопасности</title>" })).toBe(
      "challenge",
    );
  });

  it("recognizes the IP firewall page and the JSON throttle", () => {
    expect(classifyResponse({ status: 429, text: textFixture("block-429-ip-restricted.html") })).toBe("rate_limited");
    expect(classifyResponse({ status: 403, text: textFixture("block-429-ip-restricted.html") })).toBe("rate_limited");
    expect(classifyResponse({ status: 403, text: textFixture("block-403-too-many-requests.json") })).toBe(
      "rate_limited",
    );
  });

  it("treats other auth failures as a rejected session", () => {
    expect(classifyResponse({ status: 403, text: '{"error":"forbidden"}' })).toBe("session_rejected");
    expect(classifyResponse({ status: 401, text: "" })).toBe("session_rejected");
  });

  it("does not mistake listing text for a block", () => {
    expect(classifyResponse({ status: 200, text: '{"title":"too-many-requests firewall-container"}' })).toBe("ok");
    expect(classifyResponse({ status: 404, text: "<p>too-many-requests</p>" })).toBe("not_found");
    expect(classifyResponse({ status: 0, text: "" })).toBe("unexpected");
  });
});

describe("isBlockPageTitle", () => {
  it("matches Avito access-restriction titles only", () => {
    expect(isBlockPageTitle("Доступ ограничен: проблема с IP")).toBe(true);
    expect(isBlockPageTitle("Авито: сайт объявлений")).toBe(false);
  });
});
