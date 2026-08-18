export type LogFields = Record<string, string | number | boolean | null>;

export function logEvent(event: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ event, ...fields, t: Date.now() }));
}

export function platformAlert(event: string, fields: LogFields = {}): void {
  console.error(
    JSON.stringify({ level: "platform_alert", event, ...fields, t: Date.now() }),
  );
}
