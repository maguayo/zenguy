import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { improveInstructions } from "@/api/tests";
import { ImproveInstructions } from "./ImproveInstructions";

jest.mock("@/api/tests", () => ({ improveInstructions: jest.fn() }));
const improve = jest.mocked(improveInstructions);
const input = { startUrl: "https://example.com", instructions: "Check cart", device: "DESKTOP" as const };

beforeEach(() => improve.mockReset());

it("previews and applies only on request, without saving a test", async () => {
  improve.mockResolvedValue({ instructions: "1. Check cart. 2. Verify subtotal." });
  const apply = jest.fn();
  await render(<ImproveInstructions workspaceId="ws_1" input={input} onApply={apply} />);
  await fireEvent.press(screen.getByText("Improve instructions"));
  expect(await screen.findByText("1. Check cart. 2. Verify subtotal.")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Apply suggestion"));
  expect(apply).toHaveBeenCalledWith("1. Check cart. 2. Verify subtotal.");
  expect(screen.queryByText("Apply suggestion")).toBeNull();
});

it("discards proposals and keeps the original intact on provider error", async () => {
  const apply = jest.fn();
  improve.mockResolvedValueOnce({ instructions: "Suggestion" });
  await render(<ImproveInstructions workspaceId="ws_1" input={input} onApply={apply} />);
  await fireEvent.press(screen.getByText("Improve instructions"));
  await screen.findByText("Discard");
  await fireEvent.press(screen.getByText("Discard"));
  expect(screen.queryByText("Suggestion")).toBeNull();
  improve.mockRejectedValueOnce(new Error("Unavailable"));
  await fireEvent.press(screen.getByText("Improve instructions"));
  expect(apply).not.toHaveBeenCalled();
});

it("does not apply a late response to an edited draft", async () => {
  let resolve!: (value: { instructions: string }) => void;
  improve.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const apply = jest.fn();
  const view = await render(<ImproveInstructions workspaceId="ws_1" input={input} onApply={apply} />);
  await fireEvent.press(screen.getByText("Improve instructions"));
  await view.rerender(<ImproveInstructions workspaceId="ws_1" input={{ ...input, instructions: "My new draft" }} onApply={apply} />);
  await act(async () => resolve({ instructions: "Old proposal" }));
  expect(screen.queryByText("Apply suggestion")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
