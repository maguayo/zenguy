import { Stack } from "expo-router";

import { TestForm } from "@/components/tests/TestForm";

export default function NewTestScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "New browser test" }} />
      <TestForm />
    </>
  );
}
