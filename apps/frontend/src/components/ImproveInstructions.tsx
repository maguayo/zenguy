import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { improveInstructions, type ImproveInstructionsInput } from "../api/tests";
import { apiErrorMessage } from "../lib/errors";
import { Button } from "./ui/Button";

export function ImproveInstructions({ workspaceId, input, onApply }: {
  workspaceId: string;
  input: ImproveInstructionsInput;
  onApply: (instructions: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ source: string; instructions: string } | null>(null);
  const source = JSON.stringify({ workspaceId, ...input });
  const currentSource = useRef(source);
  currentSource.current = source;
  const valid = /^https?:\/\//u.test(input.startUrl) && input.instructions.trim().length > 0;
  const visible = suggestion?.source === source ? suggestion : null;

  async function improve() {
    if (pending) return;
    setPending(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await improveInstructions(workspaceId, input);
      if (currentSource.current === source) setSuggestion({ source, ...result });
    } catch (cause) {
      if (currentSource.current === source) setError(apiErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return <div className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!valid} loading={pending} onClick={() => void improve()} size="sm">
        <Sparkles aria-hidden="true" className="size-4" /> Improve instructions
      </Button>
      <p className="text-xs text-zinc-500">AI clarifies steps and checks. Review before applying.</p>
    </div>
    {error ? <p role="alert" className="text-sm text-danger-600">{error}</p> : null}
    {visible ? <div className="space-y-3 rounded-lg border border-accent-600/20 bg-accent-50 p-4" aria-label="Suggested instructions">
      <h3 className="text-sm font-semibold">Suggested instructions</h3>
      <p className="max-h-96 overflow-auto whitespace-pre-wrap text-sm text-zinc-800">{visible.instructions}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => { onApply(visible.instructions); setSuggestion(null); }}>Apply suggestion</Button>
        <Button size="sm" onClick={() => setSuggestion(null)}>Discard</Button>
      </div>
    </div> : null}
  </div>;
}
