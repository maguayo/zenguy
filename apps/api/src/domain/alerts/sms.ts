/**
 * SMS bodies are trimmed so that one alert is always a single billable
 * segment: 160 characters when every character is in the GSM-7 alphabet,
 * 70 UTF-16 code units otherwise (UCS-2 encoding).
 */

export const SMS_OPT_OUT_SUFFIX = " Reply STOP to opt out; HELP for help.";
export const GSM7_SINGLE_SEGMENT = 160;
export const UCS2_SINGLE_SEGMENT = 70;

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "\f^{}\\[~]|€";
const GSM7_CHARS = new Set([...GSM7_BASIC]);
const GSM7_EXTENDED = new Set([...GSM7_EXTENSION]);
const URL = /\s*\bhttps?:\/\/[^\s<>"']+/giu;

export function isGsm7(text: string): boolean {
  for (const character of text) {
    if (!GSM7_CHARS.has(character) && !GSM7_EXTENDED.has(character)) {
      return false;
    }
  }
  return true;
}

/** Length in septets (GSM-7, extension characters count twice) or UTF-16 units. */
export function smsEncodedLength(text: string): number {
  if (!isGsm7(text)) return text.length;
  let length = 0;
  for (const character of text) {
    length += GSM7_EXTENDED.has(character) ? 2 : 1;
  }
  return length;
}

export function smsSegments(text: string): number {
  const gsm = isGsm7(text);
  const length = smsEncodedLength(text);
  const single = gsm ? GSM7_SINGLE_SEGMENT : UCS2_SINGLE_SEGMENT;
  const multi = gsm ? 153 : 67;
  if (length <= single) return 1;
  return Math.ceil(length / multi);
}

function trimToLimit(text: string, limit: number): string {
  let result = "";
  let used = 0;
  for (const character of text) {
    const cost = GSM7_EXTENDED.has(character) ? 2 : 1;
    if (used + cost > limit) break;
    result += character;
    used += cost;
  }
  return result;
}

/**
 * Builds the final SMS body from the short notification text: strips links
 * (an SMS never carries the incident URL), appends the opt-out suffix, and
 * trims the alert text so the whole body fits in exactly one segment.
 */
export function smsBody(shortText: string): string {
  const core = shortText.replace(URL, "").replace(/\s+/gu, " ").trim();
  const suffix = SMS_OPT_OUT_SUFFIX;
  const full = `${core}${suffix}`;
  if (smsSegments(full) === 1) return full;
  const gsm = isGsm7(full);
  const limit = gsm ? GSM7_SINGLE_SEGMENT : UCS2_SINGLE_SEGMENT;
  const ellipsis = "...";
  const available = Math.max(
    0,
    limit - smsEncodedLength(suffix) - ellipsis.length,
  );
  const trimmed = gsm
    ? trimToLimit(core, available)
    : core.slice(0, available);
  return `${trimmed.trimEnd()}${ellipsis}${suffix}`;
}
