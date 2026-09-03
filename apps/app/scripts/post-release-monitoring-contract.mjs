const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fullCommitPattern = /^[0-9a-f]{40}$/u;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const dayMs = 24 * 60 * 60 * 1_000;

export const postReleasePhases = ["RELEASE", "H_PLUS_24", "H_PLUS_48"];
export const postReleaseSignals = [
  "api",
  "appReviewMessages",
  "crashes",
  "login",
  "notifications",
  "runner",
  "support",
];

const healthyStatus = {
  api: "HEALTHY",
  appReviewMessages: "CLEAR",
  crashes: "HEALTHY",
  login: "HEALTHY",
  notifications: "HEALTHY",
  runner: "HEALTHY",
  support: "HEALTHY",
};
const allowedStatus = {
  api: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
  appReviewMessages: new Set(["CLEAR", "ACTION_REQUIRED"]),
  crashes: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
  login: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
  notifications: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
  runner: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
  support: new Set(["HEALTHY", "DEGRADED", "INCIDENT"]),
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    validDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function safeText(value, minimum = 3, maximum = 1_000) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/<[A-Z][A-Z0-9_]+>/u.test(value)
  );
}

function validateReleasedRecord(releaseRecord, failures) {
  const candidate = releaseRecord?.candidate;
  const review = releaseRecord?.appReview;
  const credentials = releaseRecord?.credentials;
  if (
    releaseRecord?.schemaVersion !== 5 ||
    releaseRecord?.app?.bundleIdentifier !== "com.zenguy.app" ||
    releaseRecord?.app?.ascAppId !== "6804201911" ||
    review?.stage !== "RELEASED" ||
    review?.status !== "READY_FOR_DISTRIBUTION" ||
    !validTimestamp(review?.releasedAt) ||
    !/^https:\/\/apps\.apple\.com\/(?:[^?#]+\/)?id6804201911$/u.test(
      review?.appStoreUrl ?? "",
    ) ||
    !validTimestamp(releaseRecord?.recordedAt) ||
    Date.parse(releaseRecord.recordedAt) < Date.parse(review.releasedAt) ||
    !fullCommitPattern.test(candidate?.commit ?? "") ||
    !uuidPattern.test(candidate?.easBuildId ?? "") ||
    !uuidPattern.test(candidate?.easSubmissionId ?? "") ||
    candidate?.easBuildUrl !==
      `https://expo.dev/accounts/maguayo/projects/zenguy/builds/${candidate?.easBuildId}` ||
    candidate?.easSubmissionUrl !==
      `https://expo.dev/accounts/maguayo/projects/zenguy/submissions/${candidate?.easSubmissionId}` ||
    !validDate(credentials?.distributionCertificateExpiresOn) ||
    !validDate(credentials?.provisioningProfileExpiresOn) ||
    !safeText(credentials?.responsible, 2, 100) ||
    credentials.responsible.includes("@")
  ) {
    failures.push("released release-record identity or lifecycle is incomplete");
  }
}

function matchingCandidate(recordCandidate, releaseRecord) {
  const releaseCandidate = releaseRecord?.candidate;
  const review = releaseRecord?.appReview;
  return (
    exactKeys(recordCandidate, [
      "appStoreUrl",
      "build",
      "commit",
      "easBuildId",
      "easBuildUrl",
      "easSubmissionId",
      "easSubmissionUrl",
      "releasedAt",
      "version",
    ]) &&
    recordCandidate.version === releaseCandidate?.version &&
    recordCandidate.build === releaseCandidate?.build &&
    recordCandidate.commit === releaseCandidate?.commit &&
    recordCandidate.easBuildId === releaseCandidate?.easBuildId &&
    recordCandidate.easBuildUrl === releaseCandidate?.easBuildUrl &&
    recordCandidate.easSubmissionId === releaseCandidate?.easSubmissionId &&
    recordCandidate.easSubmissionUrl === releaseCandidate?.easSubmissionUrl &&
    recordCandidate.appStoreUrl === review?.appStoreUrl &&
    recordCandidate.releasedAt === review?.releasedAt
  );
}

export function validatePostReleaseMonitoringRecord(
  record,
  { releaseRecord, releaseRecordSha256 } = {},
) {
  const failures = [];
  const serialized = JSON.stringify(record);
  if (/<[A-Z][A-Z0-9_]+>/u.test(serialized) || /"PENDING"/u.test(serialized)) {
    failures.push("post-release record contains unresolved placeholders or pending signals");
  }
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(serialized) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(serialized) ||
    /"(?:password|secret|token)"\s*:/iu.test(serialized)
  ) {
    failures.push("post-release record contains forbidden secret or contact material");
  }
  if (
    !exactKeys(record, [
      "candidate",
      "checkpoints",
      "completedAt",
      "credentialRenewal",
      "incidents",
      "owners",
      "releaseRecordSha256",
      "schemaVersion",
    ]) ||
    record?.schemaVersion !== 1
  ) {
    failures.push("post-release record root/schema keys are not exact");
  }

  validateReleasedRecord(releaseRecord, failures);
  if (
    !sha256Pattern.test(record?.releaseRecordSha256 ?? "") ||
    record?.releaseRecordSha256 !== releaseRecordSha256
  ) {
    failures.push("post-release record is not hash-linked to the supplied RELEASED record");
  }
  if (!matchingCandidate(record?.candidate, releaseRecord)) {
    failures.push("post-release candidate does not match the supplied RELEASED record");
  }

  const owners = record?.owners;
  if (
    !exactKeys(owners, ["credentials", "operations", "support"]) ||
    [owners?.credentials, owners?.operations, owners?.support].some(
      (owner) => !safeText(owner, 2, 100) || owner.includes("@"),
    ) ||
    owners?.credentials !== releaseRecord?.credentials?.responsible
  ) {
    failures.push("post-release owners are incomplete or differ from credential ownership");
  }

  const renewal = record?.credentialRenewal;
  const completedAt = record?.completedAt;
  if (
    !exactKeys(renewal, [
      "distributionCertificateExpiresOn",
      "nextReviewOn",
      "provisioningProfileExpiresOn",
    ]) ||
    renewal?.distributionCertificateExpiresOn !==
      releaseRecord?.credentials?.distributionCertificateExpiresOn ||
    renewal?.provisioningProfileExpiresOn !==
      releaseRecord?.credentials?.provisioningProfileExpiresOn ||
    !validDate(renewal?.nextReviewOn) ||
    !validTimestamp(completedAt)
  ) {
    failures.push("credential renewal dates or completion timestamp are incomplete");
  } else {
    const earliestExpiry = Math.min(
      Date.parse(`${renewal.distributionCertificateExpiresOn}T00:00:00Z`),
      Date.parse(`${renewal.provisioningProfileExpiresOn}T00:00:00Z`),
    );
    const nextReview = Date.parse(`${renewal.nextReviewOn}T00:00:00Z`);
    const completionDate = Date.parse(`${completedAt.slice(0, 10)}T00:00:00Z`);
    if (nextReview <= completionDate || nextReview > earliestExpiry - 30 * dayMs) {
      failures.push("next credential review must follow monitoring and precede expiry by 30 days");
    }
  }

  const releasedAt = record?.candidate?.releasedAt;
  const releaseTime = validTimestamp(releasedAt) ? Date.parse(releasedAt) : Number.NaN;
  const checkpoints = Array.isArray(record?.checkpoints) ? record.checkpoints : [];
  const issueObservations = [];
  let previousObservation = Number.NEGATIVE_INFINITY;
  for (const [index, phase] of postReleasePhases.entries()) {
    const checkpoint = checkpoints[index];
    if (
      !exactKeys(checkpoint, ["observedAt", "phase", "signals"]) ||
      checkpoint?.phase !== phase ||
      !validTimestamp(checkpoint?.observedAt) ||
      !exactKeys(checkpoint?.signals, postReleaseSignals)
    ) {
      failures.push(`post-release checkpoint ${phase} is incomplete`);
      continue;
    }
    const observed = Date.parse(checkpoint.observedAt);
    const windows = [
      [0, 4 * 60 * 60 * 1_000],
      [20 * 60 * 60 * 1_000, 28 * 60 * 60 * 1_000],
      [48 * 60 * 60 * 1_000, 56 * 60 * 60 * 1_000],
    ];
    const [minimumOffset, maximumOffset] = windows[index];
    if (
      !Number.isFinite(releaseTime) ||
      observed < releaseTime + minimumOffset ||
      observed > releaseTime + maximumOffset ||
      observed <= previousObservation ||
      (validTimestamp(completedAt) && observed > Date.parse(completedAt))
    ) {
      failures.push(`post-release checkpoint ${phase} falls outside its release window`);
    }
    previousObservation = observed;

    for (const signal of postReleaseSignals) {
      const result = checkpoint.signals[signal];
      if (
        !exactKeys(result, ["evidence", "status"]) ||
        !allowedStatus[signal].has(result?.status) ||
        !safeText(result?.evidence)
      ) {
        failures.push(`post-release checkpoint ${phase} has invalid ${signal} evidence`);
      } else if (result.status !== healthyStatus[signal]) {
        issueObservations.push({ observed, signal });
      }
    }
  }
  if (checkpoints.length !== postReleasePhases.length) {
    failures.push("post-release monitoring requires exactly three checkpoints");
  }
  const finalCheckpoint = checkpoints[2];
  if (
    finalCheckpoint !== undefined &&
    postReleaseSignals.some(
      (signal) => finalCheckpoint?.signals?.[signal]?.status !== healthyStatus[signal],
    )
  ) {
    failures.push("the H_PLUS_48 checkpoint must close with every signal healthy or clear");
  }
  if (
    validTimestamp(completedAt) &&
    validTimestamp(finalCheckpoint?.observedAt) &&
    Date.parse(completedAt) < Date.parse(finalCheckpoint.observedAt)
  ) {
    failures.push("post-release monitoring cannot complete before H_PLUS_48 evidence");
  }

  const incidents = Array.isArray(record?.incidents) ? record.incidents : [];
  const validatedIncidents = [];
  for (const incident of incidents) {
    const affectedSignals = Array.isArray(incident?.affectedSignals)
      ? incident.affectedSignals
      : [];
    if (
      !exactKeys(incident, [
        "affectedSignals",
        "openedAt",
        "reference",
        "resolvedAt",
        "summary",
      ]) ||
      !/^[A-Z0-9][A-Z0-9._/-]{2,99}$/u.test(incident?.reference ?? "") ||
      !validTimestamp(incident?.openedAt) ||
      !validTimestamp(incident?.resolvedAt) ||
      !safeText(incident?.summary, 3, 500) ||
      affectedSignals.length === 0 ||
      affectedSignals.some((signal) => !postReleaseSignals.includes(signal)) ||
      new Set(affectedSignals).size !== affectedSignals.length ||
      JSON.stringify(affectedSignals) !== JSON.stringify([...affectedSignals].sort())
    ) {
      failures.push("post-release incident evidence is incomplete or malformed");
      continue;
    }
    const opened = Date.parse(incident.openedAt);
    const resolved = Date.parse(incident.resolvedAt);
    if (
      !Number.isFinite(releaseTime) ||
      opened < releaseTime ||
      resolved < opened ||
      (validTimestamp(completedAt) && resolved > Date.parse(completedAt))
    ) {
      failures.push("post-release incident timestamps are outside the monitoring period");
      continue;
    }
    validatedIncidents.push({ ...incident, opened, resolved });
  }
  if (!Array.isArray(record?.incidents)) {
    failures.push("post-release incidents must be an array");
  }
  for (const observation of issueObservations) {
    if (
      !validatedIncidents.some(
        (incident) =>
          incident.affectedSignals.includes(observation.signal) &&
          incident.opened <= observation.observed &&
          incident.resolved >= observation.observed,
      )
    ) {
      failures.push(
        `post-release ${observation.signal} issue is not covered by a resolved incident`,
      );
    }
  }

  return [...new Set(failures)];
}
