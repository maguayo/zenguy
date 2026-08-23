#!/usr/bin/env python3
"""Local, non-destructive smoke test for the real browser-use execution path."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import browser_worker as worker


class SmokeApp:
    def __init__(self) -> None:
        self.steps = 0
        self.outcome: dict[str, Any] | None = None

    async def start(self, reference: dict[str, Any]) -> dict[str, str]:
        return {"disposition": "STARTED"}

    async def post_step(
        self, reference: dict[str, Any], step: dict[str, Any]
    ) -> bool:
        self.steps += 1
        print(
            json.dumps(
                {
                    "event": "smoke_step",
                    "sequence": step.get("sequence"),
                    "action": step.get("actionType"),
                    "result": step.get("result"),
                    "url": step.get("url"),
                    "screenshot": bool(step.get("screenshotJpegBase64")),
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
        return True

    async def complete(
        self, reference: dict[str, Any], outcome: dict[str, Any]
    ) -> bool:
        self.outcome = outcome
        return True


def smoke_config() -> worker.RunnerConfig:
    proxy = os.environ.get("ZENGUY_EGRESS_PROXY", "").strip()
    if not proxy:
        raise worker.ConfigError(
            "ZENGUY_EGRESS_PROXY is required for the real-library smoke test"
        )
    return worker.RunnerConfig(
        environment="smoke",
        cloudflare_account_id="unused",
        cloudflare_queue_id="unused",
        cloudflare_queues_token="unused",
        zenguy_api_url="https://unused.example",
        zenguy_runner_token="unused",
        model_base_url=worker.DEFAULT_MODEL_BASE_URL,
        model_name=worker.DEFAULT_MODEL_NAME,
        model_api_key="local-runner",
        model_vision=True,
        model_reasoning_effort=worker.DEFAULT_MODEL_REASONING_EFFORT,
        allow_remote_model=False,
        headless=False,
        browser_channel="chrome",
        poll_seconds=worker.DEFAULT_POLL_SECONDS,
        visibility_timeout_ms=worker.DEFAULT_VISIBILITY_TIMEOUT_MS,
        egress_proxy=worker.validate_proxy_url(proxy),
        worker_id="zenguy-smoke",
        access_client_id="unused-smoke-client-id",
        access_client_secret="unused-smoke-client-secret".ljust(32, "-"),
    )


async def run_smoke() -> int:
    config = smoke_config()
    await worker.ensure_bionic_ready(config)
    app = SmokeApp()
    job: dict[str, Any] = {
        "reference": {"attemptId": "browser-use-local-smoke"},
        "snapshot": {
            "startUrl": "https://example.com/",
            "instructions": (
                "Verify that the visible page heading is exactly 'Example Domain' "
                "and that the page contains a link labeled 'Learn more'."
            ),
            "viewport": {"width": 1280, "height": 800},
            "device": "DESKTOP",
        },
        "limits": {
            "maxAgentSteps": 8,
            "maxScreenshotsPerAttempt": 8,
            "screenshotJpegQuality": 60,
            "attemptTimeoutMs": 360_000,
        },
        "secrets": [],
    }
    await worker.JobExecutor(config, app).execute(job)
    outcome = app.outcome or {}
    print(
        json.dumps(
            {
                "event": "smoke_complete",
                "steps": app.steps,
                "status": outcome.get("status"),
                "summary": outcome.get("summary"),
                "model": outcome.get("modelName"),
                "runner": outcome.get("runnerVersion"),
                "tokenUsage": outcome.get("tokenUsage"),
                "visitedUrls": outcome.get("visitedUrls"),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        flush=True,
    )
    return 0 if outcome.get("status") == "PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_smoke()))
