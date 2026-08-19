import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Card } from "./Card";
import { DescriptionList } from "./DescriptionList";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { PageHeader } from "./PageHeader";
import { TableSkeleton } from "./Skeleton";

describe("layout primitives", () => {
  it("uses bordered cards without a default shadow", () => {
    const html = renderToStaticMarkup(<Card title="Configuration">Content</Card>);

    expect(html).toContain("border-zinc-200");
    expect(html).toContain("p-4");
    expect(html).not.toContain("shadow");
  });

  it("wraps page actions for narrow screens", () => {
    const html = renderToStaticMarkup(
      <PageHeader actions={<button type="button">Create</button>} title="Tests" />,
    );

    expect(html).toContain("flex-wrap");
    expect(html).toContain("Create");
  });

  it("renders semantic description lists", () => {
    const html = renderToStaticMarkup(
      <DescriptionList items={[{ label: "Status", value: "Active" }]} />,
    );

    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
  });

  it("renders the required empty-state hierarchy", () => {
    const html = renderToStaticMarkup(
      <EmptyState description="Create one to continue." title="No tests yet" />,
    );

    expect(html).toContain("No tests yet");
    expect(html).toContain("Create one to continue.");
    expect(html).toContain("border-dashed");
  });

  it("renders five loading rows", () => {
    const html = renderToStaticMarkup(<TableSkeleton columns={2} />);

    expect(html.match(/grid-template-columns/g)).toHaveLength(5);
  });

  it("provides the standard retry error state", () => {
    const html = renderToStaticMarkup(<ErrorState onRetry={() => undefined} />);

    expect(html).toContain("Something went wrong. Please try again.");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain('role="alert"');
  });
});
