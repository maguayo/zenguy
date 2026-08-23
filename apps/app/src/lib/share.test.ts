import { describe, expect, it } from "@jest/globals";

import { safeFilename, temporaryShareFilename } from "./share";

describe("safeFilename", () => {
  it("keeps simple names and strips path tricks", () => {
    expect(safeFilename("run-report.md")).toBe("run-report.md");
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("weird name?.yaml")).toBe("weird_name_.yaml");
    expect(safeFilename("")).toBe("download.txt");
    expect(safeFilename("a".repeat(200)).length).toBe(120);
  });
});

describe("temporaryShareFilename", () => {
  it("uses an app-owned random namespace and a sanitized display name", () => {
    expect(temporaryShareFilename("../../report secret.md", "fixed")).toBe(
      "zenguy-share-fixed-report_secret.md",
    );
  });
});
