import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionStore } from "../src/session-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SessionStore", () => {
  it("writes parseable session state with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wb-shopping-mcp-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "session.json");
    const store = new SessionStore(path);
    await store.save({
      schemaVersion: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      browserChannel: "chrome",
      userAgent: "test-agent",
      storageState: { cookies: [], origins: [] },
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ schemaVersion: 1, userAgent: "test-agent" });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(process.platform === "win32")("rejects session state readable by other users", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wb-shopping-mcp-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "session.json");
    const store = new SessionStore(path);
    await store.save({
      schemaVersion: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      browserChannel: "chrome",
      userAgent: "test-agent",
      storageState: { cookies: [], origins: [] },
    });
    await chmod(path, 0o644);

    await expect(store.load()).rejects.toMatchObject({ code: "SESSION_REQUIRED" });
  });
});
