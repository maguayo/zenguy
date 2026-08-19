import { Button } from "./Button";

export interface LoadMoreProps {
  loading?: boolean;
  nextCursor: string | null;
  onMore: () => void;
}

export function LoadMore({ loading = false, nextCursor, onMore }: LoadMoreProps) {
  if (!nextCursor) return null;
  return (
    <div className="flex justify-center pt-4">
      <Button loading={loading} onClick={onMore}>
        Load more
      </Button>
    </div>
  );
}
