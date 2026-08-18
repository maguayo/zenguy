import { AppError } from "./errors";
import { decodeCursor, encodeCursor } from "./pagination";

describe("pagination cursors", () => {
  it("round-trips timestamp and ID as opaque base64url", () => {
    const encoded = encodeCursor(1_700_000_000_123, "run_abc123");

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual({
      createdAt: 1_700_000_000_123,
      id: "run_abc123",
    });
  });

  it.each(["", "%%%", btoa("no-separator"), btoa("NaN:id"), btoa("1:")])(
    "rejects malformed cursor %j",
    (cursor) => {
      expect(() => decodeCursor(cursor)).toThrowError(AppError);
      try {
        decodeCursor(cursor);
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      }
    },
  );
});
