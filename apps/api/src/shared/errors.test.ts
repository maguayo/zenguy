import {
  AppError,
  conflict,
  forbidden,
  httpStatus,
  isAppError,
  notFound,
  validation,
  type ErrorCode,
} from "./errors";

describe("shared errors", () => {
  it.each<[ErrorCode, number]>([
    ["VALIDATION_ERROR", 400],
    ["UNAUTHORIZED", 401],
    ["INVALID_CREDENTIALS", 401],
    ["BILLING_REQUIRED", 402],
    ["EMAIL_NOT_VERIFIED", 403],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["ACTIVE_RUN_EXISTS", 409],
    ["GONE", 410],
    ["RATE_LIMITED", 429],
    ["INTERNAL", 500],
  ])("maps %s to HTTP %i", (code, expected) => {
    expect(httpStatus(code)).toBe(expected);
  });

  it("creates not-found errors", () => {
    const error = notFound("Workspace");

    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "Workspace not found",
    });
    expect(isAppError(error)).toBe(true);
  });

  it("creates forbidden and conflict errors", () => {
    expect(forbidden()).toMatchObject({ code: "FORBIDDEN" });
    expect(forbidden("Owners only").message).toBe("Owners only");
    expect(conflict("Duplicate")).toMatchObject({
      code: "CONFLICT",
      message: "Duplicate",
    });
  });

  it("attaches validation details", () => {
    const details = [{ field: "email", message: "Invalid email" }];
    const error = validation(details);

    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Invalid request",
      details,
    });
  });

  it("does not mistake arbitrary errors for AppError", () => {
    expect(isAppError(new Error("no"))).toBe(false);
    expect(isAppError(new AppError("INTERNAL", "yes"))).toBe(true);
  });
});
