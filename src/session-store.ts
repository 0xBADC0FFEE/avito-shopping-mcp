import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BrowserContext } from "playwright";

import { WbMcpError } from "./errors.js";

export type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface PersistedSession {
  schemaVersion: 1;
  createdAt: string;
  browserChannel: string;
  userAgent: string;
  storageState: BrowserStorageState;
}

export interface StoredSessionInfo {
  exists: boolean;
  createdAt?: string;
  ageSeconds?: number;
  path: string;
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSession>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.browserChannel === "string" &&
    typeof candidate.userAgent === "string" &&
    !!candidate.storageState &&
    typeof candidate.storageState === "object" &&
    Array.isArray(candidate.storageState.cookies) &&
    Array.isArray(candidate.storageState.origins)
  );
}

export class SessionStore {
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedSession> {
    let raw: string;
    try {
      if (process.platform !== "win32") {
        const mode = (await stat(this.path)).mode & 0o777;
        if ((mode & 0o077) !== 0) {
          throw new WbMcpError(
            "SESSION_REQUIRED",
            "The saved Wildberries session has unsafe filesystem permissions. Run setup again.",
          );
        }
      }
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new WbMcpError(
          "SESSION_REQUIRED",
          "No Wildberries browser session found. Run `wb-shopping-mcp setup` first.",
        );
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new WbMcpError("SESSION_REQUIRED", "The saved Wildberries session is not valid JSON. Run setup again.", {
        cause: error,
      });
    }

    if (!isPersistedSession(parsed)) {
      throw new WbMcpError("SESSION_REQUIRED", "The saved Wildberries session has an unsupported format. Run setup again.");
    }
    return parsed;
  }

  async save(session: PersistedSession): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);

    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600).catch(() => undefined);
  }

  async info(): Promise<StoredSessionInfo> {
    try {
      const stored = await this.load();
      const createdAt = Date.parse(stored.createdAt);
      return {
        exists: true,
        createdAt: stored.createdAt,
        ...(Number.isFinite(createdAt)
          ? { ageSeconds: Math.max(0, Math.round((Date.now() - createdAt) / 1000)) }
          : {}),
        path: this.path,
      };
    } catch (error) {
      if (error instanceof WbMcpError && error.code === "SESSION_REQUIRED") {
        return { exists: false, path: this.path };
      }
      throw error;
    }
  }

  async mode(): Promise<number | null> {
    try {
      return (await stat(this.path)).mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
