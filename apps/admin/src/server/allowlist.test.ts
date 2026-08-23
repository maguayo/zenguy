import { isAdminUserId, isRealUserId, parseAdminUserIds } from "./allowlist";

const USER_ONE = "usr_00000000000000000000000001";
const USER_TWO = "usr_00000000000000000000000002";

it("accepts only canonical API user ids", () => {
  expect(isRealUserId(USER_ONE)).toBe(true);
  for (const invalid of [
    "usr_seed_marcos",
    "usr_admin_marcos",
    "usr_0000000000000000000000000i",
    "usr_80000000000000000000000000",
    USER_ONE.toUpperCase(),
  ]) {
    expect(isRealUserId(invalid), invalid).toBe(false);
  }
});

it("parses a unique comma-separated allowlist and fails closed on invalid entries", () => {
  const allowlist = parseAdminUserIds(` ${USER_ONE}, ${USER_TWO} `);
  expect([...allowlist]).toEqual([USER_ONE, USER_TWO]);
  expect(isAdminUserId(allowlist, USER_ONE)).toBe(true);
  expect(isAdminUserId(allowlist, USER_ONE.toUpperCase())).toBe(false);
  expect(isAdminUserId(allowlist, "usr_seed_marcos")).toBe(false);

  for (const invalid of [undefined, "", "   ", `${USER_ONE},`, `${USER_ONE},${USER_ONE}`]) {
    expect(() => parseAdminUserIds(invalid)).toThrow(
      "ADMIN_USER_IDS must contain only",
    );
  }
});
