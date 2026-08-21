import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/lib/api";
import { importDocumentTypes, importErrorMessage, importSummaryMessage } from "./tests-list";

describe("import feedback", () => {
  it("summarizes created and updated counts", () => {
    expect(importSummaryMessage({ created: 3, updated: 2 })).toBe(
      "Import complete: 3 created, 2 updated",
    );
  });

  it("lists the first validation problems and counts the rest", () => {
    const error = new ApiError("Invalid request", {
      code: "VALIDATION_ERROR",
      details: [
        { field: "tests.0.startUrl", message: "URL is not allowed" },
        { field: "tests.1.intervalHours", message: "Too big" },
        { field: "tests.2.name", message: "Too short" },
        { field: "tests.3.name", message: "Too short" },
      ],
      status: 400,
    });
    expect(importErrorMessage(error)).toBe(
      "tests.0.startUrl: URL is not allowed; tests.1.intervalHours: Too big; tests.2.name: Too short (+1 more)",
    );
  });

  it("shows every problem when there are three or fewer", () => {
    const error = new ApiError("Invalid request", {
      code: "VALIDATION_ERROR",
      details: [{ field: "tests.0.name", message: "Required" }],
      status: 400,
    });
    expect(importErrorMessage(error)).toBe("tests.0.name: Required");
  });

  it("falls back to the plain API error message", () => {
    expect(importErrorMessage(new Error("boom"))).toBe("boom");
    expect(
      importErrorMessage(new ApiError("Invalid YAML", { code: "VALIDATION_ERROR", status: 400 })),
    ).toBe("Invalid YAML");
  });

  it("accepts YAML and JSON documents", () => {
    expect(importDocumentTypes).toContain("application/json");
    expect(importDocumentTypes).toContain("application/x-yaml");
  });
});
