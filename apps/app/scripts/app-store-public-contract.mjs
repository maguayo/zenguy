import { Buffer } from "node:buffer";

export const maxPublicDocumentBytes = 2_000_000;

export const htmlPrerequisites = [
  {
    outputPath: "support/index.html",
    url: "https://zenguy.com/support/",
    invariants: [
      "Zenguy for iOS is a free companion app",
      "does not create accounts or workspaces",
      "There is no registration option in the iOS app",
      "More → Account → Delete my account",
    ],
  },
  {
    outputPath: "privacy-choices/index.html",
    url: "https://zenguy.com/privacy-choices/",
    invariants: [
      "Delete your account",
      "OpenAI processing starts off",
      "the backend does not release the run to the runner or to OpenAI",
      "The iOS app contains no Google Analytics SDK",
    ],
  },
  {
    outputPath: "privacy/index.html",
    url: "https://zenguy.com/privacy/",
    invariants: [
      "OpenAI, LLC",
      "only after current workspace consent",
      "Account and workspace deletion",
      "Privacy choices",
    ],
  },
];

export const expectedAasa = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ["HT84Q65URB.com.zenguy.app"],
        components: [
          { "/": "/reset-password", comment: "One-time password reset links" },
          { "/": "/invitations/*", comment: "Workspace invitation links" },
          {
            "/": "/w/*",
            comment: "Authenticated workspace and push destinations",
          },
        ],
      },
      {
        appID: "HT84Q65URB.com.zenguy.app",
        paths: ["/reset-password", "/invitations/*", "/w/*"],
      },
    ],
  },
};

export function normalized(value) {
  return value.replace(/\s+/gu, " ").trim();
}

export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  }
  return value;
}

export function validateHtmlPrerequisite(definition, body) {
  const failures = [];
  if (typeof body !== "string" || Buffer.byteLength(body) > maxPublicDocumentBytes) {
    return ["document is missing, unreadable or exceeds the bounded release size"];
  }
  if (!body.includes(`<link rel="canonical" href="${definition.url}">`)) {
    failures.push(`canonical URL must be ${definition.url}`);
  }
  const hasNoIndex = [...body.matchAll(/<meta\b[^>]*>/giu)].some(
    ([tag]) =>
      /\bname\s*=\s*["']robots["']/iu.test(tag) &&
      /\bcontent\s*=\s*["'][^"']*\bnoindex\b[^"']*["']/iu.test(tag),
  );
  if (hasNoIndex) {
    failures.push("production App Store prerequisite must remain indexable");
  }
  const text = normalized(body);
  for (const invariant of definition.invariants) {
    if (!text.includes(invariant)) failures.push(`missing published copy ${invariant}`);
  }
  return failures;
}

export function validateAasaDocument(document) {
  return JSON.stringify(ordered(document)) === JSON.stringify(ordered(expectedAasa))
    ? []
    : ["AASA does not exactly match the reviewed existing-account-only route set"];
}
