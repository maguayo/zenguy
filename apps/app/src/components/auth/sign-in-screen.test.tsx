import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import SignIn from "../../../app/(auth)/sign-in";

const mockSignIn = jest.fn<(email: string, password: string) => Promise<void>>();

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
      React.createElement(
        Pressable,
        { accessibilityRole: "link", testID: `link-${href}` },
        children,
      ),
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ replace: jest.fn() }),
  };
});

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

jest.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ error: jest.fn() }),
}));

describe("existing-account sign-in screen", () => {
  it("offers sign-in, password recovery and legal pages without acquisition", async () => {
    await render(<SignIn />);

    expect(screen.getByText("Sign in with your existing Zenguy account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Forgot password?")).toBeTruthy();
    expect(screen.getByTestId("link-/terms")).toBeTruthy();
    expect(screen.getByTestId("link-/privacy")).toBeTruthy();
    expect(screen.queryByText(/sign[ -]?up|create (?:an )?account|register/iu)).toBeNull();
  });
});
