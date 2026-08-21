import { Feather } from "@expo/vector-icons";

import { colors } from "@/theme";
import { Card, EmptyState } from "@/ui";

/** Mirrors the web's AccessDenied card. */
export function AccessDenied({ message }: { message: string }) {
  return (
    <Card>
      <EmptyState
        description={message}
        icon={<Feather color={colors.zinc500} name="shield" size={28} />}
        title="Access denied"
      />
    </Card>
  );
}
