import { FakeWorkspaceRepo } from "../../test/fakes/repos";
import { slugify, uniqueSlug } from "./slug";

describe("workspace slugs", () => {
  it.each([
    ["My Workspace", "my-workspace"],
    ["  Déjà Vu!  ", "deja-vu"],
    ["---", "workspace"],
    ["A".repeat(50), "a".repeat(40)],
  ])("slugifies %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("returns the base slug when it is available", async () => {
    await expect(uniqueSlug(new FakeWorkspaceRepo(), "My Team")).resolves.toBe(
      "my-team",
    );
  });
});
