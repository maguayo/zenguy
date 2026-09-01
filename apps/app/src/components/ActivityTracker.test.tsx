import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { ClientEvent } from "@/lib/activity/screen-events";
import { runBeforeSignOut } from "@/lib/session-hooks";

import { ActivityTracker, resetActivityTrackerForTests } from "./ActivityTracker";

type AuthStatus = "signedIn" | "signedOut" | "loading" | "unavailable";

const overview = ["w", "[wsId]", "(tabs)", "(overview)", "overview"];
const mockSegments = { current: [...overview] };
const mockParams = { current: { wsId: "ws_1" } as Record<string, string> };
const mockStatus = { current: "signedIn" as AuthStatus };
const mockSend = jest.fn<(events: ClientEvent[]) => Promise<void>>();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));
jest.mock("expo-router", () => ({
  useGlobalSearchParams: () => mockParams.current,
  useSegments: () => mockSegments.current,
}));
const mockUser = { current: { emailVerified: true } as { emailVerified: boolean } | null };

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ status: mockStatus.current, user: mockUser.current }),
}));
jest.mock("@/api/events", () => ({
  sendActivityEvents: (events: ClientEvent[]) => mockSend(events),
}));

const meta = { appVersion: "1.0.0", platform: "ios" };
const opened = { type: "app.opened", properties: meta };
const overviewVisit = {
  type: "app.screen_viewed",
  workspaceId: "ws_1",
  properties: { screen: "/w/[wsId]/overview", ...meta },
};

function appStateListener(): (state: AppStateStatus) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls;
  const listener = calls[calls.length - 1]?.[1];
  if (listener === undefined) throw new Error("ActivityTracker did not subscribe to AppState");
  return listener;
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("ActivityTracker", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue(undefined);
    jest.mocked(AppState.addEventListener).mockClear();
    mockSegments.current = [...overview];
    mockParams.current = { wsId: "ws_1" };
    mockStatus.current = "signedIn";
    mockUser.current = { emailVerified: true };
    AppState.currentState = "active";
    resetActivityTrackerForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reports the cold start and the current screen for a signed-in user", async () => {
    await render(<ActivityTracker />);
    expect(mockSend).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith([opened, overviewVisit]);
  });

  it("reports nothing while signed out", async () => {
    mockStatus.current = "signedOut";
    await render(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(mockSend).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it("reports nothing until the email is verified", async () => {
    mockUser.current = { emailVerified: false };
    mockSegments.current = ["access-unavailable"];
    mockParams.current = {};
    await render(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(mockSend).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it("reports the app opening on foreground and flushes on background", async () => {
    await render(<ActivityTracker />);
    // The cold-start batch goes out after the debounce; then the dedupe window expires.
    jest.advanceTimersByTime(31_000);
    mockSend.mockClear();
    const listener = appStateListener();

    listener("active");
    expect(mockSend).not.toHaveBeenCalled();
    listener("background");
    expect(mockSend).toHaveBeenCalledWith([opened]);
  });

  it("keys visits on content: re-renders and query changes on the same screen are not visits", async () => {
    const view = await render(<ActivityTracker />);
    jest.advanceTimersByTime(31_000);
    mockSend.mockClear();

    mockSegments.current = [...overview];
    mockParams.current = { wsId: "ws_1", tab: "runs" };
    await view.rerender(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(mockSend).not.toHaveBeenCalled();

    mockSegments.current = ["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]"];
    mockParams.current = { wsId: "ws_1", testId: "bt_9" };
    await view.rerender(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(mockSend).toHaveBeenCalledWith([
      {
        type: "browser_test.viewed",
        workspaceId: "ws_1",
        resourceId: "bt_9",
        properties: { screen: "/w/[wsId]/tests/[testId]", ...meta },
      },
    ]);
  });

  it("delivers pending visits before sign-out and starts the next session clean", async () => {
    let release: () => void = () => undefined;
    mockSend.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const view = await render(<ActivityTracker />);
    const done = jest.fn();
    const signingOut = runBeforeSignOut().then(done);
    await settleMicrotasks();

    // Flushed at once (not after the debounce) and awaited while the token is still valid.
    expect(mockSend).toHaveBeenCalledWith([opened, overviewVisit]);
    expect(done).not.toHaveBeenCalled();
    release();
    await signingOut;
    expect(done).toHaveBeenCalled();

    mockStatus.current = "signedOut";
    await view.rerender(<ActivityTracker />);
    mockStatus.current = "signedIn";
    await view.rerender(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    // The previous principal's dedupe history is gone: the same screen counts
    // again; the cold start does not (same process).
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenLastCalledWith([overviewVisit]);
  });
});
