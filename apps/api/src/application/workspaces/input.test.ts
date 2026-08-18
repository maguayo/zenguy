import { workspaceName, workspaceTimezone } from "./input";

describe("workspace input", () => {
  it("trims a valid name and accepts an IANA timezone", () => {
    expect(workspaceName("  Acme Team  ")).toBe("Acme Team");
    expect(workspaceTimezone("Europe/Madrid")).toBe("Europe/Madrid");
  });

  it.each(["", "   ", "x".repeat(81)])("rejects invalid name %j", (name) => {
    expect(() => workspaceName(name)).toThrow();
  });

  it("returns a timezone field error for an invalid zone", () => {
    expect(() => workspaceTimezone("Mars/Olympus_Mons")).toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: [{ field: "timezone", message: "Invalid timezone" }],
      }),
    );
  });
});
