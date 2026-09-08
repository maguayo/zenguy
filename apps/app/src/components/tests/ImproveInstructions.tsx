import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { improveInstructions, type ImproveInstructionsInput } from "@/api/tests";
import { apiErrorMessage } from "@/lib/errors";
import { Button, Card, Small } from "@/ui";

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
  useEffect(() => {
    currentSource.current = source;
  }, [source]);
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

  return <View style={{ gap: 12 }}>
    <Button title="Improve instructions" size="sm" loading={pending}
      disabled={!/^https?:\/\//u.test(input.startUrl) || !input.instructions.trim()}
      onPress={() => void improve()} />
    <Small>AI clarifies steps and checks. Review before applying.</Small>
    {error ? <Small accessibilityRole="alert">{error}</Small> : null}
    {visible ? <Card eyebrow="Suggested instructions">
      <Small selectable>{visible.instructions}</Small>
      <Button title="Apply suggestion" onPress={() => { onApply(visible.instructions); setSuggestion(null); }} />
      <Button title="Discard" variant="ghost" onPress={() => setSuggestion(null)} />
    </Card> : null}
  </View>;
}
