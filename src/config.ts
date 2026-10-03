import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type BrowserChannel = "chrome" | "chromium" | "msedge";

export interface RuntimeConfig {
  browserChannel: BrowserChannel;
  executablePath?: string;
  stateDir: string;
  stateFile: string;
  requestTimeoutMs: number;
  minimumRequestIntervalMs: number;
  idleTimeoutMs: number;
  navigationTimeoutMs: number;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function defaultStateDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "wb-shopping-mcp");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "wb-shopping-mcp");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "wb-shopping-mcp");
}

function browserChannel(): BrowserChannel {
  const value = process.env.WB_MCP_BROWSER_CHANNEL ?? "chrome";
  if (value === "chrome" || value === "chromium" || value === "msedge") return value;
  throw new Error("WB_MCP_BROWSER_CHANNEL must be chrome, chromium, or msedge");
}

export function loadConfig(): RuntimeConfig {
  const stateDir = resolve(process.env.WB_MCP_STATE_DIR ?? defaultStateDir());
  const executablePath = process.env.WB_MCP_EXECUTABLE_PATH?.trim();

  return {
    browserChannel: browserChannel(),
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    stateDir,
    stateFile: join(stateDir, "session.json"),
    requestTimeoutMs: positiveInteger("WB_MCP_REQUEST_TIMEOUT_MS", 30_000),
    minimumRequestIntervalMs: positiveInteger("WB_MCP_MIN_REQUEST_INTERVAL_MS", 750),
    idleTimeoutMs: positiveInteger("WB_MCP_IDLE_TIMEOUT_MS", 5 * 60_000),
    navigationTimeoutMs: positiveInteger("WB_MCP_NAVIGATION_TIMEOUT_MS", 90_000),
  };
}
