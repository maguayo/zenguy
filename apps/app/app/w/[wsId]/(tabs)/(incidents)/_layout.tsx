import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/stack-options";

export const unstable_settings = { initialRouteName: "incidents/index" };

export default function IncidentsStackLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
