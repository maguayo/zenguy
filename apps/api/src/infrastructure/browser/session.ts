import puppeteer, {
  TimeoutError,
  type Browser,
  type BrowserWorker,
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
  type KeyInput,
  type Page,
} from "@cloudflare/puppeteer";
import type { Device } from "../../domain/browser_tests/types";
import {
  DEVICE_PROFILES,
  MAX_CONSOLE_ENTRIES,
  MAX_NETWORK_ENTRIES,
  SCREENSHOT_JPEG_QUALITY,
} from "../../shared/constants";
import { sanitizeUrl, truncate } from "../../shared/redact";
import { serializePage } from "./serializer";
import type { PageState } from "./types";

const MAX_VISITED_URLS = 100;
const ALLOWED_KEYS = new Set<KeyInput>([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageDown",
  "PageUp",
]);

export interface ConsoleEntry {
  level: "error" | "warning";
  message: string;
  url: string | null;
  timestamp: string;
}

export interface NetworkEntry {
  method: string;
  host: string;
  path: string;
  statusCode: number | null;
  errorType: string | null;
  durationMs: number | null;
}

export interface CollectedBrowserEvidence {
  visitedUrls: string[];
  consoleErrors: ConsoleEntry[];
  networkErrors: NetworkEntry[];
}

export interface BrowserSession {
  navigate(url: string): Promise<void>;
  currentUrl(): string;
  title(): Promise<string>;
  serialize(): Promise<PageState>;
  click(index: number): Promise<void>;
  type(index: number, text: string): Promise<void>;
  select(index: number, value: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(direction: "up" | "down"): Promise<void>;
  goBack(): Promise<void>;
  screenshotJpeg(): Promise<Uint8Array>;
  collected(): CollectedBrowserEvidence;
  dispose(): Promise<void>;
}

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

interface MutableEvidence {
  visitedUrls: string[];
  consoleErrors: ConsoleEntry[];
  networkErrors: NetworkEntry[];
}

function networkLocation(rawUrl: string): { host: string; path: string } {
  const sanitized = sanitizeUrl(rawUrl);
  try {
    const url = new URL(sanitized);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: "<invalid-url>", path: "<invalid-url>" };
  }
}

function responseEntry(response: HTTPResponse): NetworkEntry {
  const location = networkLocation(response.url());
  return {
    method: response.request().method(),
    ...location,
    statusCode: response.status(),
    errorType: null,
    durationMs: null,
  };
}

function failedRequestEntry(request: HTTPRequest): NetworkEntry {
  const location = networkLocation(request.url());
  return {
    method: request.method(),
    ...location,
    statusCode: null,
    errorType: request.failure()?.errorText ?? "Request failed",
    durationMs: null,
  };
}

function consoleEntry(
  message: ConsoleMessage,
  now: () => number,
): ConsoleEntry | null {
  const type = message.type();
  if (type !== "error" && type !== "warn") return null;
  const locationUrl = message.location().url;
  return {
    level: type === "error" ? "error" : "warning",
    message: truncate(message.text(), 500),
    url:
      locationUrl === undefined || locationUrl.length === 0
        ? null
        : sanitizeUrl(locationUrl),
    timestamp: new Date(now()).toISOString(),
  };
}

export function attachCollectors(
  page: Page,
  now: () => number = Date.now,
): MutableEvidence {
  const evidence: MutableEvidence = {
    visitedUrls: [],
    consoleErrors: [],
    networkErrors: [],
  };
  page.on("console", (message) => {
    if (evidence.consoleErrors.length >= MAX_CONSOLE_ENTRIES) return;
    const entry = consoleEntry(message, now);
    if (entry !== null) evidence.consoleErrors.push(entry);
  });
  page.on("response", (response) => {
    if (
      response.status() < 400 ||
      evidence.networkErrors.length >= MAX_NETWORK_ENTRIES
    ) {
      return;
    }
    evidence.networkErrors.push(responseEntry(response));
  });
  page.on("requestfailed", (request) => {
    if (evidence.networkErrors.length >= MAX_NETWORK_ENTRIES) return;
    evidence.networkErrors.push(failedRequestEntry(request));
  });
  page.on("framenavigated", (frame) => {
    if (
      frame !== page.mainFrame() ||
      evidence.visitedUrls.length >= MAX_VISITED_URLS
    ) {
      return;
    }
    const url = sanitizeUrl(frame.url());
    if (evidence.visitedUrls.at(-1) !== url) evidence.visitedUrls.push(url);
  });
  return evidence;
}

type SerializePage = (page: Page) => Promise<PageState>;
type LaunchBrowser = (endpoint: BrowserRun) => Promise<Browser>;

export interface LaunchSessionOptions {
  launch?: LaunchBrowser;
  serializePage?: SerializePage;
  now?: () => number;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof TimeoutError ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

function selector(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new ActionError(`Element ${index} no longer on page`);
  }
  return `[data-zg-idx="${index}"]`;
}

class PuppeteerBrowserSession implements BrowserSession {
  private disposed = false;

  constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly evidence: MutableEvidence,
    private readonly serializePage: SerializePage,
  ) {}

  async navigate(url: string): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: "load", timeout: 30_000 });
    } catch (error) {
      if (isTimeout(error)) throw new ActionError("Navigation timed out");
      throw error;
    }
  }

  currentUrl(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title();
  }

  serialize(): Promise<PageState> {
    return this.serializePage(this.page);
  }

  async click(index: number): Promise<void> {
    const element = await this.page.$(selector(index));
    if (element === null) {
      throw new ActionError(`Element ${index} no longer on page`);
    }
    await element.click();
    await this.page
      .waitForNetworkIdle({ idleTime: 500, timeout: 3_000 })
      .catch(() => undefined);
  }

  async type(index: number, text: string): Promise<void> {
    const element = await this.page.$(selector(index));
    if (element === null) {
      throw new ActionError(`Element ${index} no longer on page`);
    }
    await element.click({ clickCount: 3 });
    await element.type(text, { delay: 20 });
  }

  async select(index: number, value: string): Promise<void> {
    await this.page.select(selector(index), value);
  }

  async pressKey(key: string): Promise<void> {
    if (!ALLOWED_KEYS.has(key as KeyInput)) {
      throw new ActionError(`Key ${key} is not allowed`);
    }
    await this.page.keyboard.press(key as KeyInput);
  }

  async scroll(direction: "up" | "down"): Promise<void> {
    const directionMultiplier = direction === "down" ? 0.8 : -0.8;
    await this.page.evaluate((multiplier) => {
      window.scrollBy(0, multiplier * window.innerHeight);
    }, directionMultiplier);
  }

  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: "load", timeout: 15_000 });
  }

  async screenshotJpeg(): Promise<Uint8Array> {
    const screenshot = await this.page.screenshot({
      type: "jpeg",
      quality: SCREENSHOT_JPEG_QUALITY,
    });
    return new Uint8Array(screenshot);
  }

  collected(): CollectedBrowserEvidence {
    return structuredClone(this.evidence);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.browser.close();
    } catch {
      // Disposal is best-effort and must never mask the attempt outcome.
    }
  }
}

export async function launchSession(
  browserBinding: BrowserRun,
  device: Device,
  options: LaunchSessionOptions = {},
): Promise<BrowserSession> {
  const launch =
    options.launch ??
    ((endpoint: BrowserRun) =>
      puppeteer.launch(endpoint as unknown as BrowserWorker));
  const browser = await launch(browserBinding);
  try {
    const page = await browser.newPage();
    const evidence = attachCollectors(page, options.now);
    const profile = DEVICE_PROFILES[device];
    await page.setViewport({
      width: profile.width,
      height: profile.height,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      deviceScaleFactor: profile.deviceScaleFactor,
    });
    await page.setUserAgent(profile.userAgent);
    page.setDefaultTimeout(20_000);
    return new PuppeteerBrowserSession(
      browser,
      page,
      evidence,
      options.serializePage ?? serializePage,
    );
  } catch (error) {
    try {
      await browser.close();
    } catch {
      // Preserve the original setup error.
    }
    throw error;
  }
}
