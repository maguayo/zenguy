import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { REMOTE_AI_CONSENT_REQUIRED_CODE, SystemErrorNotice } from "./SystemErrorNotice";

function render(code: string): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SystemErrorNotice code={code} wsId="ws_1" />
    </MemoryRouter>,
  );
}

describe("system error notice", () => {
  it("turns the consent error into a readable notice with a settings link", () => {
    const html = render(REMOTE_AI_CONSENT_REQUIRED_CODE);
    expect(html).toContain("authorized for this workspace");
    expect(html).toContain('href="/w/ws_1/settings#ai-data-sharing"');
    expect(html).not.toContain("System error code");
  });

  it("keeps the raw code for every other system error", () => {
    expect(render("WORKER_LOST")).toContain("System error code: WORKER_LOST");
  });
});
