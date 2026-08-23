import { STALE_DATA_ENCRYPTION_KEY_MARKER } from "../../domain/security/encryption";
import { writeWithActiveDataKeyRetry } from "./write_with_active_data_key";

describe("writeWithActiveDataKeyRetry", () => {
  it("re-prepares a value after a stale-DEK fence without duplicating effects", async () => {
    let prepared = 0;
    let writes = 0;
    let effects = 0;

    const value = await writeWithActiveDataKeyRetry(
      async () => `ciphertext-generation-${++prepared}`,
      async () => {
        writes += 1;
        if (writes === 1) {
          throw new Error(`D1_ERROR: ${STALE_DATA_ENCRYPTION_KEY_MARKER}`);
        }
      },
    );
    effects += 1;

    expect(value).toBe("ciphertext-generation-2");
    expect({ prepared, writes, effects }).toEqual({
      prepared: 2,
      writes: 2,
      effects: 1,
    });
  });

  it("fails closed with a conflict after three consecutive rotations", async () => {
    let prepared = 0;
    let writes = 0;

    await expect(
      writeWithActiveDataKeyRetry(
        async () => `ciphertext-generation-${++prepared}`,
        async () => {
          writes += 1;
          throw new Error(STALE_DATA_ENCRYPTION_KEY_MARKER);
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect({ prepared, writes }).toEqual({ prepared: 3, writes: 3 });
  });

  it("does not retry unrelated persistence errors", async () => {
    let prepared = 0;

    await expect(
      writeWithActiveDataKeyRetry(
        async () => `ciphertext-${++prepared}`,
        async () => {
          throw new Error("UNIQUE constraint failed");
        },
      ),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(prepared).toBe(1);
  });
});
