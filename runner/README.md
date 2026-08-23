# Local browser-test worker

`browser_worker.py` is the only browser-test executor in the deployed design.
The API creates a run and publishes its attempt to `RUN_QUEUE`; this Python
process pulls that Cloudflare Queue over HTTP, launches a `browser-use` Agent
with local Chrome and a local model, posts each step/screenshot to Zenguy,
posts the final outcome, and only then acknowledges the queue message.

The queue message contains run identifiers, not test secrets. After claiming a
message, the worker retrieves the immutable run snapshot and only the secrets
referenced by that snapshot over the authenticated Zenguy runner API. Secret
values are substituted in the browser runtime, never included in the model
prompt, and disable screenshots for the whole attempt.

## Requirements

- Bionic installed on this Mac with `qwen/qwen3.8-27b` downloaded.
- The repository's existing `zenguy-personal` Wrangler profile.
- Python 3.11 at `/opt/homebrew/bin/python3.11` and local Google Chrome.
- `browser-use[core]==0.13.8` (installed automatically in the private venv).
- Cloudflare Queue HTTP pull enabled on the matching run queue.

No environment variables or manual virtualenv activation are required. From the
repository root, production is the default and staging is the only switch:

```bash
./browser_worker.py
./browser_worker.py --staging
```

The launcher creates `runner/.venv` on the first invocation and then reuses it.
The worker uses Bionic's local API at `http://127.0.0.1:1234/v1`, starts that
server through `/Users/maguayo/.lmstudio/bin/lms` if needed, selects
`qwen/qwen3.8-27b` with `xhigh` reasoning and vision, and opens an isolated
visible Google Chrome profile through `browser_use.BrowserProfile`. Queue IDs, API origins and
the Cloudflare account are fixed in the script. Cloudflare authentication is
read at startup from the existing `zenguy-personal` Wrangler OAuth profile and
is never logged or copied. The two Zenguy callback tokens live only in ignored
`runner/.browser_worker.local.json`, owned by the current user with mode 0600.

The model endpoint is fixed to loopback, preventing an accidental upload of
page state or screenshots. Remote Zenguy API origins require HTTPS, and every
browser HTTP(S) request is DNS-checked and blocked when it targets a loopback,
private, link-local, reserved, or otherwise non-public address.

Run the worker's offline protocol and safety tests with:

```bash
cd runner && .venv/bin/python -m unittest -v test_browser_worker.py
```

Run the non-destructive real-library smoke (Bionic + visible Chrome +
`browser_use.Agent`, without Queue or remote API writes) with:

```bash
runner/.venv/bin/python runner/smoke_browser_use.py
```

The Bionic adapter is intentionally narrow: Bionic cannot compile the full
dynamic `json_schema` emitted by browser-use, so the adapter requests text and
validates the returned JSON against browser-use's exact Pydantic action model.
The Agent, Tools, BrowserProfile, hooks, history, screenshots and structured
`done` result all come from browser-use; there is no custom Playwright agent.

## One-time Cloudflare queue setup

An HTTP pull consumer cannot coexist with a Worker push consumer. The checked-in
`wrangler.jsonc` therefore keeps `RUN_QUEUE` as a producer binding but does not
register `zenguy-runs` or `zenguy-staging-runs` as Worker consumers. The DLQ
continues to use the API Worker for durable redrive; that path never launches a
browser.

After deploying the updated API, inspect and remove the old Worker consumer if
it is still attached, then add the HTTP consumer. All commands must use this
repository's `zenguy-personal` Wrangler profile.

Staging:

```bash
pnpm --filter @zenguy/api exec wrangler queues consumer list zenguy-staging-runs --profile zenguy-personal
pnpm --filter @zenguy/api exec wrangler queues consumer worker remove zenguy-staging-runs zenguy-api-staging --profile zenguy-personal
pnpm --filter @zenguy/api exec wrangler queues consumer http add zenguy-staging-runs --batch-size 1 --message-retries 3 --dead-letter-queue zenguy-staging-runs-dlq --visibility-timeout-secs 900 --retry-delay-secs 30 --profile zenguy-personal
```

Production uses the corresponding `zenguy-runs`, `zenguy-runs-dlq`, and
`zenguy-api-production` names. Do not activate production merely to test this
flow; its existing release gates still apply.

Cloudflare requires a queue ID rather than a queue name in the pull REST URL;
the production and staging IDs for this account are already fixed in the local
worker.

## Runner API secret

Each environment has an independent `RUNNER_API_TOKEN`. The matching values are
configured in the Worker and stored only in the private ignored local JSON file
described above.

Never reuse the Cloudflare Queues token as the Zenguy runner token. The former
leases queue messages; the latter can read an accepted job and write its
execution results.

## Worker identity and heartbeat

Each worker sends `POST /api/runner/heartbeat` every 5 s with its `workerId`
(env `ZENGUY_WORKER_ID`, `worker_id` in `.browser_worker.local.json`, or the
sanitised hostname); claims carry the same id so admin.zenguy.com can
attribute runs.

Deploy the API **before** pointing a runner that sends `workerId` at it. The
claim schemas are strict, so an API that predates the field answers `400` to
every claim (which the runner treats as a poison message). For staging that
means pushing `main` to `staging` and letting the deploy finish before
restarting `zenguy-fallback-staging` or running `./browser_worker.py --staging`.

## Fallback runner (plan B)

`--fallback` turns the same executor into the backup runner meant for an
always-on VPS. It exists so runs still execute when this computer is slow,
offline, or without power:

- It never touches Cloudflare Queues and needs no Wrangler profile. Instead it
  polls `POST /api/runner/attempts/claim-stale`, which only returns attempts
  that have been claimable for at least 10 seconds (server-side
  `FALLBACK_CLAIM_MIN_AGE_MS`) and are still unclaimed. While the local worker
  is healthy the fallback therefore stays idle.
- Inference uses the OpenAI API (default model `gpt-5-mini`) through the stock
  browser-use `ChatOpenAI` adapter with native structured output; the Bionic
  text adapter is not involved.
- Chrome runs headless by default. Steps, screenshots, secret scoping,
  redaction and SSRF rules are identical to the local mode.
- The same stale-claim poll also surfaces attempts whose worker died mid-run,
  triggering the API's normal `WORKER_LOST` recovery, so the system heals
  itself even while the local worker is completely down.

Run it with environment credentials (no local JSON needed):

```bash
ZENGUY_RUNNER_TOKEN=... OPENAI_API_KEY=... ./browser_worker.py --fallback --staging
ZENGUY_RUNNER_TOKEN=... OPENAI_API_KEY=... ./browser_worker.py --fallback
```

On this Mac the two values may instead live in
`runner/.browser_worker.local.json` as the existing `*_runner_token` keys plus
an `openai_api_key` entry. Optional overrides: `ZENGUY_FALLBACK_MODEL`,
`ZENGUY_FALLBACK_REASONING_EFFORT`, `ZENGUY_FALLBACK_MODEL_BASE_URL` (HTTPS
required), `ZENGUY_FALLBACK_HEADLESS=false`, `ZENGUY_FALLBACK_CHROME`
(browser executable path), `ZENGUY_FALLBACK_POLL_SECONDS`, `ZENGUY_API_URL`.

VPS install (Debian/Ubuntu):

```bash
apt-get install -y python3.11 python3.11-venv chromium
mkdir -p /opt/zenguy && cd /opt/zenguy
# copy the runner/ directory of this repository here, then:
python3.11 -m venv runner/.venv
runner/.venv/bin/pip install -r runner/requirements.txt
```

Set `ZENGUY_FALLBACK_CHROME=/usr/bin/chromium` and install
`runner/deploy/zenguy-fallback.service` so systemd keeps the process alive.
See `BACKUP_RUNNER.md` at the repository root for the full design and the
activation checklist.

## Delivery and failure behavior

- Pull uses one message at a time with a 15-minute visibility timeout. A normal
  attempt has a five-minute execution deadline.
- The API persists the current Queue lease on the attempt. Repeating the same
  claim is idempotent, while a competing delivery cannot execute the same
  browser attempt. `executionGeneration` also rejects messages from an older
  infrastructure retry. Completion is durable before the message is
  acknowledged.
- Transport failures call Queue `retry`; functional failures and local
  browser/model failures are posted to Zenguy, where the existing functional
  and infrastructure retry policy creates the next attempt message.
- If the local process dies, the unacknowledged message becomes visible again.
  The API's stale-attempt recovery turns the abandoned execution into
  `WORKER_LOST` and continues the durable retry/finalization flow.
