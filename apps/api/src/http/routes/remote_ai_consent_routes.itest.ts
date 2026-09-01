import type { Hono } from "hono";
import { buildApp } from "../../app";
import {
  REMOTE_AI_CONSENT_VERSION,
  REMOTE_AI_PROVIDER,
} from "../../domain/users/remote_ai_consent";
import type { Workspace, WorkspaceMember } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RemoteAiConsentRepo } from "../../infrastructure/db/remote_ai_consent_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { hashPassword } from "../../shared/crypto";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const NOW = 1_780_000_000_000;
const WORKSPACE_ID = "ws_ai_consent";

function request(body: object, token: string, method = "POST"): RequestInit {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function token(app: Hono<AppEnv>, email: string): Promise<string> {
  const response = await app.request(
    "/api/auth/login",
    request({ email, password: "correct-password" }, ""),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
}

describe("remote AI consent routes", () => {
  let app: Hono<AppEnv>;
  let ownerToken: string;
  let memberToken: string;

  beforeEach(async () => {
    await freshDb();
    await freshKv();
    app = buildApp(testEnv());
    const passwordHash = await hashPassword("correct-password");
    const owner: User = {
      id: "usr_ai_owner",
      name: "AI Owner",
      email: "ai-owner@example.com",
      passwordHash,
      emailVerifiedAt: NOW,
      authVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const member: User = {
      ...owner,
      id: "usr_ai_member",
      name: "AI Member",
      email: "ai-member@example.com",
    };
    const users = new D1UserRepo(testEnv().DB);
    await users.insert(owner);
    await users.insert(member);
    const workspace: Workspace = {
      id: WORKSPACE_ID,
      name: "AI workspace",
      slug: "ai-workspace",
      timezone: "UTC",
      ownerUserId: owner.id,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    await new D1WorkspaceRepo(testEnv().DB).insert(workspace);
    const members = new D1MemberRepo(testEnv().DB);
    for (const row of [
      {
        id: "mem_ai_owner",
        workspaceId: WORKSPACE_ID,
        userId: owner.id,
        role: "OWNER",
        invitedBy: null,
        joinedAt: NOW,
      },
      {
        id: "mem_ai_member",
        workspaceId: WORKSPACE_ID,
        userId: member.id,
        role: "MEMBER",
        invitedBy: owner.id,
        joinedAt: NOW,
      },
    ] satisfies WorkspaceMember[]) {
      await members.insert(row);
    }
    ownerToken = await token(app, owner.email);
    memberToken = await token(app, member.email);
  });

  it("is default-off, requires an affirmative current-policy grant, and supports revocation", async () => {
    const path = `/api/workspaces/${WORKSPACE_ID}/remote-ai-consent`;
    const initial = await app.request(path, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      data: { active: false, provider: "OpenAI", acceptedAt: null },
    });

    const memberRead = await app.request(path, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(memberRead.status).toBe(403);

    const stalePolicy = await app.request(
      path,
      request({ consent: true, policyVersion: "old-version" }, ownerToken, "PUT"),
    );
    expect(stalePolicy.status).toBe(400);

    const granted = await app.request(
      path,
      request(
        { consent: true, policyVersion: REMOTE_AI_CONSENT_VERSION },
        ownerToken,
        "PUT",
      ),
    );
    expect(granted.status).toBe(200);
    await expect(granted.json()).resolves.toMatchObject({
      data: { active: true, provider: "OpenAI", revokedAt: null },
    });
    const repo = new D1RemoteAiConsentRepo(testEnv().DB);
    await expect(
      repo.hasActive(WORKSPACE_ID, REMOTE_AI_PROVIDER, REMOTE_AI_CONSENT_VERSION),
    ).resolves.toBe(true);

    const revoked = await app.request(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(revoked.status).toBe(204);
    await expect(
      repo.hasActive(WORKSPACE_ID, REMOTE_AI_PROVIDER, REMOTE_AI_CONSENT_VERSION),
    ).resolves.toBe(false);

    const audits = await testEnv().DB
      .prepare("SELECT action FROM audit_logs WHERE workspace_id = ? ORDER BY created_at, id")
      .bind(WORKSPACE_ID)
      .all<{ action: string }>();
    expect(new Set(audits.results.map(({ action }) => action))).toEqual(
      new Set([
        "privacy.remote_ai_consent_granted",
        "privacy.remote_ai_consent_revoked",
      ]),
    );
  });
});
