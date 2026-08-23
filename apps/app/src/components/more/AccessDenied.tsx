import { Card, EmptyState, IconTile } from "@/ui";

/** Mirrors the web's AccessDenied card. */
export function AccessDenied({ message }: { message: string }) {
  return (
    <Card>
      <EmptyState description={message} icon={<IconTile icon="shield" size={44} />} title="Access denied" />
    </Card>
  );
}
