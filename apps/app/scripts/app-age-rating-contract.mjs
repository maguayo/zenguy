import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");

const expectedAnswerTuples = [
  ["In-App Controls", "Parental Controls", "NO"],
  ["In-App Controls", "Age Assurance", "NO"],
  ["Capabilities", "Unrestricted Web Access", "NO"],
  ["Capabilities", "User-Generated Content", "NO"],
  ["Capabilities", "Social Media", "NO"],
  ["Capabilities", "Social Media Disabled for Users Under 13", "NO"],
  ["Capabilities", "Messaging and Chat", "NO"],
  ["Capabilities", "Advertising", "NO"],
  ["Mature Themes", "Profanity or Crude Humor", "NONE"],
  ["Mature Themes", "Horror/Fear Themes", "NONE"],
  ["Mature Themes", "Alcohol, Tobacco, or Drug Use or References", "NONE"],
  ["Medical or Wellness", "Medical or Treatment Information", "NONE"],
  ["Medical or Wellness", "Health or Wellness Topics", "NONE"],
  ["Sexuality or Nudity", "Mature or Suggestive Themes", "NONE"],
  ["Sexuality or Nudity", "Sexual Content or Nudity", "NONE"],
  ["Sexuality or Nudity", "Graphic Sexual Content and Nudity", "NONE"],
  ["Violence", "Cartoon or Fantasy Violence", "NONE"],
  ["Violence", "Realistic Violence", "NONE"],
  ["Violence", "Prolonged Graphic or Sadistic Realistic Violence", "NONE"],
  ["Violence", "Guns or Other Weapons", "NONE"],
  ["Chance-Based Activities", "Gambling", "NO"],
  ["Chance-Based Activities", "Simulated Gambling", "NONE"],
  ["Chance-Based Activities", "Contests", "NONE"],
  ["Chance-Based Activities", "Loot Boxes", "NO"],
];

export const expectedAppAgeRatingAnswers = expectedAnswerTuples.map(
  ([section, question, answer]) => ({ section, question, answer }),
);

export const appAgeRatingConfig = JSON.parse(
  readFileSync(join(appRoot, "app-age-rating.config.json"), "utf8"),
);
export const appStoreMetadata = readFileSync(
  join(repositoryRoot, "docs", "app-store", "metadata-en-US.md"),
  "utf8",
);
export const mobileTermsSource = readFileSync(
  join(appRoot, "app", "terms.tsx"),
  "utf8",
);
export const websiteTermsSource = readFileSync(
  join(repositoryRoot, "apps", "website", "src", "pages", "terms.astro"),
  "utf8",
);

function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

function answerProjection(answers) {
  return answers.map(({ section, question, answer }) => ({
    section,
    question,
    answer,
  }));
}

function displayAnswer(answer) {
  return answer === "NO" ? "No" : answer === "NONE" ? "None" : answer;
}

function metadataRows(metadata) {
  const section =
    /## Age rating declaration\n\n([\s\S]*?)\n\n## Source checks/u.exec(
      metadata,
    )?.[1] ?? "";
  return [...section.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gmu)]
    .filter((match) => match[1] !== "Section" && match[1] !== "---")
    .map((match) => ({
      section: match[1],
      question: match[2],
      answer: match[3],
    }));
}

const expectedMetadataRows = [
  ...expectedAppAgeRatingAnswers.map(({ section, question, answer }) => ({
    section,
    question,
    answer: displayAnswer(answer),
  })),
  {
    section: "Additional Information",
    question: "Calculated Global Rating",
    answer: "4+",
  },
  {
    section: "Age Categories and Override",
    question: "Made for Kids",
    answer: "Not Applicable",
  },
  {
    section: "Age Categories and Override",
    question: "Override to Higher Age Rating",
    answer: "18+",
  },
  {
    section: "Additional Information",
    question: "Expected Display Rating",
    answer: "18+",
  },
];

export function validateAppAgeRatingContract(
  config = appAgeRatingConfig,
  metadata = appStoreMetadata,
  mobileTerms = mobileTermsSource,
  websiteTerms = websiteTermsSource,
) {
  const failures = [];
  const apple =
    config !== null && typeof config === "object" && !Array.isArray(config)
      ? config.apple
      : undefined;
  const answers = Array.isArray(apple?.answers) ? apple.answers : [];

  if (
    !hasExactKeys(config, ["apple", "configVersion", "lastReconciled"]) ||
    config?.configVersion !== 1 ||
    config?.lastReconciled !== "2026-09-01"
  ) {
    failures.push("config root/version/reconciliation date is not exact");
  }
  if (
    !hasExactKeys(apple, [
      "answers",
      "calculatedGlobalRating",
      "displayGlobalRating",
      "madeForKids",
      "overrideReason",
      "overrideToHigherAgeRating",
      "questionnaire",
      "sourceUrl",
    ]) ||
    apple?.questionnaire !==
      "Updated age rating questionnaire required since 2026-01-31" ||
    apple?.sourceUrl !==
      "https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/"
  ) {
    failures.push("Apple questionnaire identity or source is not exact");
  }
  if (
    answers.some(
      (entry) =>
        !hasExactKeys(entry, ["answer", "question", "rationale", "section"]) ||
        typeof entry.rationale !== "string" ||
        entry.rationale.trim().length < 20,
    ) ||
    JSON.stringify(answerProjection(answers)) !==
      JSON.stringify(expectedAppAgeRatingAnswers)
  ) {
    failures.push("the 24 current App Store Connect answers drifted");
  }

  const unrestrictedWeb = answers.find(
    ({ question }) => question === "Unrestricted Web Access",
  );
  const userGeneratedContent = answers.find(
    ({ question }) => question === "User-Generated Content",
  );
  if (
    !unrestrictedWeb?.rationale.includes("no address bar") ||
    !unrestrictedWeb?.rationale.includes("general-purpose embedded browser") ||
    !userGeneratedContent?.rationale.includes("private access-controlled workspace") ||
    !userGeneratedContent?.rationale.includes("not broadly distributed")
  ) {
    failures.push("dynamic private-workspace content rationale drifted");
  }

  if (
    apple?.calculatedGlobalRating !== "4+" ||
    apple?.madeForKids !== "NOT_APPLICABLE" ||
    apple?.overrideToHigherAgeRating !== "18+" ||
    apple?.displayGlobalRating !== "18+" ||
    apple?.overrideReason !==
      "The Zenguy Terms of Service require every user to be 18 or older."
  ) {
    failures.push("the Terms-driven 18+ override contract drifted");
  }

  if (
    !mobileTerms.includes("You must be 18 or older") ||
    !websiteTerms.includes("You must be at least 18")
  ) {
    failures.push("mobile and website Terms must both retain the 18+ minimum age");
  }

  if (
    JSON.stringify(metadataRows(metadata)) !==
    JSON.stringify(expectedMetadataRows)
  ) {
    failures.push("metadata age-rating table differs from structured answers");
  }
  const normalizedMetadata = metadata.replace(/\s+/gu, " ").trim();
  for (const invariant of [
    "private, access-controlled workspaces rather than broadly distributing it",
    "The content answers calculate to 4+",
    "Override to Higher Age Rating as 18+",
    "Terms of Service require every user to be 18 or older",
    "Made for Kids remains Not Applicable",
  ]) {
    if (!normalizedMetadata.includes(invariant)) {
      failures.push(`metadata age-rating rationale is missing: ${invariant}`);
    }
  }

  return failures;
}
