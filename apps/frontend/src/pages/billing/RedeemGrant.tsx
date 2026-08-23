import { useEffect, useLayoutEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { complimentaryWorkspaces, getSubscriptionGrant, redeemSubscriptionGrant } from "../../api/grants";
import { createWorkspace, listWorkspaces } from "../../api/workspaces";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import {
  forgetPathCapability,
  parseUrlCapability,
  parseUrlCapabilityFragment,
  pathCapability,
  redactCurrentPath,
  rememberPathCapability,
} from "../../lib/url-capabilities";

export default function RedeemGrant() {
  const { token: routeToken = "" } = useParams();
  const location = useLocation();
  const hasFragmentCapability = location.hash !== "";
  const fragmentToken = parseUrlCapabilityFragment(location.hash);
  const continuationPath = "/grants/redeem";
  const [token] = useState(() =>
    routeToken
      ? parseUrlCapability(routeToken)
      : hasFragmentCapability
        ? fragmentToken
        : pathCapability(continuationPath),
  );
  const { status, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workspaceName, setWorkspaceName] = useState(
    user ? `${user.name.split(/\s+/u)[0] ?? "My"}'s Workspace` : "My Workspace",
  );
  const [selectedId, setSelectedId] = useState("");

  useLayoutEffect(() => {
    if (!routeToken && !hasFragmentCapability) return;
    const incomingToken = routeToken || fragmentToken;
    rememberPathCapability(continuationPath, incomingToken);
    redactCurrentPath(continuationPath);
  }, [fragmentToken, hasFragmentCapability, routeToken]);

  const grant = useQuery({
    enabled: Boolean(token),
    gcTime: 0,
    queryFn: () => getSubscriptionGrant(token),
    queryKey: ["subscription-grant-link"],
  });
  const workspaces = useQuery({
    enabled: status === "signedIn",
    queryFn: listWorkspaces,
    queryKey: ["workspaces"],
  });

  const redeem = useMutation({
    mutationFn: async () => {
      let workspaceId = selectedId;
      const eligible = complimentaryWorkspaces(workspaces.data ?? []);
      if (workspaceId === "" && eligible[0]) workspaceId = eligible[0].id;
      if (workspaceId === "") {
        const created = await createWorkspace({
          name: workspaceName.trim() || "Complimentary workspace",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        workspaceId = created.id;
      }
      return redeemSubscriptionGrant(token, workspaceId);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async ({ workspaceId }) => {
      forgetPathCapability(continuationPath);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Complimentary access is active");
      navigate(`/w/${workspaceId}/overview`, { replace: true });
    },
  });

  useEffect(() => {
    if (grant.error instanceof ApiError && grant.error.code === "GONE") {
      forgetPathCapability(continuationPath);
    }
  }, [grant.error]);

  if (!token || (grant.isError && grant.error instanceof ApiError && grant.error.code === "GONE")) {
    return (
      <AuthShell title="Link already used">
        <p className="text-center text-sm text-zinc-600">
          This complimentary link is invalid or has already been used.
        </p>
      </AuthShell>
    );
  }

  if (grant.isPending) {
    return (
      <AuthShell title="Complimentary access">
        <div className="grid min-h-24 place-items-center">
          <Spinner label="Loading complimentary link" size={5} />
        </div>
      </AuthShell>
    );
  }

  if (grant.isError) {
    return (
      <AuthShell title="Complimentary access">
        <ErrorState onRetry={() => void grant.refetch()} />
      </AuthShell>
    );
  }

  const next = continuationPath;
  const eligible = complimentaryWorkspaces(workspaces.data ?? []);

  return (
    <AuthShell
      description="Activate a workspace without adding a payment method."
      title="Complimentary access"
    >
      {status !== "signedIn" ? (
        <div className="space-y-3">
          <Link
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
            state={{ next }}
            to="/signin"
          >
            Sign in to redeem
          </Link>
          <Link
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            state={{ next }}
            to="/signup"
          >
            Create an account
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {eligible.length > 0 ? (
            <Field htmlFor="grant-workspace" label="Workspace">
              <Select
                id="grant-workspace"
                value={selectedId || eligible[0]?.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {eligible.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              hint="None of your workspaces are unpaid, so we will create a new one."
              htmlFor="grant-workspace-name"
              label="New workspace name"
            >
              <Input
                id="grant-workspace-name"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </Field>
          )}
          <Button
            className="w-full"
            loading={redeem.isPending}
            variant="primary"
            onClick={() => redeem.mutate()}
          >
            Activate complimentary access
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
