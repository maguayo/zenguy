import { useMemo } from "react";

import { availableTimezones, timezoneLabel } from "@/lib/timezones";
import { SelectSheet } from "@/ui";

export function TimezonePicker({
  invalid = false,
  onChange,
  value,
}: {
  invalid?: boolean;
  onChange: (timezone: string) => void;
  value: string;
}) {
  const options = useMemo(() => {
    const zones = availableTimezones();
    const list = zones.includes(value) || !value ? zones : [value, ...zones];
    return list.map((zone) => ({ label: timezoneLabel(zone), value: zone }));
  }, [value]);
  return (
    <SelectSheet
      accessibilityLabel="Timezone"
      invalid={invalid}
      options={options}
      placeholder="Choose a timezone"
      searchable
      title="Timezone"
      value={value || null}
      onChange={onChange}
    />
  );
}
