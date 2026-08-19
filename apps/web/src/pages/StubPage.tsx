import { PageHeader } from "../components/ui/PageHeader";

export function StubPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      <PageHeader title={title} />
    </div>
  );
}
