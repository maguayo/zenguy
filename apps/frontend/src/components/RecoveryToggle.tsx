import { Card } from "./ui/Card";
import { Toggle } from "./ui/Toggle";

export function RecoveryToggle({
  checked,
  id,
  onBlur,
  onCheckedChange,
  resource,
}: {
  checked: boolean;
  id: string;
  onBlur?: () => void;
  onCheckedChange: (checked: boolean) => void;
  resource: "test" | "monitor";
}) {
  return (
    <Card title="Recovery">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="font-medium text-zinc-900" htmlFor={id}>
            Notify when this {resource} recovers
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            Send a recovery notification after an open incident passes.
          </p>
        </div>
        <Toggle
          checked={checked}
          id={id}
          onBlur={onBlur}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </Card>
  );
}
