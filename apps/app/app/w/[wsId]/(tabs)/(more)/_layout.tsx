import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/stack-options";

export const unstable_settings = { initialRouteName: "more/index" };

export default function MoreStackLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
