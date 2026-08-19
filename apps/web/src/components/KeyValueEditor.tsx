import { Plus, Trash2 } from "lucide-react";

import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Input } from "./ui/Input";

export interface KeyValueRow {
  key: string;
  value: string;
}

export function addKeyValue(rows: KeyValueRow[]): KeyValueRow[] {
  return [...rows, { key: "", value: "" }];
}

export function changeKeyValue(
  rows: KeyValueRow[],
  index: number,
  field: keyof KeyValueRow,
  value: string,
): KeyValueRow[] {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, [field]: value } : row,
  );
}

export function removeKeyValue(rows: KeyValueRow[], index: number): KeyValueRow[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

export function KeyValueEditor({
  keyPlaceholder,
  onChange,
  value,
  valuePlaceholder,
}: {
  keyPlaceholder: string;
  onChange: (value: KeyValueRow[]) => void;
  value: KeyValueRow[];
  valuePlaceholder: string;
}) {
  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_2.25rem] gap-2" key={index}>
          <Input
            aria-label={`Header ${index + 1} key`}
            autoComplete="off"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(event) => onChange(changeKeyValue(value, index, "key", event.target.value))}
          />
          <Input
            aria-label={`Header ${index + 1} value`}
            autoComplete="off"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(event) => onChange(changeKeyValue(value, index, "value", event.target.value))}
          />
          <IconButton
            aria-label={`Remove header ${index + 1}`}
            onClick={() => onChange(removeKeyValue(value, index))}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange(addKeyValue(value))}>
        <Plus aria-hidden="true" className="size-3.5" />
        Add header
      </Button>
    </div>
  );
}
