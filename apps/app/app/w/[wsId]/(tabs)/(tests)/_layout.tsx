import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/stack-options";

export const unstable_settings = { initialRouteName: "tests/index" };

export default function TestsStackLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
