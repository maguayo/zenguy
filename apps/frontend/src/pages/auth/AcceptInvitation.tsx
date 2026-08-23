import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { acceptInvitation, getInvitation } from "../../api/invitations";
import type { PublicInvitation, User } from "../../api/types";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
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

export type InvitationAccessMode = "signedOut" | "matching" | "different";

export function invitationAccessMode(
  invitation: PublicInvitation,
  user: User | null,
): InvitationAccessMode {
  if (!user) return "signedOut";
  return user.email.toLowerCase() === invitation.email.toLowerCase()
    ? "matching"
    : "different";
}

export default function AcceptInvitation() {
  const { token: routeToken = "" } = useParams();
  const location = useLocation();
  const hasFragmentCapability = location.hash !== "";
  const fragmentToken = parseUrlCapabilityFragment(location.hash);
  const continuationPath = "/invitations/accept";
  const [token] = useState(() =>
    routeToken
      ? parseUrlCapability(routeToken)
      : hasFragmentCapability
        ? fragmentToken
        : pathCapability(continuationPath),
  );
  const { signOut, status, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    if (!routeToken && !hasFragmentCapability) return;
    const incomingToken = routeToken || fragmentToken;
    rememberPathCapability(continuationPath, incomingToken);
    redactCurrentPath(continuationPath);
  }, [fragmentToken, hasFragmentCapability, routeToken]);

  const invitation = useQuery({
    enabled: Boolean(token),
    gcTime: 0,
    queryFn: () => getInvitation(token),
    queryKey: ["invitation-link"],
  });

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async ({ workspaceId }) => {
      forgetPathCapability(continuationPath);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(`Welcome to ${invitation.data?.workspaceName ?? "your workspace"}`);
      navigate(`/w/${workspaceId}/overview`, { replace: true });
    },
  });

  useEffect(() => {
    if (invitation.error instanceof ApiError && invitation.error.code === "GONE") {
      forgetPathCapability(continuationPath);
    }
  }, [invitation.error]);

  if (!token || (invitation.isError && invitation.error instanceof ApiError && invitation.error.code === "GONE")) {
    return (
      <AuthShell title="Invitation expired">
        <p className="text-center text-sm text-zinc-600">This invitation is no longer valid.</p>
      </AuthShell>
    );
  }

  if (invitation.isPending) {
    return (
      <AuthShell title="Loading invitation">
        <div className="grid min-h-24 place-items-center">
          <Spinner label="Loading invitation" size={5} />
        </div>
      </AuthShell>
    );
  }

  if (invitation.isError) {
    return (
      <AuthShell title="Invitation">
        <ErrorState onRetry={() => void invitation.refetch()} />
      </AuthShell>
    );
  }

  const mode = invitationAccessMode(invitation.data, status === "signedIn" ? user : null);
  const role = invitation.data.role === "ADMIN" ? "Admin" : "Member";
  const next = continuationPath;

  return (
    <AuthShell
      description={
        <>
          {invitation.data.inviterName} invited you to join “{invitation.data.workspaceName}” as {role}.
        </>
      }
      title="Workspace invitation"
    >
      {mode === "signedOut" ? (
        <div className="space-y-3">
          <Link
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
            state={{ next }}
            to="/signin"
          >
            Sign in to accept
          </Link>
          <Link
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            state={{ next }}
            to="/signup"
          >
            Create an account
          </Link>
        </div>
      ) : null}

      {mode === "matching" ? (
        <Button
          className="w-full"
          loading={accept.isPending}
          onClick={() => accept.mutate()}
          variant="primary"
        >
          Accept invitation
        </Button>
      ) : null}

      {mode === "different" && user ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-warn-600/20 bg-warn-50 p-3 text-sm text-zinc-700">
            This invitation was sent to {invitation.data.email}. You're signed in as {user.email}.
          </div>
          <Button className="w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}
