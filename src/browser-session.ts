import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";

import { AVITO_HOME_URL, isAllowedRequestUrl, SESSION_PROBE_URL } from "./avito-api.js";
import { BLOCK_PAGE_TITLE_PREFIX, classifyResponse, isBlockPageTitle } from "./block-detection.js";
import type { ResponseVerdict } from "./block-detection.js";
import type { RuntimeConfig } from "./config.js";
import { AvitoMcpError, safeError } from "./errors.js";
import { SerialQueue } from "./serial-queue.js";
import { SessionStore } from "./session-store.js";
import type { PersistedSession } from "./session-store.js";

const VIEWPORT = { width: 1440, height: 900 };
const LOCALE = "ru-RU";
const SETUP_POLL_INTERVAL_MS = 2_000;
const SETUP_PROBE_INTERVAL_MS = 10_000;
const HOME_SETTLE_MS = 1_000;
const CHALLENGE_TIMEOUT_MS = 20_000;
const MAX_REQUEST_JITTER_MS = 2_000;
const SETUP_COMMAND = "`avito-shopping-mcp setup`";
const ACCEPT_HEADERS = { json: "application/json", html: "text/html" } as const;

type ContentType = keyof typeof ACCEPT_HEADERS;

type SetupOutcome = { ready: true } | { ready: false; lastStatus: number | undefined };

interface RawResponse {
  status: number;
  text: string;
  url: string;
  requestError?: string;
}

interface ClassifiedResponse {
  response: RawResponse;
  verdict: ResponseVerdict;
}

export interface FetchedPage {
  url: string;
  html: string;
}

export interface SetupResult {
  createdAt: string;
  browserChannel: string;
  stored: true;
  cookieCount: number;
}

export interface LiveSessionCheck {
  ok: boolean;
  error?: ReturnType<typeof safeError>;
}

type ProgressReporter = (message: string) => void;

export class AvitoBrowserSession {
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

  async setup(timeoutMs: number, report: ProgressReporter = () => undefined): Promise<SetupResult> {
    await this.close();
    report("Opening a temporary Chrome window for Avito session setup…");

    const browser = await this.launch(false);
    const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
    const page = await context.newPage();

    try {
      await this.openHome(page);
      const outcome = await this.waitForUsableSession(page, timeoutMs, report);
      if (outcome.ready) {
        const result = await this.saveSession(page, context);
        report("Avito session is ready and stored locally.");
        return result;
      }
      throw new AvitoMcpError(
        "AVITO_BLOCKED",
        `Avito did not provide a usable session within ${Math.ceil(timeoutMs / 1000)} seconds${outcome.lastStatus ? ` (last HTTP status: ${outcome.lastStatus})` : ""}.`,
      );
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async requestJson(url: string): Promise<unknown> {
    const { response, verdict } = await this.request(url, "json");
    if (verdict === "not_found") {
      throw new AvitoMcpError("REQUEST_FAILED", "Avito returned HTTP 404 for an internal endpoint.");
    }
    try {
      return JSON.parse(response.text) as unknown;
    } catch (error) {
      throw new AvitoMcpError("AVITO_RESPONSE_INVALID", "Avito returned a response that is not valid JSON.", {
        cause: error,
      });
    }
  }

  /**
   * Loads an Avito HTML page, following redirects.
   * @param url HTTPS URL on www.avito.ru.
   * @returns The final page URL and HTML, or `null` when Avito answers 404.
   */
  async requestHtml(url: string): Promise<FetchedPage | null> {
    const { response, verdict } = await this.request(url, "html");
    if (verdict === "not_found") return null;
    if (!isAllowedRequestUrl(response.url)) {
      throw new AvitoMcpError("AVITO_RESPONSE_INVALID", "Avito redirected outside www.avito.ru.");
    }
    return { url: response.url, html: response.text };
  }

  async checkLive(): Promise<LiveSessionCheck> {
    try {
      await this.requestJson(SESSION_PROBE_URL);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: safeError(error) };
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

  private async waitForUsableSession(
    page: Page,
    timeoutMs: number,
    report: ProgressReporter,
  ): Promise<SetupOutcome> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus: number | undefined;
    let lastProbeAt = 0;
    let reportedBlock = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(SETUP_POLL_INTERVAL_MS).catch(() => undefined);
      if (page.isClosed()) {
        throw new AvitoMcpError("REQUEST_FAILED", "The setup browser window was closed before Avito became ready.");
      }

      if (isBlockPageTitle(await page.title().catch(() => ""))) {
        if (!reportedBlock) report("Avito shows an access check. Complete it in the browser window to continue.");
        reportedBlock = true;
        continue;
      }
      if (Date.now() - lastProbeAt < SETUP_PROBE_INTERVAL_MS) continue;

      lastProbeAt = Date.now();
      const probe = await this.rawRequest(page, SESSION_PROBE_URL, "json");
      if (classifyResponse(probe) === "ok") return { ready: true };
      lastStatus = probe.status || lastStatus;
      report(`Avito search answered HTTP ${probe.status}; reloading the home page.`);
      await this.openHome(page).catch(() => undefined);
    }
    return { ready: false, lastStatus };
  }

  private async saveSession(page: Page, context: BrowserContext): Promise<SetupResult> {
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
    return { createdAt, browserChannel: this.config.browserChannel, stored: true, cookieCount: storageState.cookies.length };
  }

  private async request(url: string, contentType: ContentType): Promise<ClassifiedResponse> {
    if (!isAllowedRequestUrl(url)) {
      throw new AvitoMcpError("REQUEST_FAILED", "Refusing to request a host other than www.avito.ru.");
    }

    return this.queue.run(async () => {
      const page = await this.ensureHeadlessPage();
      let result = await this.classifiedRequest(page, url, contentType);
      if (result.verdict === "challenge") {
        await this.passChallenge(page);
        result = await this.classifiedRequest(page, url, contentType);
      }
      this.armIdleTimer();
      const failure = unusableResponseError(result);
      if (failure) {
        if (failure.code === "SESSION_EXPIRED") await this.close();
        throw failure;
      }
      return result;
    });
  }

  private async passChallenge(page: Page): Promise<void> {
    await this.openHome(page);
    await page
      .waitForFunction(
        (prefix) => !document.title.trim().startsWith(prefix),
        BLOCK_PAGE_TITLE_PREFIX,
        { timeout: CHALLENGE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  private async classifiedRequest(page: Page, url: string, contentType: ContentType): Promise<ClassifiedResponse> {
    await this.waitForRequestSlot();
    try {
      const response = await this.rawRequest(page, url, contentType);
      return { response, verdict: classifyResponse(response) };
    } finally {
      this.lastRequestAt = Date.now();
    }
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
      throw new AvitoMcpError(
        "BROWSER_UNAVAILABLE",
        `Could not launch ${this.config.browserChannel}. Install the browser or set AVITO_MCP_BROWSER_CHANNEL/AVITO_MCP_EXECUTABLE_PATH.`,
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
        viewport: VIEWPORT,
        locale: LOCALE,
        userAgent: saved.userAgent,
        storageState: saved.storageState,
      });
      const page = await context.newPage();
      await this.openHome(page);
      await page.waitForTimeout(HOME_SETTLE_MS);

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

  private async openHome(page: Page): Promise<void> {
    await page.goto(AVITO_HOME_URL, { waitUntil: "domcontentloaded", timeout: this.config.navigationTimeoutMs });
  }

  private async rawRequest(page: Page, url: string, contentType: ContentType): Promise<RawResponse> {
    return page.evaluate(
      async ({ requestUrl, timeout, accept }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(requestUrl, { headers: { accept }, signal: controller.signal });
          return { status: response.status, text: await response.text(), url: response.url };
        } catch (error) {
          return {
            status: 0,
            text: "",
            url: requestUrl,
            requestError: error instanceof Error ? error.message : String(error),
          };
        } finally {
          clearTimeout(timer);
        }
      },
      { requestUrl: url, timeout: this.config.requestTimeoutMs, accept: ACCEPT_HEADERS[contentType] },
    );
  }

  private async waitForRequestSlot(): Promise<void> {
    const interval = this.config.minimumRequestIntervalMs + Math.random() * MAX_REQUEST_JITTER_MS;
    const remaining = interval - (Date.now() - this.lastRequestAt);
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

function unusableResponseError({ response, verdict }: ClassifiedResponse): AvitoMcpError | null {
  if (verdict === "ok" || verdict === "not_found") return null;
  if (verdict === "rate_limited") {
    return new AvitoMcpError(
      "AVITO_RATE_LIMITED",
      `Avito temporarily restricted access from this IP (HTTP ${response.status}). Wait at least 20 minutes before retrying, or run ${SETUP_COMMAND} and pass the check in the browser window.`,
    );
  }
  if (verdict === "challenge" || verdict === "session_rejected") {
    return new AvitoMcpError(
      "SESSION_EXPIRED",
      `Avito rejected the saved browser session (HTTP ${response.status}). Run ${SETUP_COMMAND} again.`,
    );
  }
  return new AvitoMcpError(
    "REQUEST_FAILED",
    response.requestError
      ? `Avito request failed: ${response.requestError}`
      : `Avito returned unexpected HTTP ${response.status}.`,
  );
}
