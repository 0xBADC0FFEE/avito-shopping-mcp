import { chromium, errors } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";

import { AVITO_HOME_URL, isAllowedRequestUrl, LIVENESS_PROBE_URL, SEARCH_PROBE_URL } from "./avito-api.js";
import { BLOCK_PAGE_TITLE_PREFIX, classifyResponse, isBlockPageTitle } from "./block-detection.js";
import type { ResponseVerdict } from "./block-detection.js";
import type { RuntimeConfig } from "./config.js";
import { AvitoMcpError, safeError } from "./errors.js";
import { SerialQueue } from "./serial-queue.js";
import { SessionStore } from "./session-store.js";
import type { PersistedSession } from "./session-store.js";

const VIEWPORT = { width: 1440, height: 900 };
const LOCALE = "ru-RU";
const SETUP_TITLE_POLL_INTERVAL_MS = 2_000;
// Avito's home page keeps navigating after load; ad frames can keep the network busy indefinitely.
const HOME_NETWORK_IDLE_TIMEOUT_MS = 5_000;
const NAVIGATION_RECOVERY_TIMEOUT_MS = 5_000;
const CONTEXT_LOST_ERROR = /Execution context was destroyed|because of a navigation/i;
const CHALLENGE_TIMEOUT_MS = 20_000;
const MAX_REQUEST_JITTER_MS = 2_000;
const SETUP_COMMAND = "`avito-shopping-mcp setup`";
const SOLVE_IN_WINDOW_HINT = "Solve any captcha in the opened browser window yourself and keep the window open.";
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
// Avito IP restrictions last 20 minutes or more; any request during one extends it.
export const RATE_LIMIT_BACKOFF_MINUTES = 20;
const RATE_LIMIT_BACKOFF_MS = RATE_LIMIT_BACKOFF_MINUTES * MS_PER_MINUTE;
const ACCEPT_HEADERS = { json: "application/json", html: "text/html" } as const;

type ContentType = keyof typeof ACCEPT_HEADERS;

type SetupOutcome = { ready: true } | { ready: false; lastProbe: ClassifiedResponse | undefined };

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
  private rateLimitedAt: number | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: RuntimeConfig) {
    this.store = new SessionStore(config.stateFile);
  }

  async setup(timeoutMs: number, report: ProgressReporter = () => undefined): Promise<SetupResult> {
    await this.close();
    report(`Opening a temporary Chrome window for Avito session setup. ${SOLVE_IN_WINDOW_HINT}`);

    const browser = await this.launch(false);
    const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
    const page = await context.newPage();

    try {
      await this.openHome(page);
      const outcome = await this.waitForUsableSession(page, Date.now() + timeoutMs, report);
      if (!outcome.ready) {
        const error = setupTimeoutError(outcome.lastProbe, timeoutMs);
        this.recordRateLimit(error);
        throw error;
      }
      const result = await this.saveSession(page, context);
      report("Avito session is ready and stored locally.");
      return result;
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
      await this.requestJson(LIVENESS_PROBE_URL);
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

  // Re-probing a throttled IP on a timer keeps it flagged, so after a failed probe
  // only a page load caused by the user in the window triggers the next probe.
  private async waitForUsableSession(page: Page, deadline: number, report: ProgressReporter): Promise<SetupOutcome> {
    let lastProbe: ClassifiedResponse | undefined;
    let challengeRetried = false;
    while (await this.waitForAccessiblePage(page, deadline, report)) {
      const response = await this.rawRequest(page, SEARCH_PROBE_URL, "json");
      lastProbe = { response, verdict: classifyResponse(response) };
      if (lastProbe.verdict === "ok") return { ready: true };

      if (lastProbe.verdict === "challenge" && !challengeRetried) {
        challengeRetried = true;
        report("Avito answered with a browser check; reloading the home page once.");
        await this.openHome(page).catch(() => undefined);
        continue;
      }
      report(
        `Avito search answered HTTP ${response.status}. Reload the Avito page in the opened window; ${SOLVE_IN_WINDOW_HINT} Setup checks again after the page reloads.`,
      );
      if (!(await waitForPageLoad(page, deadline))) break;
    }
    return { ready: false, lastProbe };
  }

  private async waitForAccessiblePage(page: Page, deadline: number, report: ProgressReporter): Promise<boolean> {
    let reportedBlock = false;
    while (Date.now() < deadline) {
      assertWindowOpen(page);
      if (!isBlockPageTitle(await page.title().catch(() => ""))) return true;
      if (!reportedBlock) report(`Avito shows an access check. ${SOLVE_IN_WINDOW_HINT}`);
      reportedBlock = true;
      await page.waitForTimeout(SETUP_TITLE_POLL_INTERVAL_MS).catch(() => undefined);
    }
    return false;
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
      await this.enforceRateLimitBackoff();
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
        this.recordRateLimit(failure);
        throw failure;
      }
      return result;
    });
  }

  private recordRateLimit(error: AvitoMcpError): void {
    if (error.code === "AVITO_RATE_LIMITED") this.rateLimitedAt = Date.now();
  }

  // A setup run in another process stores a fresh session, which lifts the backoff early.
  private async enforceRateLimitBackoff(): Promise<void> {
    if (this.rateLimitedAt === undefined) return;
    const remainingMs = this.rateLimitedAt + RATE_LIMIT_BACKOFF_MS - Date.now();
    if (remainingMs <= 0) {
      this.rateLimitedAt = undefined;
      return;
    }
    if (await this.sessionStoredAfter(this.rateLimitedAt)) {
      this.rateLimitedAt = undefined;
      await this.close();
      return;
    }
    throw new AvitoMcpError(
      "AVITO_RATE_LIMITED",
      `Avito restricted this IP recently; Avito requests stay paused for ${Math.ceil(remainingMs / MS_PER_MINUTE)} more minutes, or until ${SETUP_COMMAND} succeeds.`,
    );
  }

  private async sessionStoredAfter(time: number): Promise<boolean> {
    const { createdAt } = await this.store.info();
    return createdAt !== undefined && Date.parse(createdAt) > time;
  }

  private async passChallenge(page: Page): Promise<void> {
    try {
      await this.openHome(page);
    } finally {
      this.lastRequestAt = Date.now();
    }
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
      await page.waitForLoadState("networkidle", { timeout: HOME_NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);

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
    try {
      return await this.fetchInPage(page, url, contentType);
    } catch (error) {
      if (!CONTEXT_LOST_ERROR.test(firstLine(error))) return failedRequest(url, error);
    }
    await page.waitForLoadState("load", { timeout: NAVIGATION_RECOVERY_TIMEOUT_MS }).catch(() => undefined);
    try {
      return await this.fetchInPage(page, url, contentType);
    } catch (error) {
      return failedRequest(url, error);
    }
  }

  private fetchInPage(page: Page, url: string, contentType: ContentType): Promise<RawResponse> {
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
      `Avito temporarily restricted access from this IP (HTTP ${response.status}). Avito requests are paused for ${RATE_LIMIT_BACKOFF_MINUTES} minutes; run ${SETUP_COMMAND} and pass the check in the browser window to resume sooner.`,
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

function setupTimeoutError(lastProbe: ClassifiedResponse | undefined, timeoutMs: number): AvitoMcpError {
  const seconds = Math.ceil(timeoutMs / MS_PER_SECOND);
  const status = lastProbe ? ` (last HTTP status: ${lastProbe.response.status})` : "";
  if (lastProbe?.verdict === "rate_limited") {
    return new AvitoMcpError(
      "AVITO_RATE_LIMITED",
      `Avito kept restricting this IP for ${seconds} seconds${status}. Wait at least ${RATE_LIMIT_BACKOFF_MINUTES} minutes before running ${SETUP_COMMAND} again.`,
    );
  }
  return new AvitoMcpError("AVITO_BLOCKED", `Avito did not provide a usable session within ${seconds} seconds${status}.`);
}

async function waitForPageLoad(page: Page, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  try {
    await page.waitForEvent("load", { timeout: remaining });
    return true;
  } catch (error) {
    assertWindowOpen(page);
    if (error instanceof errors.TimeoutError) return false;
    throw error;
  }
}

function failedRequest(url: string, error: unknown): RawResponse {
  return { status: 0, text: "", url, requestError: firstLine(error) };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? message;
}

function assertWindowOpen(page: Page): void {
  if (page.isClosed()) {
    throw new AvitoMcpError("REQUEST_FAILED", "The setup browser window was closed before Avito became ready.");
  }
}
