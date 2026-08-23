import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { AppLockContextValue } from "@/contexts/AppLockContext";
import { AppLockBoundary } from "./AppLockBoundary";

const mockUseAppLock = jest.fn<() => AppLockContextValue>();

jest.mock("@/contexts/AppLockContext", () => ({
  useAppLock: () => mockUseAppLock(),
}));

function lockState(
  overrides: Partial<AppLockContextValue>,
): AppLockContextValue {
  return {
    biometricsAvailable: true,
    locked: false,
    preferences: { enabled: true, threshold: "immediate" },
    ready: true,
    setEnabled: jest.fn(async () => true),
    setThreshold: jest.fn(async () => undefined),
    unlock: jest.fn(async () => false),
    ...overrides,
  };
}

describe("AppLockBoundary", () => {
  it("removes protected descendants from touch and accessibility while locked", async () => {
    mockUseAppLock.mockReturnValue(lockState({ locked: true }));

    await render(
      <AppLockBoundary>
        <Text>Sensitive workspace content</Text>
      </AppLockBoundary>,
    );

    expect(screen.queryByText("Sensitive workspace content")).toBeNull();
    // Hidden descendants are deliberately absent from normal accessibility
    // queries; opt in only so the test can inspect the boundary's native props.
    const protectedContent = screen.getByTestId("app-lock-protected-content", {
      includeHiddenElements: true,
    });
    expect(protectedContent.props.accessibilityElementsHidden).toBe(true);
    expect(protectedContent.props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    expect(protectedContent.props.pointerEvents).toBe("none");

    const lockModal = screen.getByLabelText("Zenguy is locked");
    expect(lockModal.props.accessibilityViewIsModal).toBe(true);
    expect(lockModal.props.importantForAccessibility).toBe("yes");
  });

  it("also conceals protected descendants while lock preferences load", async () => {
    mockUseAppLock.mockReturnValue(lockState({ ready: false }));

    await render(
      <AppLockBoundary>
        <Text>Sensitive workspace content</Text>
      </AppLockBoundary>,
    );

    const protectedContent = screen.getByTestId("app-lock-protected-content", {
      includeHiddenElements: true,
    });
    expect(protectedContent.props.accessibilityElementsHidden).toBe(true);
    expect(protectedContent.props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    expect(protectedContent.props.pointerEvents).toBe("none");
    expect(screen.queryByLabelText("Zenguy is locked")).toBeNull();
  });

  it("restores normal interaction only after unlocking", async () => {
    mockUseAppLock.mockReturnValue(lockState({ locked: false, ready: true }));

    await render(
      <AppLockBoundary>
        <Text>Sensitive workspace content</Text>
      </AppLockBoundary>,
    );

    const protectedContent = screen.getByTestId("app-lock-protected-content");
    expect(protectedContent.props.accessibilityElementsHidden).toBe(false);
    expect(protectedContent.props.importantForAccessibility).toBe("auto");
    expect(protectedContent.props.pointerEvents).toBe("auto");
    expect(screen.queryByLabelText("Zenguy is locked")).toBeNull();
  });
});
