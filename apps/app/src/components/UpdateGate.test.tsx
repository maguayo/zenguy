import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react-native";

import { UpdateGate, updateRequiredTitle } from "./UpdateGate";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "0.1.0" } },
}));

const mockGetAppRequirements = jest.fn<() => Promise<{ minVersion: string; storeUrl: string | null }>>();
jest.mock("@/api/app", () => ({
  getAppRequirements: () => mockGetAppRequirements(),
}));

const mountedGateClients: QueryClient[] = [];

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <UpdateGate />
    </QueryClientProvider>,
  );
  mountedGateClients.push(client);
  return view;
}

afterEach(() => {
  cleanup();
  for (const client of mountedGateClients.splice(0)) {
    client.clear();
  }
});

describe("UpdateGate", () => {
  it("blocks the app when the API requires a newer build", async () => {
    mockGetAppRequirements.mockResolvedValueOnce({
      minVersion: "0.2.0",
      storeUrl: "https://apps.apple.com/app/zenguy/id123",
    });
    await renderGate();
    expect(await screen.findByText(updateRequiredTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the App Store" })).toBeTruthy();
    expect(screen.getByText("Installed 0.1.0 · required 0.2.0")).toBeTruthy();
  });

  it("stays invisible when the build is recent enough", async () => {
    mockGetAppRequirements.mockResolvedValueOnce({ minVersion: "0.1.0", storeUrl: null });
    await renderGate();
    await waitFor(() => expect(mockGetAppRequirements).toHaveBeenCalled());
    expect(screen.queryByText(updateRequiredTitle)).toBeNull();
  });

  it("fails open when the requirements cannot be fetched", async () => {
    mockGetAppRequirements.mockRejectedValueOnce(new Error("offline"));
    await renderGate();
    await waitFor(() => expect(mockGetAppRequirements).toHaveBeenCalled());
    expect(screen.queryByText(updateRequiredTitle)).toBeNull();
  });
});
