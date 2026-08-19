import { useQuery } from "@tanstack/react-query";

import { getAttempt } from "../api/tests";
import { ErrorState } from "./ui/ErrorState";
import { Skeleton } from "./ui/Skeleton";

export function AttemptDetail({ attemptId, wsId }: { attemptId: string; wsId: string }) {
  const attempt = useQuery({
    queryFn: () => getAttempt(wsId, attemptId),
    queryKey: ["ws", wsId, "attempts", attemptId],
  });

  if (attempt.isPending) {
    return (
      <div aria-label="Loading attempt" className="space-y-2" role="status">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (attempt.isError) return <ErrorState onRetry={() => void attempt.refetch()} />;

  return (
    <div className="space-y-3 text-sm text-zinc-700">
      <p>{attempt.data.summary ?? "No summary was recorded."}</p>
      {attempt.data.failureReason ? (
        <p className="rounded-md bg-danger-50 px-3 py-2 text-danger-700">
          {attempt.data.failureReason}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        {attempt.data.steps.length} steps · {attempt.data.screenshots.length} screenshots
      </p>
    </div>
  );
}
