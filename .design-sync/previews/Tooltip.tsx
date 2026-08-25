import { IconButton, Tooltip } from "@zenguy/frontend";
import { RefreshCw } from "lucide-react";

// Tooltip content is hover/focus-revealed (no controlled `open` prop). The
// OpenViaFocus cell autofocuses the trigger so group-focus-within shows the
// bubble in a static capture; the other cells show resting trigger anatomy.

export const OpenViaFocus = () => (
  <div style={{ display: "flex", justifyContent: "center", paddingTop: 56 }}>
    <Tooltip content="Retry this run with the same browser profile">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <button
        autoFocus
        aria-label="Retry run"
        style={{
          alignItems: "center",
          background: "#fff",
          border: "1px solid #e4e4e7",
          borderRadius: 6,
          display: "inline-flex",
          height: 32,
          justifyContent: "center",
          width: 32,
        }}
        type="button"
      >
        <RefreshCw aria-hidden="true" style={{ width: 16, height: 16, color: "#52525b" }} />
      </button>
    </Tooltip>
  </div>
);

export const IconTrigger = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <Tooltip content="Retry run">
      <IconButton aria-label="Retry run">
        <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
      </IconButton>
    </Tooltip>
    <span style={{ fontSize: 12, color: "#71717a" }}>hover or focus to reveal</span>
  </div>
);

export const TextTrigger = () => (
  <p style={{ fontSize: 13, color: "#52525b", margin: 0 }}>
    Last checked{" "}
    <Tooltip content="2026-08-25 09:41:03 UTC">
      <span style={{ textDecoration: "underline dotted", cursor: "help" }}>4 minutes ago</span>
    </Tooltip>{" "}
    from eu-west
  </p>
);
