import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { IncidentUpdate } from "../../api/types";
import { PUBLIC_UPDATE_MAX_LENGTH, PublicUpdateRow } from "./PublicUpdatesPanel";

const update: IncidentUpdate = {
  createdAt: "2026-08-30T10:00:00.000Z",
  createdBy: "usr_1",
  id: "iu_1",
  message: "We are investigating elevated error rates.",
};

describe("public updates", () => {
  it("keeps the API message limit", () => {
    expect(PUBLIC_UPDATE_MAX_LENGTH).toBe(2000);
  });

  it("renders the message, timestamp and admin delete control", () => {
    const html = renderToStaticMarkup(
      <PublicUpdateRow
        manage
        onDelete={() => undefined}
        timezone="Europe/Madrid"
        update={update}
      />,
    );
    expect(html).toContain("We are investigating elevated error rates.");
    expect(html).toContain('aria-label="Delete public update"');
  });

  it("hides the delete control for members", () => {
    const html = renderToStaticMarkup(
      <PublicUpdateRow
        manage={false}
        onDelete={() => undefined}
        timezone="Europe/Madrid"
        update={update}
      />,
    );
    expect(html).toContain("We are investigating elevated error rates.");
    expect(html).not.toContain("Delete public update");
  });
});
