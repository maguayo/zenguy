import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { CheckTick, RunTick } from "../api/types";
import {
  CheckPulseStrip,
  passRateLabel,
  PulseStrip,
  RunHistoryStrip,
} from "./PulseStrip";

function tick(id: string, status: RunTick["status"], finishedAt: string | null = "2026-08-27T10:00:00.000Z"): RunTick {
  return { finishedAt, id, status };
}

function render(runs: RunTick[], max = 20): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PulseStrip max={max} runs={runs} workspaceId="ws_1" />
    </MemoryRouter>,
  );
}

function check(
  id: string,
  status: CheckTick["status"],
  checkedAt = "2026-08-27T10:00:00.000Z",
): CheckTick {
  return { checkedAt, id, status };
}

function renderChecks(checks: CheckTick[], max = 20): string {
  return renderToStaticMarkup(<CheckPulseStrip checks={checks} max={max} />);
}

function renderHistory(
  runs: Array<{ createdAt: string; id: string; status: RunTick["status"] }>,
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunHistoryStrip runs={runs} workspaceId="ws_1" />
    </MemoryRouter>,
  );
}

describe("PulseStrip", () => {
  it("colours ticks by result, oldest on the left", () => {
    const html = render([
      tick("run_1", "PASSED"),
      tick("run_2", "FAILED"),
      tick("run_3", "TIMEOUT"),
      tick("run_4", "SYSTEM_ERROR"),
    ]);
    const order = [
      html.indexOf("bg-ok-600"),
      html.indexOf("bg-danger-600"),
      html.indexOf("bg-warn-600"),
      html.indexOf("bg-zinc-300"),
    ];
    expect(Math.min(...order)).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("links every tick to its run", () => {
    const html = render([tick("run_1", "PASSED"), tick("run_2", "FAILED")]);
    expect(html).toContain('href="/w/ws_1/runs/run_1"');
    expect(html).toContain('href="/w/ws_1/runs/run_2"');
  });

  it("pads missing history with quiet placeholders", () => {
    const html = render([tick("run_1", "PASSED")], 20);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(19);
    expect(html.match(/href=/g)).toHaveLength(1);
  });

  it("keeps only the newest ticks when history overflows", () => {
    const runs = Array.from({ length: 25 }, (_, index) =>
      tick(`run_${index + 1}`, "PASSED"),
    );
    const html = render(runs, 20);
    expect(html).not.toContain("/runs/run_5");
    expect(html).toContain("/runs/run_6");
    expect(html).toContain("/runs/run_25");
  });

  it("pulses runs that are still in progress", () => {
    expect(render([tick("run_1", "RUNNING", null)])).toContain("animate-pulse");
    expect(render([tick("run_1", "QUEUED", null)])).toContain("animate-pulse");
    expect(render([tick("run_1", "PASSED")])).not.toContain("animate-pulse");
  });

  it("labels ticks with the result and when it finished", () => {
    const finished = render([tick("run_1", "PASSED")]);
    expect(finished).toMatch(/aria-label="Passed · [^"]+"/);
    const active = render([tick("run_1", "RUNNING", null)]);
    expect(active).toContain('aria-label="Running · in progress"');
  });

  it("uses a taller track that can fill its container", () => {
    const html = render([tick("run_1", "PASSED")]);
    expect(html).toContain("h-6");
    expect(html).toContain("w-full");
  });
});

describe("CheckPulseStrip", () => {
  it("colours checks by result, oldest on the left", () => {
    const html = renderChecks([
      check("check_1", "FAILED"),
      check("check_2", "PASSED"),
      check("check_3", "FAILED"),
    ]);
    const firstFailure = html.indexOf("bg-danger-600");
    const pass = html.indexOf("bg-ok-600");
    const secondFailure = html.indexOf("bg-danger-600", firstFailure + 1);
    expect(firstFailure).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(firstFailure);
    expect(secondFailure).toBeGreaterThan(pass);
  });

  it("summarises checks once while retaining per-bar pointer titles", () => {
    const html = renderChecks([check("check_1", "PASSED")]);
    expect(html).toContain(
      'aria-label="Last 20 check slots: 1 passed, 0 failed, 19 without data; newest on the right"',
    );
    expect(html).toMatch(/title="Passed · [^"]+"/);
  });

  it("renders one aggregate graphic without interactive links", () => {
    const html = renderChecks([
      check("check_1", "PASSED"),
      check("check_2", "FAILED"),
    ]);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a");
  });

  it("pads missing history with the same quiet placeholders", () => {
    const html = renderChecks([check("check_1", "PASSED")], 20);
    expect(html.match(/bg-zinc-200\/70/g)).toHaveLength(19);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(20);
  });

  it("keeps only the newest checks when history overflows", () => {
    const checks = Array.from({ length: 25 }, (_, index) =>
      check(`check_${index + 1}`, index < 5 ? "FAILED" : "PASSED"),
    );
    const html = renderChecks(checks, 20);
    expect(html).not.toContain("bg-danger-600");
    expect(html.match(/bg-ok-600/g)).toHaveLength(20);
    expect(html.match(/role="img"/g)).toHaveLength(1);
  });

  it("has a compact density for table rows without changing the default", () => {
    const compact = renderToStaticMarkup(
      <CheckPulseStrip checks={[check("check_1", "PASSED")]} density="compact" />,
    );
    expect(compact).toContain("h-[18px]");
    expect(compact).toContain("gap-0.5");
    expect(renderChecks([check("check_1", "PASSED")])).toContain("h-6");
  });
});

describe("RunHistoryStrip", () => {
  it("links list results without calling their creation time a start or finish time", () => {
    const html = renderHistory([
      { createdAt: "2026-08-27T10:00:00.000Z", id: "run_1", status: "PASSED" },
    ]);
    expect(html).toContain('href="/w/ws_1/runs/run_1"');
    expect(html).toMatch(/aria-label="Passed · [^"]+"/);
    expect(html).not.toContain("started");
    expect(html).not.toContain("finished");
  });
});

describe("passRateLabel", () => {
  it("counts passes over completed runs only", () => {
    expect(
      passRateLabel([
        tick("run_1", "PASSED"),
        tick("run_2", "FAILED"),
        tick("run_3", "TIMEOUT"),
        tick("run_4", "PASSED"),
        tick("run_5", "RUNNING", null),
        tick("run_6", "SYSTEM_ERROR"),
      ]),
    ).toBe("2/4 passed");
  });

  it("stays quiet without completed runs", () => {
    expect(passRateLabel([])).toBeNull();
    expect(passRateLabel([tick("run_1", "QUEUED", null)])).toBeNull();
  });

  it("accepts uptime checks while preserving the same pass-rate semantics", () => {
    const checks: CheckTick[] = [
      check("check_1", "PASSED"),
      check("check_2", "FAILED"),
      check("check_3", "PASSED"),
    ];
    expect(passRateLabel(checks)).toBe("2/3 passed");
  });
});
