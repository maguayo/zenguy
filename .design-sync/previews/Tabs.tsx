import { useState } from "react";
import { Tabs } from "@zenguy/frontend";

export const MonitorTabs = () => {
  const [value, setValue] = useState("runs");
  return (
    <Tabs
      items={[
        { key: "overview", label: "Overview" },
        { key: "runs", label: "Runs", count: 128 },
        { key: "alerts", label: "Alerts", count: 3 },
        { key: "settings", label: "Settings" },
      ]}
      label="Monitor sections"
      onChange={setValue}
      value={value}
    />
  );
};

export const WithoutCounts = () => {
  const [value, setValue] = useState("overview");
  return (
    <Tabs
      items={[
        { key: "overview", label: "Overview" },
        { key: "schedule", label: "Schedule" },
        { key: "notifications", label: "Notifications" },
      ]}
      label="Test sections"
      onChange={setValue}
      value={value}
    />
  );
};
