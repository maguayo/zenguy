import type {
  Browser,
  ConsoleMessage,
  ElementHandle,
  Frame,
  HTTPRequest,
  HTTPResponse,
  Page,
} from "@cloudflare/puppeteer";
import { DEVICE_PROFILES, MAX_CONSOLE_ENTRIES, MAX_NETWORK_ENTRIES } from "../../shared/constants";
import {
  ActionError,
  attachCollectors,
  launchSession,
  type BrowserSession,
} from "./session";
import type { PageState } from "./types";

type PageEvent = "console" | "response" | "requestfailed" | "framenavigated";

class FakePage {
  readonly handlers = new Map<PageEvent, Array<(value: never) => void>>();
  readonly viewportCalls: unknown[] = [];
  readonly userAgentCalls: string[] = [];
  readonly timeoutCalls: number[] = [];
  readonly gotoCalls: unknown[][] = [];
  readonly selectorCalls: string[] = [];
  readonly selectCalls: unknown[][] = [];
  readonly pressCalls: string[] = [];
  readonly evaluateCalls: unknown[][] = [];
  readonly goBackCalls: unknown[] = [];
  readonly screenshotCalls: unknown[] = [];
  readonly waitForNetworkIdleCalls: unknown[] = [];

  currentUrl = "https://example.com/current";
  currentTitle = "Current page";
  mainFrameValue = frame("https://example.com/current");
  element: ElementHandle | null = elementHandle();
  gotoError: unknown = null;
  waitForNetworkIdleError: unknown = null;
  screenshotBytes = new Uint8Array([1, 2, 3]);

  readonly keyboard = {
    press: async (key: string): Promise<void> => {
      this.pressCalls.push(key);
    },
  };

  on(event: PageEvent, listener: (value: never) => void): this {
    const listeners = this.handlers.get(event) ?? [];
    listeners.push(listener);
    this.handlers.set(event, listeners);
    return this;
  }

  emit(event: PageEvent, value: unknown): void {
    for (const listener of this.handlers.get(event) ?? []) {
      listener(value as never);
    }
  }

  mainFrame(): Frame {
    return this.mainFrameValue;
  }

  setViewport(value: unknown): Promise<void> {
    this.viewportCalls.push(value);
    return Promise.resolve();
  }

  setUserAgent(value: string): Promise<void> {
    this.userAgentCalls.push(value);
    return Promise.resolve();
  }

  setDefaultTimeout(value: number): void {
    this.timeoutCalls.push(value);
  }

  async goto(...args: unknown[]): Promise<null> {
    this.gotoCalls.push(args);
    if (this.gotoError !== null) throw this.gotoError;
    return null;
  }

  url(): string {
    return this.currentUrl;
  }

  title(): Promise<string> {
    return Promise.resolve(this.currentTitle);
  }

  $(value: string): Promise<ElementHandle | null> {
    this.selectorCalls.push(value);
    return Promise.resolve(this.element);
  }

  waitForNetworkIdle(value: unknown): Promise<void> {
    this.waitForNetworkIdleCalls.push(value);
    return this.waitForNetworkIdleError === null
      ? Promise.resolve()
      : Promise.reject(this.waitForNetworkIdleError);
  }

  select(...args: unknown[]): Promise<string[]> {
    this.selectCalls.push(args);
    return Promise.resolve([]);
  }

  evaluate(...args: unknown[]): Promise<void> {
    this.evaluateCalls.push(args);
    return Promise.resolve();
  }

  goBack(value: unknown): Promise<null> {
    this.goBackCalls.push(value);
    return Promise.resolve(null);
  }

  screenshot(value: unknown): Promise<Uint8Array> {
    this.screenshotCalls.push(value);
    return Promise.resolve(this.screenshotBytes);
  }

  asPage(): Page {
    return this as unknown as Page;
  }
}

function frame(url: string): Frame {
  return { url: () => url } as unknown as Frame;
}

function consoleMessage(
  type: string,
  text: string,
  url = "https://example.com/app.js?token=secret&line=4",
): ConsoleMessage {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url, lineNumber: 1, columnNumber: 2 }),
  } as unknown as ConsoleMessage;
}

function request(
  url: string,
  method = "GET",
  failureText: string | null = null,
): HTTPRequest {
  return {
    url: () => url,
    method: () => method,
    failure: () =>
      failureText === null ? null : { errorText: failureText },
  } as unknown as HTTPRequest;
}

function response(
  status: number,
  url: string,
  method = "GET",
): HTTPResponse {
  return {
    status: () => status,
    url: () => url,
    request: () => request(url, method),
  } as unknown as HTTPResponse;
}

function elementHandle(): ElementHandle {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
  } as unknown as ElementHandle;
}

const serializedState: PageState = {
  url: "https://example.com/current",
  title: "Current page",
  scrollY: 0,
  scrollHeight: 1000,
  innerHeight: 900,
  elements: [],
  textDigest: "Page text",
};

async function createSession(
  page = new FakePage(),
  overrides: {
    close?: () => Promise<void>;
    serializePage?: (page: Page) => Promise<PageState>;
  } = {},
): Promise<{
  session: BrowserSession;
  page: FakePage;
  close: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  binding: BrowserRun;
}> {
  const close = vi.fn(overrides.close ?? (() => Promise.resolve()));
  const browser = {
    newPage: vi.fn().mockResolvedValue(page.asPage()),
    close,
  } as unknown as Browser;
  const launch = vi.fn().mockResolvedValue(browser);
  const binding = {} as BrowserRun;
  const session = await launchSession(binding, "DESKTOP", {
    launch,
    serializePage:
      overrides.serializePage ?? (() => Promise.resolve(serializedState)),
    now: () => Date.UTC(2026, 7, 19, 10, 11, 12),
  });
  return { session, page, close, launch, binding };
}

describe("browser collectors", () => {
  it("shapes console errors and warnings, sanitizes URLs, and drops other levels", () => {
    const page = new FakePage();
    const evidence = attachCollectors(
      page.asPage(),
      () => Date.UTC(2026, 7, 19, 10, 11, 12),
    );

    page.emit("console", consoleMessage("log", "ordinary log"));
    page.emit("console", consoleMessage("error", "x".repeat(510)));
    page.emit("console", consoleMessage("warn", "Watch out", ""));

    expect(evidence.consoleErrors).toEqual([
      {
        level: "error",
        message: `${"x".repeat(499)}…`,
        url: "https://example.com/app.js?token=redacted&line=4",
        timestamp: "2026-08-19T10:11:12.000Z",
      },
      {
        level: "warning",
        message: "Watch out",
        url: null,
        timestamp: "2026-08-19T10:11:12.000Z",
      },
    ]);
  });

  it("caps console evidence", () => {
    const page = new FakePage();
    const evidence = attachCollectors(page.asPage());

    for (let index = 0; index < MAX_CONSOLE_ENTRIES + 3; index += 1) {
      page.emit("console", consoleMessage("error", `error-${index}`));
    }

    expect(evidence.consoleErrors).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(evidence.consoleErrors.at(-1)?.message).toBe("error-49");
  });

  it("records failed responses and requests without headers, bodies, or query strings", () => {
    const page = new FakePage();
    const evidence = attachCollectors(page.asPage());

    page.emit(
      "response",
      response(399, "https://example.com/ignored?token=secret", "GET"),
    );
    page.emit(
      "response",
      response(503, "https://api.example.com/orders?id=2&token=secret", "POST"),
    );
    page.emit(
      "requestfailed",
      request("https://cdn.example.com/app.js?signature=secret", "GET", "net::ERR_FAILED"),
    );

    expect(evidence.networkErrors).toEqual([
      {
        method: "POST",
        host: "api.example.com",
        path: "/orders",
        statusCode: 503,
        errorType: null,
        durationMs: null,
      },
      {
        method: "GET",
        host: "cdn.example.com",
        path: "/app.js",
        statusCode: null,
        errorType: "net::ERR_FAILED",
        durationMs: null,
      },
    ]);
  });

  it("caps response and request-failure evidence together", () => {
    const page = new FakePage();
    const evidence = attachCollectors(page.asPage());

    for (let index = 0; index < MAX_NETWORK_ENTRIES + 4; index += 1) {
      const url = `https://example.com/${index}`;
      if (index % 2 === 0) page.emit("response", response(500, url));
      else page.emit("requestfailed", request(url, "GET", "failure"));
    }

    expect(evidence.networkErrors).toHaveLength(MAX_NETWORK_ENTRIES);
    expect(evidence.networkErrors.at(-1)?.path).toBe("/49");
  });

  it("records only main-frame navigations, sanitizes, deduplicates, and caps them", () => {
    const page = new FakePage();
    const evidence = attachCollectors(page.asPage());

    page.emit("framenavigated", frame("https://child.example.com/"));
    const first = frame("https://example.com/a?session=secret&safe=yes");
    page.mainFrameValue = first;
    page.emit("framenavigated", first);
    page.emit("framenavigated", first);
    for (let index = 1; index < 105; index += 1) {
      const next = frame(`https://example.com/${index}`);
      page.mainFrameValue = next;
      page.emit("framenavigated", next);
    }

    expect(evidence.visitedUrls).toHaveLength(100);
    expect(evidence.visitedUrls.slice(0, 2)).toEqual([
      "https://example.com/a?session=redacted&safe=yes",
      "https://example.com/1",
    ]);
    expect(evidence.visitedUrls.at(-1)).toBe("https://example.com/99");
  });
});

describe("launchSession", () => {
  it("launches one fresh browser and applies the requested device profile", async () => {
    const page = new FakePage();
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = {
      newPage: vi.fn().mockResolvedValue(page.asPage()),
      close,
    } as unknown as Browser;
    const launch = vi.fn().mockResolvedValue(browser);
    const binding = {} as BrowserRun;

    const session = await launchSession(binding, "MOBILE", {
      launch,
      serializePage: () => Promise.resolve(serializedState),
    });

    expect(launch).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(binding);
    expect(browser.newPage).toHaveBeenCalledOnce();
    expect(page.viewportCalls).toEqual([
      {
        width: DEVICE_PROFILES.MOBILE.width,
        height: DEVICE_PROFILES.MOBILE.height,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    ]);
    expect(page.userAgentCalls).toEqual([DEVICE_PROFILES.MOBILE.userAgent]);
    expect(page.timeoutCalls).toEqual([20_000]);
    expect([...page.handlers.keys()].sort()).toEqual([
      "console",
      "framenavigated",
      "requestfailed",
      "response",
    ]);

    await session.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the browser if page setup fails and preserves the setup error", async () => {
    const setupError = new Error("viewport failed");
    const page = new FakePage();
    page.setViewport = () => Promise.reject(setupError);
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const browser = {
      newPage: vi.fn().mockResolvedValue(page.asPage()),
      close,
    } as unknown as Browser;

    await expect(
      launchSession({} as BrowserRun, "DESKTOP", {
        launch: () => Promise.resolve(browser),
      }),
    ).rejects.toBe(setupError);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("BrowserSession actions", () => {
  it("exposes current page data and delegates serialization", async () => {
    const serializePage = vi.fn().mockResolvedValue(serializedState);
    const { session, page } = await createSession(new FakePage(), {
      serializePage,
    });

    expect(session.currentUrl()).toBe("https://example.com/current");
    await expect(session.title()).resolves.toBe("Current page");
    await expect(session.serialize()).resolves.toBe(serializedState);
    expect(serializePage).toHaveBeenCalledWith(page.asPage());
  });

  it("navigates with a load timeout and maps timeouts to ActionError", async () => {
    const { session, page } = await createSession();
    await session.navigate("https://example.com/next");
    expect(page.gotoCalls).toEqual([
      ["https://example.com/next", { waitUntil: "load", timeout: 30_000 }],
    ]);

    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    page.gotoError = timeout;
    await expect(session.navigate("https://example.com/slow")).rejects.toEqual(
      new ActionError("Navigation timed out"),
    );

    const otherError = new Error("DNS failed");
    page.gotoError = otherError;
    await expect(session.navigate("https://example.com/down")).rejects.toBe(
      otherError,
    );
  });

  it("clicks indexed elements, waits briefly for network idle, and tolerates that wait timing out", async () => {
    const { session, page } = await createSession();
    const element = page.element as ElementHandle;
    page.waitForNetworkIdleError = new Error("idle timeout");

    await expect(session.click(7)).resolves.toBeUndefined();
    expect(page.selectorCalls).toEqual(['[data-zg-idx="7"]']);
    expect(element.click).toHaveBeenCalledWith();
    expect(page.waitForNetworkIdleCalls).toEqual([
      { idleTime: 500, timeout: 3_000 },
    ]);
  });

  it("reports missing or invalid indexed elements as action errors", async () => {
    const { session, page } = await createSession();
    page.element = null;

    await expect(session.click(4)).rejects.toEqual(
      new ActionError("Element 4 no longer on page"),
    );
    await expect(session.type(4, "text")).rejects.toEqual(
      new ActionError("Element 4 no longer on page"),
    );
    await expect(session.select(-1, "value")).rejects.toEqual(
      new ActionError("Element -1 no longer on page"),
    );
  });

  it("selects existing text before typing and delegates selection", async () => {
    const { session, page } = await createSession();
    const element = page.element as ElementHandle;

    await session.type(12, "hello");
    await session.select(3, "large");

    expect(page.selectorCalls).toEqual(['[data-zg-idx="12"]']);
    expect(element.click).toHaveBeenCalledWith({ clickCount: 3 });
    expect(element.type).toHaveBeenCalledWith("hello", { delay: 20 });
    expect(page.selectCalls).toEqual([['[data-zg-idx="3"]', "large"]]);
  });

  it("allows only the documented keyboard keys", async () => {
    const { session, page } = await createSession();
    const allowed = [
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
    ];

    for (const key of allowed) await session.pressKey(key);
    expect(page.pressCalls).toEqual(allowed);
    await expect(session.pressKey("F12")).rejects.toEqual(
      new ActionError("Key F12 is not allowed"),
    );
  });

  it("scrolls by 80 percent of the viewport in either direction", async () => {
    const { session, page } = await createSession();

    await session.scroll("down");
    await session.scroll("up");

    expect(page.evaluateCalls.map((call) => call[1])).toEqual([0.8, -0.8]);
    expect(page.evaluateCalls[0]?.[0]).toBeTypeOf("function");
  });

  it("goes back and captures a viewport-only JPEG at the configured quality", async () => {
    const { session, page } = await createSession();

    await session.goBack();
    const bytes = await session.screenshotJpeg();

    expect(page.goBackCalls).toEqual([{ waitUntil: "load", timeout: 15_000 }]);
    expect(page.screenshotCalls).toEqual([{ type: "jpeg", quality: 60 }]);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns evidence snapshots rather than exposing mutable collector state", async () => {
    const { session, page } = await createSession();
    page.emit("console", consoleMessage("error", "first"));

    const first = session.collected();
    first.consoleErrors.push({
      level: "error",
      message: "mutated",
      url: null,
      timestamp: "now",
    });

    expect(session.collected().consoleErrors.map(({ message }) => message)).toEqual([
      "first",
    ]);
  });

  it("disposes once and never lets close failures mask attempt completion", async () => {
    const { session, close } = await createSession(new FakePage(), {
      close: () => Promise.reject(new Error("already gone")),
    });

    await expect(session.dispose()).resolves.toBeUndefined();
    await expect(session.dispose()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
