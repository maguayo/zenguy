import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const forbiddenMobilePaths = [
  "app/(auth)/sign-up.tsx",
  "app/verify-email.tsx",
  "app/verify-pending.tsx",
  "app/onboarding/workspace.tsx",
  "app/grants/[token].tsx",
  "app/grants/redeem.tsx",
  "app/complimentary.tsx",
  "app/w/[wsId]/setup/billing.tsx",
  "app/w/[wsId]/(tabs)/(more)/billing/index.tsx",
  "src/api/billing.ts",
  "src/api/grants.ts",
  "src/components/auth/create-workspace.ts",
  "src/components/auth/sign-up.ts",
  "src/components/auth/verify-email.ts",
  "src/components/more/billing-setup.ts",
  "src/components/more/billing.ts",
  "src/components/more/grants.ts",
  "src/components/more/PlanDetails.tsx",
  "src/hooks/useResendVerification.ts",
  "src/lib/registration-pending.ts",
];

const requiredExistingAccountCopy = {
  "app/(auth)/sign-in.tsx": "Sign in with your existing Zenguy account.",
  "app/access-unavailable.tsx": "Accounts and workspaces cannot be created here.",
  "app/invitations/accept.tsx":
    "Invitations can only be accepted by an existing Zenguy account.",
};

const forbiddenVisibleCopy = [
  /\bsign[ -]?up\b/iu,
  /\bcreate (?:an? )?account\b/iu,
  /\bcreate (?:a )?workspace\b/iu,
  /\bregister now\b/iu,
  /\bset up (?:a )?subscription\b/iu,
  /\bstart (?:a )?subscription\b/iu,
  /\bmanage billing\b/iu,
  /\bchoose (?:a )?plan\b/iu,
  /\bview pricing\b/iu,
];

const forbiddenAcquisitionRoute =
  /\/(?:\(auth\)\/sign-up|sign-up|verify-(?:email|pending)|onboarding(?:\/|["'`])|grants(?:\/|["'`])|complimentary(?:\/|["'`])|w\/[^/"'`]+\/(?:setup\/billing|billing)(?:\/|["'`]))/iu;
const routeTarget =
  /(?:href\s*=|href\s*:|pathname\s*:|router\.(?:navigate|push|replace)\s*\()\s*["'`]([^"'`]+)["'`]/gu;
const forbiddenEndpoint =
  /["'`]\/api\/(?:auth\/(?:register|resend-verification|verify-email)|billing|complimentary|grants)(?:\/|["'`])/iu;
const workspaceCreationCall =
  /\bapiPost(?:<[^;()]+>)?\s*\(\s*["'`]\/api\/workspaces["'`]/iu;
const forbiddenExternalAcquisitionUrl =
  /https:\/\/(?:app\.)?zenguy\.com\/(?:billing|checkout|plans|pricing|register|sign-up)(?:[/?#"'`]|$)/iu;

function isProductionSource(path) {
  return (
    /\.[cm]?[jt]sx?$/u.test(path) &&
    !/(?:^|\/)__tests__(?:\/|$)/u.test(path) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function walkSourceFiles(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const path = relative(root, absolute).split(sep).join("/");
    if (isProductionSource(path)) files[path] = readFileSync(absolute, "utf8");
  }
}

export function loadExistingAccountOnlyEvidence(appRoot) {
  const sources = {};
  for (const rootName of ["app", "src"]) {
    const root = join(appRoot, rootName);
    if (existsSync(root)) walkSourceFiles(appRoot, root, sources);
  }
  return {
    existingForbiddenPaths: forbiddenMobilePaths.filter((path) =>
      existsSync(join(appRoot, path)),
    ),
    sources,
  };
}

export function validateExistingAccountOnlyEvidence({
  existingForbiddenPaths = [],
  sources = {},
} = {}) {
  const failures = [];

  for (const path of existingForbiddenPaths) {
    failures.push(`forbidden acquisition path exists: ${path}`);
  }

  for (const [path, requiredCopy] of Object.entries(requiredExistingAccountCopy)) {
    const normalizedSource = sources[path]?.replace(/\s+/gu, " ");
    if (!normalizedSource?.includes(requiredCopy)) {
      failures.push(`missing existing-account-only copy in ${path}: ${requiredCopy}`);
    }
  }

  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith(".tsx")) {
      const forbiddenCopy = forbiddenVisibleCopy.find((pattern) => pattern.test(source));
      if (forbiddenCopy) {
        failures.push(`positive acquisition or purchase copy exists in ${path}`);
      }
    }

    routeTarget.lastIndex = 0;
    for (const match of source.matchAll(routeTarget)) {
      if (forbiddenAcquisitionRoute.test(match[1])) {
        failures.push(`navigation targets a forbidden acquisition route in ${path}`);
        break;
      }
    }

    if (forbiddenEndpoint.test(source) || workspaceCreationCall.test(source)) {
      failures.push(`acquisition API remains callable from ${path}`);
    }
    if (forbiddenExternalAcquisitionUrl.test(source)) {
      failures.push(`external acquisition or purchase URL exists in ${path}`);
    }
  }

  return failures;
}

export function validateExistingAccountOnlyContract(appRoot) {
  return validateExistingAccountOnlyEvidence(loadExistingAccountOnlyEvidence(appRoot));
}
