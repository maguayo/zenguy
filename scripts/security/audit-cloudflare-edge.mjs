import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_POLICY_URL = new URL(
  "../../security/cloudflare-edge-policy.json",
  import.meta.url,
);
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_PAGES = 1_000;
const PAGE_SIZE = 100;

const REQUIRED_POLICY_CONTRACT = {
  policyVersion: 3,
  zoneName: "zenguy.com",
  maximumAccountIpAllowRules: 0,
  maximumZoneIpAllowRules: 0,
  requiredCustomRule: {
    phase: "http_request_firewall_custom",
    ref: "zenguy_block_sensitive_file_probes_v2",
    description: "Block sensitive probes and truncated API headers (v2)",
    action: "block",
    expression:
      '(http.request.uri.path eq "/.env") or (http.request.uri.path eq "/.git/config") or (starts_with(http.request.uri.path, "/api/") and http.request.headers.truncated)',
  },
  requiredManagedRule: {
    phase: "http_request_firewall_managed",
    action: "execute",
    expression: "true",
    allowedTargetRulesets: [
      { name: "Cloudflare Free Managed Ruleset" },
      {
        name: "Cloudflare Managed Ruleset",
        id: "efb7b8c949ac4650a09736fc376e9aee",
      },
    ],
  },
  requiredRateLimitRules: [
    {
      phase: "http_ratelimit",
      ref: "zenguy_auth_abuse_rate_limit_v1",
      description: "Managed challenge for abusive authentication traffic (v1)",
      action: "managed_challenge",
      expression:
        '(http.request.uri.path eq "/api/auth/register") or (http.request.uri.path eq "/api/auth/login") or (http.request.uri.path eq "/api/auth/resend-verification") or (http.request.uri.path eq "/api/auth/forgot-password") or (http.request.uri.path eq "/api/auth/reset-password")',
      ratelimit: {
        characteristics: ["cf.colo.id", "ip.src"],
        period: 10,
        requests_per_period: 10,
        mitigation_timeout: 0,
      },
    },
    {
      phase: "http_ratelimit",
      ref: "zenguy_resource_exhaustion_rate_limit_v1",
      description:
        "Block abusive runner, webhook and expensive workspace traffic (v1)",
      action: "block",
      expression:
        '(http.request.uri.path eq "/api/webhooks/stripe") or starts_with(http.request.uri.path, "/api/runner/") or (starts_with(http.request.uri.path, "/api/workspaces/") and ((http.request.uri.path contains "/browser-tests/") or (http.request.uri.path contains "/runs") or (http.request.uri.path contains "/channels")))',
      ratelimit: {
        characteristics: ["cf.colo.id", "ip.src"],
        period: 10,
        requests_per_period: 120,
        mitigation_timeout: 60,
      },
    },
  ],
};

export const EXPECTED_CLOUDFLARE_EDGE_POLICY = Object.freeze({
  ...REQUIRED_POLICY_CONTRACT,
  allowedSkipRuleIds: [],
});

export class CloudflareAuditError extends Error {}

function assertIdentifier(name, value) {
  if (typeof value !== "string" || !CLOUDFLARE_ID_PATTERN.test(value)) {
    throw new CloudflareAuditError(`${name} must be a 32-character Cloudflare ID`);
  }
  return value;
}

function validatePolicy(policy) {
  if (policy === null || typeof policy !== "object") {
    throw new CloudflareAuditError("Invalid Cloudflare edge policy");
  }
  const { allowedSkipRuleIds, ...contract } = policy;
  if (
    !isDeepStrictEqual(contract, REQUIRED_POLICY_CONTRACT) ||
    !Array.isArray(allowedSkipRuleIds) ||
    allowedSkipRuleIds.some(
      (id) => typeof id !== "string" || !CLOUDFLARE_ID_PATTERN.test(id),
    ) ||
    new Set(allowedSkipRuleIds).size !== allowedSkipRuleIds.length
  ) {
    throw new CloudflareAuditError("Invalid Cloudflare edge policy");
  }
  return policy;
}

async function cloudflareGet(fetchFn, token, pathname, label, allowNotFound = false) {
  let response;
  try {
    response = await fetchFn(`${API_BASE}${pathname}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CloudflareAuditError(`Cloudflare API request failed for ${label}`);
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new CloudflareAuditError(
      `Cloudflare API request failed for ${label} (HTTP ${response.status})`,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new CloudflareAuditError(`Cloudflare API returned invalid JSON for ${label}`);
  }
  if (body?.success !== true || !("result" in body)) {
    throw new CloudflareAuditError(`Cloudflare API returned an invalid envelope for ${label}`);
  }
  return body;
}

async function countIpAllowRules(fetchFn, token, scope, scopeId) {
  let count = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      mode: "whitelist",
      page: String(page),
      per_page: String(PAGE_SIZE),
    });
    const body = await cloudflareGet(
      fetchFn,
      token,
      `/${scope}/${scopeId}/firewall/access_rules/rules?${query}`,
      `${scope} IP Access rules page ${page}`,
    );
    if (!Array.isArray(body.result)) {
      throw new CloudflareAuditError(
        `Cloudflare API returned an invalid IP Access inventory for ${scope}`,
      );
    }
    count += body.result.filter((rule) => rule?.mode === "whitelist").length;
    const totalPages = body.result_info?.total_pages;
    if (
      (Number.isSafeInteger(totalPages) && page >= totalPages) ||
      (!Number.isSafeInteger(totalPages) && body.result.length < PAGE_SIZE)
    ) {
      return count;
    }
  }
  throw new CloudflareAuditError(`Cloudflare IP Access pagination exceeded its limit for ${scope}`);
}

async function getPhaseRules(fetchFn, token, zoneId, phase) {
  const body = await cloudflareGet(
    fetchFn,
    token,
    `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`,
    `${phase} entry point`,
    true,
  );
  if (body === null) return [];
  if (!Array.isArray(body.result?.rules)) {
    throw new CloudflareAuditError(
      `Cloudflare API returned an invalid ruleset for ${phase}`,
    );
  }
  return body.result.rules;
}

function matchesVersionedRule(rule, expected, includeRateLimit) {
  return (
    rule?.enabled === true &&
    rule.ref === expected.ref &&
    rule.description === expected.description &&
    rule.action === expected.action &&
    rule.expression === expected.expression &&
    (!includeRateLimit || isDeepStrictEqual(rule.ratelimit, expected.ratelimit))
  );
}

function managedTargetId(rule, expected) {
  const parameters = rule?.action_parameters;
  if (
    rule?.enabled !== true ||
    rule.action !== expected.action ||
    rule.expression !== expected.expression ||
    parameters === null ||
    typeof parameters !== "object" ||
    !CLOUDFLARE_ID_PATTERN.test(parameters.id) ||
    (parameters.version !== undefined && parameters.version !== "latest") ||
    Object.keys(parameters).some((key) => key !== "id" && key !== "version")
  ) {
    return null;
  }
  return parameters.id;
}

async function isApprovedManagedTarget(fetchFn, token, zoneId, targetId, expected) {
  const body = await cloudflareGet(
    fetchFn,
    token,
    `/zones/${zoneId}/rulesets/${targetId}`,
    "managed ruleset metadata",
    true,
  );
  const target = body?.result;
  if (
    target?.id !== targetId ||
    target.kind !== "managed" ||
    target.phase !== expected.phase
  ) {
    return false;
  }
  return expected.allowedTargetRulesets.some(
    (allowed) =>
      target.name === allowed.name &&
      (allowed.id === undefined || target.id === allowed.id),
  );
}

export async function auditCloudflareEdge({
  accountId,
  zoneId,
  token,
  policy,
  fetchFn = fetch,
}) {
  assertIdentifier("CLOUDFLARE_ACCOUNT_ID", accountId);
  assertIdentifier("CLOUDFLARE_ZONE_ID", zoneId);
  if (
    typeof token !== "string" ||
    token.length < 20 ||
    token !== token.trim() ||
    /[\r\n]/u.test(token)
  ) {
    throw new CloudflareAuditError(
      "CLOUDFLARE_SECURITY_AUDIT_TOKEN is missing or invalid",
    );
  }
  const checkedPolicy = validatePolicy(policy);
  const zone = await cloudflareGet(fetchFn, token, `/zones/${zoneId}`, "zone identity");
  if (
    zone.result?.name !== checkedPolicy.zoneName ||
    zone.result?.account?.id !== accountId
  ) {
    throw new CloudflareAuditError(
      `CLOUDFLARE_ZONE_ID must identify ${checkedPolicy.zoneName} in the configured account`,
    );
  }

  const accountIpAllowRules = await countIpAllowRules(
    fetchFn,
    token,
    "accounts",
    accountId,
  );
  const zoneIpAllowRules = await countIpAllowRules(fetchFn, token, "zones", zoneId);
  const failures = [];
  if (accountIpAllowRules > checkedPolicy.maximumAccountIpAllowRules) {
    failures.push(
      `account-wide IP Allow rules: ${accountIpAllowRules} (maximum ${checkedPolicy.maximumAccountIpAllowRules})`,
    );
  }
  if (zoneIpAllowRules > checkedPolicy.maximumZoneIpAllowRules) {
    failures.push(
      `zone IP Allow rules: ${zoneIpAllowRules} (maximum ${checkedPolicy.maximumZoneIpAllowRules})`,
    );
  }

  const requirements = [
    checkedPolicy.requiredCustomRule,
    checkedPolicy.requiredManagedRule,
    ...checkedPolicy.requiredRateLimitRules,
  ];
  const allowedSkipRuleIds = new Set(checkedPolicy.allowedSkipRuleIds);
  const phaseSummaries = {};
  const phaseRules = new Map();
  for (const requirement of requirements) {
    let rules = phaseRules.get(requirement.phase);
    if (rules === undefined) {
      rules = await getPhaseRules(fetchFn, token, zoneId, requirement.phase);
      phaseRules.set(requirement.phase, rules);
    }
    const enabled = rules.filter((rule) => rule?.enabled === true);
    if (phaseSummaries[requirement.phase] === undefined) {
      const unapprovedSkipCount = enabled.filter(
        (rule) => rule.action === "skip" && !allowedSkipRuleIds.has(rule.id),
      ).length;
      phaseSummaries[requirement.phase] = {
        enabledRules: enabled.length,
        expectedRuleMatches: 0,
        requiredRules: 0,
        unapprovedSkipRules: unapprovedSkipCount,
      };
      if (unapprovedSkipCount > 0) {
        failures.push(
          `${requirement.phase} has ${unapprovedSkipCount} enabled, unreviewed skip rule(s)`,
        );
      }
    }
    let expectedRuleMatches = 0;
    if (requirement === checkedPolicy.requiredManagedRule) {
      for (const rule of enabled) {
        const targetId = managedTargetId(rule, requirement);
        if (
          targetId !== null &&
          (await isApprovedManagedTarget(
            fetchFn,
            token,
            zoneId,
            targetId,
            requirement,
          ))
        ) {
          expectedRuleMatches += 1;
        }
      }
    } else {
      expectedRuleMatches = enabled.filter((rule) =>
        matchesVersionedRule(
          rule,
          requirement,
          requirement.phase === "http_ratelimit",
        ),
      ).length;
    }
    phaseSummaries[requirement.phase].expectedRuleMatches += expectedRuleMatches;
    phaseSummaries[requirement.phase].requiredRules += 1;
    if (expectedRuleMatches !== 1) {
      failures.push(
        `${requirement.phase} ${requirement.ref ?? "managed ruleset"} expected versioned rule matches: ${expectedRuleMatches} (required exactly 1)`,
      );
    }
  }

  if (failures.length > 0) {
    throw new CloudflareAuditError(`Cloudflare edge policy failed: ${failures.join("; ")}`);
  }
  return { accountIpAllowRules, zoneIpAllowRules, phases: phaseSummaries };
}

async function main() {
  const policy = JSON.parse(readFileSync(DEFAULT_POLICY_URL, "utf8"));
  const result = await auditCloudflareEdge({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
    token: process.env.CLOUDFLARE_SECURITY_AUDIT_TOKEN,
    policy,
  });
  console.log("Cloudflare edge audit passed");
  console.log(`Account-wide IP Allow rules: ${result.accountIpAllowRules}`);
  console.log(`Zone IP Allow rules: ${result.zoneIpAllowRules}`);
  for (const [phase, summary] of Object.entries(result.phases)) {
    console.log(`${phase}: ${summary.expectedRuleMatches} expected rule match(es)`);
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Cloudflare edge audit failed");
    process.exitCode = 1;
  });
}
