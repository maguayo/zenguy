import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import {
  FakeCnameResolver,
  FakeCustomHostnameClient,
} from "../../test/fakes/custom_hostnames";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
import { CheckCustomDomain } from "./check_custom_domain";
import { RemoveCustomDomain } from "./remove_custom_domain";
import { SetCustomDomain } from "./set_custom_domain";

const NOW = 1_756_500_000_000;
const ACTOR: User = {
  id: "usr_1",
  name: "Owner",
  email: "owner@zenguy.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function subscription(workspaceId: string): Subscription {
  return {
    id: `sub_${workspaceId}`,
    workspaceId,
    provider: "paddle",
    providerCustomerId: "ctm_1",
    providerSubscriptionId: "psub_1",
    status: "ACTIVE",
    periodStart: NOW - 1,
    periodEnd: NOW + 10_000,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function page(id: string, overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    id,
    workspaceId: "ws_1",
    slug: `slug-${id}`,
    title: "Acme Status",
    description: null,
    accentColor: null,
    theme: "SYSTEM",
    publishedAt: NOW,
    customDomain: null,
    customHostnameId: null,
    customDomainStatus: null,
    customDomainCheckedAt: null,
    createdBy: "usr_1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function build() {
  const pages = new FakeStatusPageRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const client = new FakeCustomHostnameClient();
  const cnames = new FakeCnameResolver();
  const audits: WriteAuditInput[] = [];
  const audit = {
    execute: async (entry: WriteAuditInput) => void audits.push(entry),
  };
  const clock = new FixedClock(NOW);
  const set = new SetCustomDomain(pages, subscriptions, client, audit, clock);
  const check = new CheckCustomDomain(
    pages,
    subscriptions,
    client,
    cnames,
    "customers.zenguy.com",
    clock,
  );
  const remove = new RemoveCustomDomain(
    pages,
    subscriptions,
    client,
    audit,
    clock,
  );
  return { pages, client, cnames, audits, set, check, remove, clock };
}

const baseInput = {
  workspaceId: "ws_1",
  actor: ACTOR,
  actorRole: "ADMIN" as const,
  pageId: "sp_1",
};

describe("SetCustomDomain", () => {
  it("registers the hostname at Cloudflare and persists PENDING", async () => {
    const { pages, client, audits, set } = build();
    await pages.insert(page("sp_1"));
    const updated = await set.execute({
      ...baseInput,
      hostname: "  Status.Example.COM  ",
    });
    expect(updated.customDomain).toBe("status.example.com");
    expect(updated.customDomainStatus).toBe("PENDING");
    expect(updated.customHostnameId).toBe("ch_fake_1");
    expect(client.records.get("ch_fake_1")?.hostname).toBe("status.example.com");
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.statusPageUpdated);
    expect(audits[0]?.metadata).toMatchObject({ changed: "customDomain" });
  });

  it("rejects invalid hostnames, zenguy subdomains and MEMBER role", async () => {
    const { pages, set } = build();
    await pages.insert(page("sp_1"));
    for (const hostname of [
      "not a host",
      "no-tld",
      "status.zenguy.com",
      "zenguy.com",
      "https://status.example.com",
      "status.example.com/path",
      "192.0.2.10",
    ]) {
      await expect(
        set.execute({ ...baseInput, hostname }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(
      set.execute({
        ...baseInput,
        actorRole: "MEMBER",
        hostname: "status.example.com",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a taken domain without touching Cloudflare, and a page that already has one", async () => {
    const { pages, client, set } = build();
    await pages.insert(page("sp_1"));
    await pages.insert(page("sp_2", { workspaceId: "ws_1", slug: "two" }));
    await set.execute({ ...baseInput, hostname: "status.example.com" });

    await expect(
      set.execute({
        ...baseInput,
        pageId: "sp_2",
        hostname: "status.example.com",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The pre-check spares Cloudflare: nothing new was created or removed.
    expect(client.records.size).toBe(1);
    expect(client.removed).toHaveLength(0);

    await expect(
      set.execute({ ...baseInput, hostname: "other.example.com" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cleans up the Cloudflare hostname when a concurrent writer wins the domain", async () => {
    const { pages, client, set } = build();
    await pages.insert(page("sp_1"));
    await pages.insert(page("sp_2", { workspaceId: "ws_1", slug: "two" }));
    await set.execute({ ...baseInput, hostname: "status.example.com" });

    // Simulate the race: the pre-check misses the competing writer and the
    // unique persistence layer is what rejects the duplicate.
    pages.findByCustomDomain = async () => null;
    await expect(
      set.execute({
        ...baseInput,
        pageId: "sp_2",
        hostname: "status.example.com",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.removed).toHaveLength(1);
  });

  it("returns SERVICE_UNAVAILABLE when the feature is not configured", async () => {
    const { pages } = build();
    await pages.insert(page("sp_1"));
    const subscriptions = new FakeSubscriptionRepo();
    subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
    const unconfigured = new SetCustomDomain(
      pages,
      subscriptions,
      null,
      { execute: async () => undefined },
      new FixedClock(NOW),
    );
    await expect(
      unconfigured.execute({ ...baseInput, hostname: "status.example.com" }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("CheckCustomDomain", () => {
  it("reports CNAME state and flips to ACTIVE when Cloudflare is done", async () => {
    const { pages, client, cnames, set, check } = build();
    await pages.insert(page("sp_1"));
    await set.execute({ ...baseInput, hostname: "status.example.com" });

    cnames.answers.set("status.example.com", "customers.zenguy.com");
    const record = client.records.get("ch_fake_1");
    if (record !== undefined) {
      record.status = "active";
      record.sslStatus = "active";
      record.verificationErrors = [];
    }

    const result = await check.execute(baseInput);
    expect(result).toEqual({
      domain: "status.example.com",
      status: "ACTIVE",
      cnameTarget: "customers.zenguy.com",
      cname: {
        found: true,
        correct: true,
        value: "customers.zenguy.com",
      },
      hostnameStatus: "active",
      sslStatus: "active",
      errors: [],
    });
    expect(
      (await pages.findById("ws_1", "sp_1"))?.customDomainStatus,
    ).toBe("ACTIVE");
  });

  it("stays PENDING with diagnostics while DNS or the certificate are missing", async () => {
    const { pages, cnames, set, check } = build();
    await pages.insert(page("sp_1"));
    await set.execute({ ...baseInput, hostname: "status.example.com" });
    cnames.answers.set("status.example.com", "wrong.target.example.net");

    const result = await check.execute(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.cname).toEqual({
      found: true,
      correct: false,
      value: "wrong.target.example.net",
    });
  });

  it("marks FAILED when Cloudflare no longer knows the hostname", async () => {
    const { pages, client, set, check } = build();
    await pages.insert(page("sp_1"));
    await set.execute({ ...baseInput, hostname: "status.example.com" });
    client.records.clear();

    const result = await check.execute(baseInput);
    expect(result.status).toBe("FAILED");
    expect(
      (await pages.findById("ws_1", "sp_1"))?.customDomainStatus,
    ).toBe("FAILED");
  });

  it("404s without a domain and 403s for members", async () => {
    const { pages, check } = build();
    await pages.insert(page("sp_1"));
    await expect(check.execute(baseInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      check.execute({ ...baseInput, actorRole: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("RemoveCustomDomain", () => {
  it("deletes the Cloudflare hostname and clears the columns", async () => {
    const { pages, client, audits, set, remove } = build();
    await pages.insert(page("sp_1"));
    await set.execute({ ...baseInput, hostname: "status.example.com" });

    await remove.execute(baseInput);
    expect(client.removed).toContain("ch_fake_1");
    const cleared = await pages.findById("ws_1", "sp_1");
    expect(cleared?.customDomain).toBeNull();
    expect(cleared?.customHostnameId).toBeNull();
    expect(cleared?.customDomainStatus).toBeNull();
    expect(audits.at(-1)?.metadata).toMatchObject({ changed: "customDomain" });
  });

  it("still clears locally when the Cloudflare delete fails", async () => {
    const { pages, client, set, remove } = build();
    await pages.insert(page("sp_1"));
    await set.execute({ ...baseInput, hostname: "status.example.com" });
    client.failWith = new Error("cloudflare down");

    await remove.execute(baseInput);
    expect((await pages.findById("ws_1", "sp_1"))?.customDomain).toBeNull();
  });

  it("404s when the page has no custom domain", async () => {
    const { pages, remove } = build();
    await pages.insert(page("sp_1"));
    await expect(remove.execute(baseInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
