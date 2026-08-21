// Hermes may not implement Intl.supportedValuesOf; fall back to a curated list
// of IANA zones that covers the workspaces Zenguy serves.
const FALLBACK_TIMEZONES = [
  "UTC",
  "Africa/Cairo", "Africa/Casablanca", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi",
  "America/Anchorage", "America/Argentina/Buenos_Aires", "America/Bogota", "America/Caracas",
  "America/Chicago", "America/Denver", "America/Halifax", "America/Lima", "America/Los_Angeles",
  "America/Mexico_City", "America/Montevideo", "America/New_York", "America/Panama", "America/Phoenix",
  "America/Santiago", "America/Sao_Paulo", "America/St_Johns", "America/Toronto", "America/Vancouver",
  "Asia/Almaty", "Asia/Baghdad", "Asia/Bangkok", "Asia/Dhaka", "Asia/Dubai", "Asia/Ho_Chi_Minh",
  "Asia/Hong_Kong", "Asia/Jakarta", "Asia/Jerusalem", "Asia/Karachi", "Asia/Kolkata", "Asia/Kuala_Lumpur",
  "Asia/Manila", "Asia/Riyadh", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Taipei",
  "Asia/Tehran", "Asia/Tokyo", "Atlantic/Azores", "Atlantic/Canary", "Atlantic/Reykjavik",
  "Australia/Adelaide", "Australia/Brisbane", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
  "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Brussels", "Europe/Bucharest",
  "Europe/Budapest", "Europe/Copenhagen", "Europe/Dublin", "Europe/Helsinki", "Europe/Istanbul",
  "Europe/Kyiv", "Europe/Lisbon", "Europe/London", "Europe/Madrid", "Europe/Moscow", "Europe/Oslo",
  "Europe/Paris", "Europe/Prague", "Europe/Rome", "Europe/Stockholm", "Europe/Vienna", "Europe/Warsaw",
  "Europe/Zurich", "Pacific/Auckland", "Pacific/Fiji", "Pacific/Honolulu",
];

export function availableTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const values = intl.supportedValuesOf?.("timeZone");
    // Some runtimes omit the plain "UTC" alias that the API accepts.
    if (values && values.length > 0) return values.includes("UTC") ? values : ["UTC", ...values];
  } catch {
    // fall through to the curated list
  }
  return FALLBACK_TIMEZONES;
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function filterTimezones(timezones: string[], filter: string): string[] {
  const needle = filter.trim().toLocaleLowerCase();
  if (!needle) return timezones;
  return timezones.filter((timezone) => timezone.toLocaleLowerCase().includes(needle));
}

export function timezoneLabel(timezone: string): string {
  return timezone.replaceAll("_", " ");
}
