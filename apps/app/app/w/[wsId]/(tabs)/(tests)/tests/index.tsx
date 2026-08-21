import { Stack } from "expo-router";

import { largeTitleOptions } from "@/lib/stack-options";
import { EmptyState, Screen } from "@/ui";

export default function Placeholder() {
  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "Browser Tests" }} />
      <Screen>
        <EmptyState description="This screen is being built." title="Browser Tests" />
      </Screen>
    </>
  );
}
