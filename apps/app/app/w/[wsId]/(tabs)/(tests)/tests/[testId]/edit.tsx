import { Stack, useLocalSearchParams } from "expo-router";

import { TestForm } from "@/components/tests/TestForm";
import { firstParam } from "@/lib/links";

export default function EditTestScreen() {
  const params = useLocalSearchParams<{ testId: string }>();
  const testId = firstParam(params.testId) ?? "";
  return (
    <>
      <Stack.Screen options={{ title: "Edit browser test" }} />
      <TestForm testId={testId} />
    </>
  );
}
