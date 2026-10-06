import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvitoBrowserSession, RATE_LIMIT_BACKOFF_MINUTES } from "../src/browser-session.js";
import type { RuntimeConfig } from "../src/config.js";
import { SessionStore } from "../src/session-store.js";
import type { PersistedSession } from "../src/session-store.js";
import { textFixture } from "./fixture.js";

const MS_PER_MINUTE = 60_000;
const PROBE_URL = "https://www.avito.ru/web/1/slocations?limit=1&q=x";

const avito = vi.hoisted(() => ({ evaluate: vi.fn() }));

vi.mock("playwright", () => {
  const page = {
    goto: async () => null,
    waitForTimeout: async () => undefined,
    waitForFunction: async () => undefined,
    isClosed: () => false,
    evaluate: avito.evaluate,
  };
  const context = { newPage: async () => page, close: async () => undefined };
  const browser = {
    newContext: async () => context,
    close: async () => undefined,
    isConnected: () => true,
    on: () => browser,
  };
  return { chromium: { launch: async () => browser }, errors: { TimeoutError: Error } };
});

function storedSession(createdAt: Date): PersistedSession {
  return {
    schemaVersion: 1,
    createdAt: createdAt.toISOString(),
    browserChannel: "chrome",
    userAgent: "test",
    storageState: { cookies: [], origins: [] },
  };
}

describe("AvitoBrowserSession rate-limit backoff", () => {
  let stateDir: string;
  let store: SessionStore;
  let session: AvitoBrowserSession;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "avito-mcp-"));
    const config: RuntimeConfig = {
      browserChannel: "chrome",
      stateDir,
      stateFile: join(stateDir, "session.json"),
      requestTimeoutMs: 1_000,
      minimumRequestIntervalMs: 1,
      idleTimeoutMs: MS_PER_MINUTE,
      navigationTimeoutMs: 1_000,
    };
    store = new SessionStore(config.stateFile);
    await store.save(storedSession(new Date(Date.now() - MS_PER_MINUTE)));
    session = new AvitoBrowserSession(config);
    vi.spyOn(Math, "random").mockReturnValue(0);
    avito.evaluate.mockReset();
    avito.evaluate.mockResolvedValueOnce({ status: 429, text: textFixture("block-403-too-many-requests.json"), url: PROBE_URL });
  });

  afterEach(async () => {
    await session.close();
    vi.restoreAllMocks();
    await rm(stateDir, { recursive: true, force: true });
  });

  it("fails fast after a rate limit without contacting Avito", async () => {
    await expect(session.requestJson(PROBE_URL)).rejects.toMatchObject({ code: "AVITO_RATE_LIMITED" });

    await expect(session.requestJson(PROBE_URL)).rejects.toMatchObject({
      code: "AVITO_RATE_LIMITED",
      message: expect.stringContaining(`${RATE_LIMIT_BACKOFF_MINUTES} more minutes`),
    });
    expect(avito.evaluate).toHaveBeenCalledTimes(1);
  });

  it("resumes once a newer session is stored", async () => {
    await expect(session.requestJson(PROBE_URL)).rejects.toMatchObject({ code: "AVITO_RATE_LIMITED" });
    await store.save(storedSession(new Date(Date.now() + 1)));
    avito.evaluate.mockResolvedValueOnce({ status: 200, text: "{}", url: PROBE_URL });

    await expect(session.requestJson(PROBE_URL)).resolves.toEqual({});
  });
});
