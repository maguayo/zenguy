import { ulid } from "ulid";

export const ID_PREFIXES = {
  user: "usr",
  emailToken: "tok",
  refreshToken: "rt",
  workspace: "ws",
  member: "mem",
  invitation: "inv",
  auditLog: "aud",
  subscription: "sub",
  subscriptionGrant: "sgr",
  usageEvent: "ue",
  overageReport: "ovr",
  secret: "sec",
  channel: "ch",
  delivery: "del",
  browserTest: "bt",
  run: "run",
  attempt: "att",
  runStep: "step",
  artifact: "art",
  monitor: "mon",
  checkCycle: "cyc",
  check: "chk",
  incident: "inc",
  incidentEvent: "evt",
  queueOutbox: "out",
  durableJob: "job",
  apiKey: "ak",
  alertCreditEntry: "ace",
  pushDevice: "pd",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

export interface IdGenerator {
  newId(prefix: IdPrefix): string;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}

export function isId(prefix: IdPrefix, value: string): boolean {
  const separator = value.indexOf("_");
  if (separator === -1 || value.slice(0, separator) !== prefix) {
    return false;
  }
  return /^[0-9a-hjkmnp-tv-z]{26}$/.test(value.slice(separator + 1));
}

export const realIds: IdGenerator = { newId };
