import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";

import type { RuntimeConfig } from "./config.js";
import { WbMcpError } from "./errors.js";
import { SerialQueue } from "./serial-queue.js";
import { SessionStore } from "./session-store.js";
import type { PersistedSession } from "./session-store.js";
import { isAllowedApiUrl, regionQuery, SESSION_PROBE_URL, WB_HOME_URL } from "./wb-api.js";

// Same-origin API calls are rejected by the anti-bot layer without this id as the `deviceid` header.
const DEVICE_ID_STORAGE_KEY = "wbx__sessionID";
const GEO_DATA_STORAGE_KEY = "geo-data-v1-0";
// 498 is the anti-bot "challenge required" status.
const SESSION_REJECTED_STATUSES = new Set([401, 403, 498]);

interface RawApiResponse {
  status: number;
  text: string;
  requestError?: string;
}

export interface SetupResult {
  createdAt: string;
  browserChannel: string;
  stored: true;
  cookieCount: number;
}

export interface LiveSessionCheck {
  ok: boolean;
  status?: number;
  error?: string;
}

type ProgressReporter = (message: string) => void;

export class WbBrowserSession {
  private readonly store: SessionStore;
  private readonly queue = new SerialQueue();
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private lastRequestAt = 0;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: RuntimeConfig) {
    this.store = new SessionStore(config.stateFile);
  }

  async setup(timeoutMs = 120_000, report: ProgressReporter = () => undefined): Promise<SetupResult> {
    await this.close();
    report("Opening a temporary Chrome window for Wildberries session setup…");

    const browser = await this.launch(false);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
    });
    const page = await context.newPage();

    try {
      await page.goto(WB_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: this.config.navigationTimeoutMs,
      });

      const deadline = Date.now() + timeoutMs;
      let lastStatus: number | undefined;
      while (Date.now() < deadline) {
        if (page.isClosed()) {
          throw new WbMcpError("REQUEST_FAILED", "The setup browser window was closed before Wildberries became ready.");
        }

        await page.waitForTimeout(1_500);
        const probe = await this.rawApiRequest(page, SESSION_PROBE_URL);
        lastStatus = probe.status || lastStatus;
        if (probe.status === 200) {
          const createdAt = new Date().toISOString();
          const userAgent = await page.evaluate(() => navigator.userAgent);
          const storageState = await context.storageState();
          const session: PersistedSession = {
            schemaVersion: 1,
            createdAt,
            browserChannel: this.config.browserChannel,
            userAgent,
            storageState,
          };
          await this.store.save(session);
          report("Wildberries session is ready and stored locally.");
          return {
            createdAt,
            browserChannel: this.config.browserChannel,
            stored: true,
            cookieCount: storageState.cookies.length,
          };
        }
      }

      throw new WbMcpError(
        "WB_BLOCKED",
        `Wildberries did not provide a usable session within ${Math.ceil(timeoutMs / 1000)} seconds${lastStatus ? ` (last HTTP status: ${lastStatus})` : ""}.`,
      );
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async requestJson(url: string): Promise<unknown> {
    if (!isAllowedApiUrl(url)) {
      throw new WbMcpError("REQUEST_FAILED", "Refusing to request a host outside Wildberries.");
    }

    return this.queue.run(async () => {
      const page = await this.ensureHeadlessPage();
      await this.waitForRequestSlot();
      const response = await this.rawApiRequest(page, url);
      this.lastRequestAt = Date.now();
      this.armIdleTimer();

      if (SESSION_REJECTED_STATUSES.has(response.status)) {
        await this.close();
        throw new WbMcpError(
          "SESSION_EXPIRED",
          `Wildberries rejected the saved browser session with HTTP ${response.status}. Run \`wb-shopping-mcp setup\` again.`,
        );
      }
      if (response.status !== 200) {
        throw new WbMcpError(
          "REQUEST_FAILED",
          response.requestError
            ? `Wildberries request failed: ${response.requestError}`
            : `Wildberries returned unexpected HTTP ${response.status}.`,
        );
      }

      try {
        return JSON.parse(response.text) as unknown;
      } catch (error) {
        throw new WbMcpError("WB_RESPONSE_INVALID", "Wildberries returned a response that is not valid JSON.", {
          cause: error,
        });
      }
    });
  }

  /**
   * Reads the delivery region selected in the saved session; prices and stock depend on it.
   * @returns API query parameters for currency and delivery destination.
   */
  async regionQuery(): Promise<string> {
    return this.queue.run(async () => {
      const page = await this.ensureHeadlessPage();
      const xinfo = await page.evaluate((key) => {
        try {
          return (JSON.parse(localStorage.getItem(key) ?? "null") as { data?: { xinfo?: unknown } } | null)?.data?.xinfo;
        } catch {
          return undefined;
        }
      }, GEO_DATA_STORAGE_KEY);
      return regionQuery(xinfo);
    });
  }

  async checkLive(): Promise<LiveSessionCheck> {
    try {
      const page = await this.ensureHeadlessPage();
      const response = await this.rawApiRequest(page, SESSION_PROBE_URL);
      this.armIdleTimer();
      if (response.status === 200) return { ok: true, status: 200 };
      return { ok: false, status: response.status, error: `Wildberries returned HTTP ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  sessionInfo() {
    return this.store.info();
  }

  sessionMode() {
    return this.store.mode();
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;

    const context = this.context;
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;

    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  private async launch(headless: boolean): Promise<Browser> {
    const options: LaunchOptions = {
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
      ...(this.config.executablePath ? { executablePath: this.config.executablePath } : {}),
      ...(this.config.browserChannel === "chromium" ? {} : { channel: this.config.browserChannel }),
    };

    try {
      const browser = await chromium.launch(options);
      browser.on("disconnected", () => {
        if (this.browser === browser) {
          this.page = undefined;
          this.context = undefined;
          this.browser = undefined;
        }
      });
      return browser;
    } catch (error) {
      throw new WbMcpError(
        "BROWSER_UNAVAILABLE",
        `Could not launch ${this.config.browserChannel}. Install the browser or set WB_MCP_BROWSER_CHANNEL/WB_MCP_EXECUTABLE_PATH.`,
        { cause: error },
      );
    }
  }

  private async ensureHeadlessPage(): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.browser?.isConnected()) {
      return this.page;
    }

    const saved = await this.store.load();
    const browser = await this.launch(true);
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "ru-RU",
        userAgent: saved.userAgent,
        storageState: saved.storageState,
      });
      const page = await context.newPage();
      await page.goto(WB_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: this.config.navigationTimeoutMs,
      });
      await page.waitForTimeout(1_000);

      const probe = await this.rawApiRequest(page, SESSION_PROBE_URL);
      if (probe.status !== 200) {
        await context.close().catch(() => undefined);
        throw new WbMcpError(
          "SESSION_EXPIRED",
          `The saved Wildberries session is no longer accepted (HTTP ${probe.status}). Run \`wb-shopping-mcp setup\` again.`,
        );
      }

      this.browser = browser;
      this.context = context;
      this.page = page;
      this.armIdleTimer();
      return page;
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  private async rawApiRequest(page: Page, url: string): Promise<RawApiResponse> {
    const timeoutMs = this.config.requestTimeoutMs;
    return page.evaluate(
      async ({ requestUrl, timeout, deviceIdKey }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const headers: Record<string, string> = { accept: "application/json" };
        const deviceId = localStorage.getItem(deviceIdKey);
        if (deviceId && new URL(requestUrl).origin === location.origin) headers.deviceid = deviceId;
        try {
          const response = await fetch(requestUrl, { headers, signal: controller.signal });
          return { status: response.status, text: await response.text() };
        } catch (error) {
          return {
            status: 0,
            text: "",
            requestError: error instanceof Error ? error.message : String(error),
          };
        } finally {
          clearTimeout(timer);
        }
      },
      { requestUrl: url, timeout: timeoutMs, deviceIdKey: DEVICE_ID_STORAGE_KEY },
    );
  }

  private async waitForRequestSlot(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const remaining = this.config.minimumRequestIntervalMs - elapsed;
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.config.idleTimeoutMs);
    this.idleTimer.unref();
  }
}
