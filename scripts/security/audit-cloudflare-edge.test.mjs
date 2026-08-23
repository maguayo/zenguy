import assert from "node:assert/strict";
import test from "node:test";
import {
  auditCloudflareEdge,
  CloudflareAuditError,
  EXPECTED_CLOUDFLARE_EDGE_POLICY,
} from "./audit-cloudflare-edge.mjs";

const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "b".repeat(32);
const FREE_MANAGED_ID = "f".repeat(32);
const TOKEN = "dedicated-read-only-audit-token";
const policy = structuredClone(EXPECTED_CLOUDFLARE_EDGE_POLICY);

function envelope(result, resultInfo) {
  return Response.json({ success: true, result, result_info: resultInfo });
}

function exactCustomRule(overrides = {}) {
  return {
    id: "c".repeat(32),
    enabled: true,
    ...policy.requiredCustomRule,
    ...overrides,
  };
}

function exactRateLimitRule(index, overrides = {}) {
  return {
    id: (index === 0 ? "e" : "9").repeat(32),
    enabled: true,
    ...policy.requiredRateLimitRules[index],
    ...overrides,
  };
}

function goodFetch(overrides = {}) {
  return async (input) => {
    const url = new URL(input);
    if (url.pathname === `/client/v4/zones/${ZONE_ID}`) {
      return envelope({ name: "zenguy.com", account: { id: ACCOUNT_ID } });
    }
    if (url.pathname.includes("/firewall/access_rules/rules")) {
      const key = url.pathname.includes(`/accounts/${ACCOUNT_ID}/`)
        ? "accountAllowRules"
        : "zoneAllowRules";
      return envelope(overrides[key] ?? [], { total_pages: 1 });
    }
    if (url.pathname === `/client/v4/zones/${ZONE_ID}/rulesets/${FREE_MANAGED_ID}`) {
      return envelope(
        overrides.managedTarget ?? {
          id: FREE_MANAGED_ID,
          name: "Cloudflare Free Managed Ruleset",
          kind: "managed",
          phase: "http_request_firewall_managed",
        },
      );
    }
    const phase = url.pathname.match(/\/rulesets\/phases\/([^/]+)\/entrypoint$/u)?.[1];
    const defaults = {
      http_request_firewall_custom: [exactCustomRule()],
      http_request_firewall_managed: [
        {
          id: "d".repeat(32),
          action: "execute",
          expression: "true",
          enabled: true,
          action_parameters: { id: FREE_MANAGED_ID, version: "latest" },
        },
      ],
      http_ratelimit: [exactRateLimitRule(0), exactRateLimitRule(1)],
    };
    if (phase !== undefined) {
      const rules = Object.hasOwn(overrides.phases ?? {}, phase)
        ? overrides.phases[phase]
        : defaults[phase];
      if (rules === null) return new Response(null, { status: 404 });
      return envelope({ rules });
    }
    return new Response(null, { status: 404 });
  };
}

test("passes only exact custom/rate rules and a real Cloudflare managed target", async () => {
  const result = await auditCloudflareEdge({
    accountId: ACCOUNT_ID,
    zoneId: ZONE_ID,
    token: TOKEN,
    policy,
    fetchFn: goodFetch(),
  });
  assert.equal(result.accountIpAllowRules, 0);
  assert.equal(result.phases.http_ratelimit.expectedRuleMatches, 2);
  assert.equal(result.phases.http_ratelimit.requiredRules, 2);
  assert.equal(result.phases.http_request_firewall_managed.expectedRuleMatches, 1);
});

test("rejects a no-op custom rule even when its action is block", async () => {
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({
        phases: { http_request_firewall_custom: [exactCustomRule({ expression: "false" })] },
      }),
    }),
    /http_request_firewall_custom zenguy_block_sensitive_file_probes_v2 expected versioned rule matches: 0/u,
  );
});

test("rejects drift in rate-limit characteristics and thresholds", async () => {
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({
        phases: {
          http_ratelimit: [
            exactRateLimitRule(0, {
              ratelimit: {
                ...policy.requiredRateLimitRules[0].ratelimit,
                characteristics: ["cf.colo.id"],
              },
            }),
            exactRateLimitRule(1),
          ],
        },
      }),
    }),
    /http_ratelimit zenguy_auth_abuse_rate_limit_v1 expected versioned rule matches: 0/u,
  );
});

test("rejects arbitrary execute targets and managed overrides", async () => {
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({ managedTarget: { id: FREE_MANAGED_ID, name: "Other", kind: "managed", phase: "http_request_firewall_managed" } }),
    }),
    /http_request_firewall_managed managed ruleset expected versioned rule matches: 0/u,
  );
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({
        phases: {
          http_request_firewall_managed: [{
            id: "d".repeat(32), action: "execute", expression: "true", enabled: true,
            action_parameters: { id: FREE_MANAGED_ID, overrides: { enabled: false } },
          }],
        },
      }),
    }),
    /http_request_firewall_managed managed ruleset expected versioned rule matches: 0/u,
  );
});

test("fails on IP Allows without disclosing their IP values", async () => {
  const sensitiveIp = "198.51.100.123";
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({
        accountAllowRules: [{ mode: "whitelist", configuration: { value: sensitiveIp } }],
      }),
    }),
    (error) => {
      assert.ok(error instanceof CloudflareAuditError);
      assert.match(error.message, /account-wide IP Allow rules: 1/u);
      assert.doesNotMatch(error.message, new RegExp(sensitiveIp.replaceAll(".", "\\."), "u"));
      return true;
    },
  );
});

test("paginates the complete IP Access inventory", async () => {
  const baseFetch = goodFetch();
  const pagedFetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.includes(`/accounts/${ACCOUNT_ID}/firewall/access_rules/rules`)) {
      return url.searchParams.get("page") === "1"
        ? envelope([], { total_pages: 2 })
        : envelope([{ mode: "whitelist" }], { total_pages: 2 });
    }
    return baseFetch(input, init);
  };
  await assert.rejects(
    auditCloudflareEdge({ accountId: ACCOUNT_ID, zoneId: ZONE_ID, token: TOKEN, policy, fetchFn: pagedFetch }),
    /account-wide IP Allow rules: 1/u,
  );
});

test("fails when a required phase is absent or a skip rule is unreviewed", async () => {
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy,
      fetchFn: goodFetch({
        phases: {
          http_request_firewall_custom: [{ id: "1".repeat(32), action: "skip", enabled: true }],
          http_ratelimit: null,
        },
      }),
    }),
    /unreviewed skip.*zenguy_block_sensitive_file_probes_v2 expected versioned rule matches: 0.*zenguy_auth_abuse_rate_limit_v1 expected versioned rule matches: 0.*zenguy_resource_exhaustion_rate_limit_v1 expected versioned rule matches: 0/u,
  );
});

test("rejects policy drift before making remote requests", async () => {
  const noOpPolicy = structuredClone(policy);
  noOpPolicy.requiredCustomRule.expression = "false";
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      token: TOKEN,
      policy: noOpPolicy,
      fetchFn: async () => assert.fail("must not fetch"),
    }),
    /Invalid Cloudflare edge policy/u,
  );
});

test("binds the audit to the intended zone and sanitizes API errors", async () => {
  const wrongZoneFetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === `/client/v4/zones/${ZONE_ID}`) {
      return envelope({ name: "other.example", account: { id: ACCOUNT_ID } });
    }
    return goodFetch()(input, init);
  };
  await assert.rejects(
    auditCloudflareEdge({ accountId: ACCOUNT_ID, zoneId: ZONE_ID, token: TOKEN, policy, fetchFn: wrongZoneFetch }),
    /must identify zenguy\.com/u,
  );
  await assert.rejects(
    auditCloudflareEdge({
      accountId: ACCOUNT_ID, zoneId: ZONE_ID, token: TOKEN, policy,
      fetchFn: async () => new Response("private remote configuration", { status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/u);
      assert.doesNotMatch(error.message, /private remote configuration/u);
      return true;
    },
  );
});
