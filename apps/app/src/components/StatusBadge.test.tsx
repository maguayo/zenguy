import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { StatusBadge, fallbackLabel, statusPresentation } from "./StatusBadge";

describe("StatusBadge", () => {
  it("maps known statuses and humanises unknown ones", async () => {
    expect(statusPresentation("PASSED")).toMatchObject({ label: "Passed", tone: "ok" });
    expect(statusPresentation("RUNNING")).toMatchObject({ pulse: true, tone: "info" });
    expect(statusPresentation("AMBIGUOUS")).toEqual({
      label: "Needs reconciliation",
      tone: "warn",
    });
    expect(statusPresentation("SOMETHING_ELSE")).toEqual({ label: "Something Else", tone: "neutral" });
    expect(fallbackLabel("SYSTEM_ERROR")).toBe("System Error");
  });

  it("renders the retry badge next to the status", async () => {
    await render(<StatusBadge passedAfterRetry status="PASSED" />);
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Passed after retry")).toBeTruthy();
  });
});
