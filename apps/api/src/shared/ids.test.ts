import { FakeIds } from "../test/fakes/ids";
import { ID_PREFIXES, isId, newId } from "./ids";

describe("IDs", () => {
  it("creates 1000 unique, sortable-format IDs", () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => newId(ID_PREFIXES.user)),
    );

    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^usr_[0-9a-hjkmnp-tv-z]{26}$/);
    }
  });

  it("uses the requested prefix", () => {
    expect(newId(ID_PREFIXES.workspace)).toMatch(/^ws_/);
    expect(newId(ID_PREFIXES.attempt)).toMatch(/^att_/);
  });

  it("accepts generated IDs and rejects wrong or malformed prefixes", () => {
    const id = newId(ID_PREFIXES.run);

    expect(isId(ID_PREFIXES.run, id)).toBe(true);
    expect(isId(ID_PREFIXES.user, id)).toBe(false);
    expect(isId(ID_PREFIXES.run, "run_0000000000000000000000000i")).toBe(
      false,
    );
    expect(isId(ID_PREFIXES.run, "run_too-short")).toBe(false);
  });

  it("provides deterministic sequential fake IDs", () => {
    const ids = new FakeIds();

    expect(ids.newId("usr")).toBe("usr_00000000000000000000000001");
    expect(ids.newId("ws")).toBe("ws_00000000000000000000000002");
  });
});
