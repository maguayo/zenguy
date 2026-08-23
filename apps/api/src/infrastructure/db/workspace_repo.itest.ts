import type { User } from "../../domain/users/types";
import { slugify, uniqueSlug } from "../../domain/workspaces/slug";
import type {
  Workspace,
  WorkspaceMember,
} from "../../domain/workspaces/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1MemberRepo } from "./member_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";

const USER: User = {
  id: "usr_workspace_owner",
  name: "Workspace Owner",
  email: "owner@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const WORKSPACE: Workspace = {
  id: "ws_primary",
  name: "Primary Workspace",
  slug: "primary-workspace",
  timezone: "Europe/Madrid",
  ownerUserId: USER.id,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

const MEMBER: WorkspaceMember = {
  id: "mem_owner",
  workspaceId: WORKSPACE.id,
  userId: USER.id,
  role: "OWNER",
  invitedBy: null,
  joinedAt: 1_000,
};

describe("D1WorkspaceRepo", () => {
  let workspaces: D1WorkspaceRepo;
  let members: D1MemberRepo;

  beforeEach(async () => {
    await freshDb();
    const database = testEnv().DB;
    workspaces = new D1WorkspaceRepo(database);
    members = new D1MemberRepo(database);
    await new D1UserRepo(database).insert(USER);
  });

  it("round-trips, updates, and lists a workspace with its member role", async () => {
    await workspaces.insert(WORKSPACE);
    await members.insert(MEMBER);

    await expect(workspaces.findById(WORKSPACE.id)).resolves.toEqual(WORKSPACE);
    await expect(workspaces.findBySlug(WORKSPACE.slug)).resolves.toEqual(
      WORKSPACE,
    );
    await expect(workspaces.listForUser(USER.id)).resolves.toEqual([
      { workspace: WORKSPACE, role: "OWNER" },
    ]);

    await workspaces.update(
      WORKSPACE.id,
      { name: "Renamed", timezone: "UTC" },
      2_000,
    );
    await expect(workspaces.findById(WORKSPACE.id)).resolves.toMatchObject({
      name: "Renamed",
      timezone: "UTC",
      ownerUserId: USER.id,
      updatedAt: 2_000,
    });
  });

  it("excludes soft-deleted workspaces unless explicitly requested", async () => {
    await workspaces.insert(WORKSPACE);
    await members.insert(MEMBER);
    await workspaces.softDelete(WORKSPACE.id, 2_000);

    await expect(workspaces.findById(WORKSPACE.id)).resolves.toBeNull();
    await expect(workspaces.listForUser(USER.id)).resolves.toEqual([]);
    await expect(workspaces.findById(WORKSPACE.id, true)).resolves.toEqual({
      ...WORKSPACE,
      updatedAt: 2_000,
      deletedAt: 2_000,
    });
  });

  it("uses the random suffix collision path without exceeding 40 chars", async () => {
    const longName = "A very long workspace name that exceeds forty characters";
    const occupied: Workspace = {
      ...WORKSPACE,
      slug: slugify(longName),
    };
    expect(occupied.slug.length).toBeLessThanOrEqual(40);
    await workspaces.insert(occupied);

    const slug = await uniqueSlug(workspaces, longName, () => 0.5);

    expect(slug).toMatch(/-[0-9a-z]{4}$/u);
    expect(slug.startsWith(occupied.slug.slice(0, 35))).toBe(true);
    expect(slug).toHaveLength(40);
    expect(slug).not.toBe(occupied.slug);
  });

  it("allows exactly one concurrent ownership transfer", async () => {
    const database = testEnv().DB;
    const users = new D1UserRepo(database);
    const candidateA: User = {
      ...USER,
      id: "usr_owner_candidate_a",
      email: "candidate-a@example.com",
      name: "Candidate A",
    };
    const candidateB: User = {
      ...USER,
      id: "usr_owner_candidate_b",
      email: "candidate-b@example.com",
      name: "Candidate B",
    };
    await users.insert(candidateA);
    await users.insert(candidateB);
    await workspaces.insert(WORKSPACE);
    await members.insert(MEMBER);
    await members.insert({
      ...MEMBER,
      id: "mem_owner_candidate_a",
      userId: candidateA.id,
      role: "ADMIN",
    });
    await members.insert({
      ...MEMBER,
      id: "mem_owner_candidate_b",
      userId: candidateB.id,
      role: "ADMIN",
    });

    const results = await Promise.all([
      workspaces.transferOwnership(WORKSPACE.id, USER.id, candidateA.id, 2_000),
      workspaces.transferOwnership(WORKSPACE.id, USER.id, candidateB.id, 2_000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const workspace = await workspaces.findById(WORKSPACE.id);
    expect([candidateA.id, candidateB.id]).toContain(workspace?.ownerUserId);
    const currentMembers = await members.list(WORKSPACE.id);
    expect(currentMembers.filter((member) => member.role === "OWNER")).toEqual([
      expect.objectContaining({ userId: workspace?.ownerUserId }),
    ]);
    expect(currentMembers.find((member) => member.userId === USER.id)?.role).toBe("ADMIN");
  });
});
