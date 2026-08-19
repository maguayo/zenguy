import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "../contexts/WorkspaceContext";
import { Badge } from "./ui/Badge";
import { Dropdown, type DropdownItem } from "./ui/Dropdown";

export function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { current, workspaces } = useWorkspace();

  const go = (path: string) => {
    onNavigate?.();
    navigate(path);
  };

  const items: DropdownItem[] = [
    ...workspaces.map((workspace) => ({
      icon:
        workspace.id === current.id ? (
          <Check className="size-4 text-accent-600" />
        ) : (
          <span className="block size-4" />
        ),
      label: workspace.name,
      onSelect: () => go(`/w/${workspace.id}/overview`),
      suffix: (
        <Badge tone={workspace.id === current.id ? "accent" : "neutral"}>
          {workspace.role}
        </Badge>
      ),
    })),
    {
      icon: <Plus className="size-4" />,
      label: "Create workspace",
      onSelect: () => go("/onboarding/workspace"),
      separatorBefore: true,
    },
  ];

  return (
    <Dropdown
      align="start"
      items={items}
      triggerWrapperClassName="w-full"
      trigger={
        <button
          aria-label={`Switch workspace. Current workspace: ${current.name}`}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-left transition-colors hover:bg-zinc-50"
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            {current.name}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
        </button>
      }
    />
  );
}
