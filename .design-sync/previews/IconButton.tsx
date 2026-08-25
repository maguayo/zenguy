import { IconButton } from "@zenguy/frontend";
import { ExternalLink, MoreHorizontal, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";

const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };

export const EditMonitor = () => (
  <IconButton aria-label="Edit monitor">
    <Pencil aria-hidden="true" style={{ width: 16, height: 16 }} />
  </IconButton>
);

export const RowActions = () => (
  <div style={row}>
    <IconButton aria-label="Run test now">
      <Play aria-hidden="true" style={{ width: 16, height: 16 }} />
    </IconButton>
    <IconButton aria-label="Retry run">
      <RefreshCw aria-hidden="true" style={{ width: 16, height: 16 }} />
    </IconButton>
    <IconButton aria-label="Open run in new tab">
      <ExternalLink aria-hidden="true" style={{ width: 16, height: 16 }} />
    </IconButton>
    <IconButton aria-label="More actions">
      <MoreHorizontal aria-hidden="true" style={{ width: 16, height: 16 }} />
    </IconButton>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <IconButton aria-label="Delete monitor" disabled>
      <Trash2 aria-hidden="true" style={{ width: 16, height: 16 }} />
    </IconButton>
    <span style={{ fontSize: 12, color: "#71717a" }}>Deleting requires admin access</span>
  </div>
);
