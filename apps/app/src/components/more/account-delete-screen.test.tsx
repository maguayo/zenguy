import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import AccountScreen from "../../../app/w/[wsId]/(tabs)/(more)/account";

const mockDeleteAccount = jest.fn<(password: string) => Promise<void>>();
const mockReplace = jest.fn();
const mockSuccess = jest.fn();
const mockConfirm = jest.fn<(options: unknown) => Promise<boolean>>();

jest.mock("expo-application", () => ({
  nativeApplicationVersion: "0.2.2",
  nativeBuildVersion: "5",
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { ios: { buildNumber: "5" }, version: "0.2.2" } },
}));

jest.mock("expo-updates", () => ({ channel: "production", updateId: null }));

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    deleteAccount: mockDeleteAccount,
    signOut: jest.fn(async () => undefined),
    user: {
      email: "reviewer@example.com",
      emailVerified: true,
      id: "usr_review",
      name: "App Reviewer",
    },
  }),
}));

jest.mock("@/contexts/AppLockContext", () => ({
  useAppLock: () => ({
    biometricsAvailable: true,
    preferences: { enabled: false, threshold: "immediate" },
    setEnabled: jest.fn(async () => true),
    setThreshold: jest.fn(async () => undefined),
  }),
}));

jest.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ error: jest.fn(), success: mockSuccess }),
}));

jest.mock("@/components/push/NotificationsCard", () => ({
  NotificationsCard: () => null,
}));

jest.mock("@/ui", () => ({
  ...jest.requireActual<typeof import("@/ui")>("@/ui"),
  confirm: (options: unknown) => mockConfirm(options),
}));

async function openDeletionForm() {
  await fireEvent.press(screen.getByRole("button", { name: "Delete my account…" }));
  await screen.findByTestId("delete-account-confirmation");
}

describe("account deletion screen", () => {
  it("requires step-up input and a final destructive confirmation before deleting", async () => {
    mockConfirm.mockResolvedValueOnce(true);
    mockDeleteAccount.mockResolvedValueOnce(undefined);
    await render(<AccountScreen />);
    await openDeletionForm();

    const submit = screen.getByRole("button", { name: "Delete account" });
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByTestId("delete-account-confirmation"), "delete");
    await fireEvent.changeText(
      screen.getByTestId("delete-account-password"),
      "correct-password",
    );
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByTestId("delete-account-confirmation"), "DELETE");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete account" }).props.accessibilityState)
        .toMatchObject({ disabled: false }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Delete account" }));

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith("correct-password"));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmLabel: "Delete account",
        destructive: true,
        title: "Delete your account?",
      }),
    );
    expect(mockSuccess).toHaveBeenCalledWith("Account deleted");
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
  });
});
