import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getBillingConfig } from "../../api/billing";
import {
  issueSubscriptionGrant,
  listSubscriptionGrants,
  type IssuedSubscriptionGrant,
} from "../../api/grants";
import { AccessDenied } from "../../components/AccessDenied";
import { CopyButton } from "../../components/CopyButton";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";

export default function IssueGrants() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [latest, setLatest] = useState<IssuedSubscriptionGrant>();
  const config = useQuery({
    queryFn: getBillingConfig,
    queryKey: ["billing-config"],
  });
  const grants = useQuery({
    enabled: config.data?.canIssueComplimentaryGrants === true,
    queryFn: listSubscriptionGrants,
    queryKey: ["subscription-grants"],
  });
  const issue = useMutation({
    mutationFn: () => issueSubscriptionGrant(note.trim() || undefined),
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async (issued) => {
      setLatest(issued);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["subscription-grants"] });
      toast.success("Complimentary link created");
    },
  });

  if (config.isPending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading complimentary access" size={5} />
      </div>
    );
  }
  if (config.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void config.refetch()} />
      </main>
    );
  }
  if (!config.data.canIssueComplimentaryGrants) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <AccessDenied message="You cannot issue complimentary subscription links." />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        description="Create a one-time link that activates a workspace without Paddle checkout."
        title="Complimentary links"
      />
      <div className="mt-6 grid gap-4">
        <Card title="New link">
          <Field hint="Optional. Visible only to you." htmlFor="grant-note" label="Note">
            <Input
              id="grant-note"
              maxLength={200}
              placeholder="Influencer, friend, internal…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button
            className="mt-4"
            loading={issue.isPending}
            variant="primary"
            onClick={() => issue.mutate()}
          >
            Create one-time link
          </Button>
          {latest ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <code className="min-w-0 flex-1 truncate text-sm">{latest.redeemUrl}</code>
              <CopyButton text={latest.redeemUrl} />
            </div>
          ) : null}
        </Card>
        <Card title="Issued links">
          {grants.isPending ? <Spinner label="Loading issued links" size={5} /> : null}
          {grants.isError ? (
            grants.error instanceof ApiError && grants.error.status === 403 ? (
              <AccessDenied message="You cannot issue complimentary subscription links." />
            ) : (
              <ErrorState onRetry={() => void grants.refetch()} />
            )
          ) : null}
          {grants.data?.length === 0 ? (
            <p className="text-sm text-zinc-500">No links issued yet.</p>
          ) : null}
          {grants.data && grants.data.length > 0 ? (
            <ul className="divide-y divide-zinc-200">
              {grants.data.map((grant) => (
                <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="font-medium text-zinc-900">{grant.note ?? "Untitled"}</span>
                  <span className="text-zinc-500">
                    {grant.redeemedAt
                      ? `Used ${formatDateTime(grant.redeemedAt, "UTC")}`
                      : `Expires ${formatDateTime(grant.expiresAt, "UTC")}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
