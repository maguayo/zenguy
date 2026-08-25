# Isolated browser-test worker

`browser_worker.py` is the only browser-test executor. Remote environments run it in
the isolated Compose fallback stack: it claims stale work from the API,
launches a fresh `browser-use`/Chromium session, posts evidence and exits after
one attempt so Docker clears its process tree and tmpfs. The legacy Queue-pull/local
model implementation is retained only for protocol compatibility and cannot be
started from the CLI; no staging or production job may execute directly on a host.

The queue message contains run identifiers, not test secrets. After claiming a
message, the worker retrieves the immutable run snapshot and only the secrets
referenced by that snapshot over the authenticated Zenguy runner API. Secret
values are substituted in the browser runtime, never included in the model
prompt, and disable screenshots for the whole attempt.

## Local development and smoke tests

- Bionic installed on this Mac with `qwen/qwen3.8-27b` downloaded.
- A dedicated Cloudflare API token restricted to Queue read/write operations in
  the selected account. Cloudflare API tokens cannot currently be scoped to one
  queue, so use a separate token per environment and treat it as account-wide
  Queue access. A personal Wrangler OAuth session is never read at runtime.
- A distinct Cloudflare Access service token for each runner *and* environment;
  it protects `/api/runner/*` independently of the job/bootstrap capability.
- Python 3.11 at `/opt/homebrew/bin/python3.11` and local Google Chrome.
- `browser-use[core]==0.13.8` and `httpx==0.28.1` (installed automatically in
  the private venv).
- Cloudflare Queue HTTP pull enabled on the matching run queue.

No manual virtualenv activation is required. Direct host execution is disabled
for both staging and production; there is intentionally no override flag. Use
`smoke_browser_use.py` for the non-destructive local library smoke and use the
isolated Compose stack for every remote job.

The launcher creates `runner/.venv` on the first invocation and then reuses it.
The worker uses Bionic's local API at `http://127.0.0.1:1234/v1`, starts that
server through `/Users/maguayo/.lmstudio/bin/lms` if needed, selects
`qwen/qwen3.8-27b` with `xhigh` reasoning and vision, and opens an isolated
visible Google Chrome profile through `browser_use.BrowserProfile`. Queue IDs,
API origins and the Cloudflare account are fixed in the script. Cloudflare
authentication comes from `CLOUDFLARE_QUEUES_TOKEN` or the environment-specific
`production_queues_token` / `staging_queues_token` entry in the ignored
`runner/.browser_worker.local.json`, owned by the current user with mode 0600.
Never put a personal Wrangler OAuth token in that file.
The matching primary Access pair comes from `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET`, or `production_primary_access_client_id` /
`production_primary_access_client_secret` (and the equivalent `staging_*`
keys) in the same private file. Fallback JSON keys use `*_fallback_access_*`.
Never reuse an Access service token between primary/fallback or
staging/production. The runner sends it only to the fixed Zenguy API origin.

The model endpoint is fixed to loopback, preventing an accidental upload of
page state or screenshots. Remote Zenguy API origins require HTTPS.
`ZENGUY_EGRESS_PROXY` (or `egress_proxy` in the private JSON) is mandatory:
direct browser/API/Queue/model egress is refused. Credentialed HTTP clients
do not follow redirects, ignore ambient proxy variables and use only that
explicit proxy. After configuration is loaded, bootstrap, Access, Queue and
model credentials are deleted from `os.environ` before browser-use can spawn
Chromium; the browser process therefore cannot inherit global runner secrets.
CDP pauses and validates every
HTTP(S) navigation, redirect and subresource before continuing it. All browser
traffic is limited to the job's starting hostname, its explicitly configured
`allowedDomains`, and secret-scoped domains. Legacy jobs and tests without an
explicit policy remain GET/HEAD/OPTIONS-only and can follow direct links.
`writableDomains` is a separate, exact-host (no wildcard) subset of the start
host plus `allowedDomains`; it permits only wrapped input, select, checkbox,
and radio interactions on those reviewed staging/test hosts. Secret-only and
navigation-only domains never gain write permission implicitly. The retired
`allowReversibleWrites` global flag is rejected when true and cannot grant a
capability.

Irreversible actions use a separate fail-closed authorization path. A saved
test may declare exact scopes only after explicitly attesting that its
credentials and records are staging/test-only. Each DOM scope binds CLICK to
one canonical HTTPS origin, exact path/query, stable `id`, `data-testid`,
`name`, or `aria-label` target, and 1-3 uses. DOM authority version 2 accepts
only a unique live `BUTTON`/`INPUT type=submit` whose signed form POST
origin/path is backed by an equal-or-larger exact HTTP scope. Legacy DOM scopes
without that association are inert. Each HTTP scope independently binds
POST/PUT/PATCH/DELETE to one canonical HTTPS origin, exact path/query, and 1-3
uses. A human must confirm those scopes for every manual or validation run.
Scheduled runs never receive irreversible authority.

The API hashes the original instructions and HMAC-signs the complete immutable
run snapshot, approval actor/time, attestation and scopes. Claim verifies that
binding before exposing scopes. Before each wrapped button click and each CDP-
intercepted mutating request, the runner asks the job-capability-protected API
to atomically decrement the matching run ledger. DOM and HTTP uses are
independent, persist across retries/failover, and cannot be replayed after a
lost response. The runner resolves the exact backend node in an isolated CDP
world and rechecks locator uniqueness plus form association both before and
after spending the DOM use. A malformed, duplicated, reordered, or inflated ledger fails
closed. An ambiguous DOM locator or changed form association also fails closed.
Page text, DOM labels, prompt injection, redirects, scheme downgrades,
alternate ports and query changes cannot add or widen a capability.

The remaining functional gaps are intentional and explicit: coordinate
clicks, Enter/Space activation, `send_keys`, contenteditable controls, file
uploads and unknown future tools remain unavailable; dynamic paths/queries
must be enumerated exactly; only the four reviewed HTTP mutation methods and
stable-attribute DOM clicks can be scoped. Losing the authorization response
spends that use without performing the effect, so the run fails safely rather
than risking a duplicate purchase/delete. Unsupported flows must return
FAILED with the policy error instead of bypassing it.

Cache is disabled, service workers are bypassed, and WebSocket/file/FTP URLs
are blocked completely. The
isolated deployment below adds the actual network boundary for WebSockets,
workers, DNS rebinding and a compromised renderer.
Chromium's implicit localhost proxy exception is explicitly subtracted, so
even loopback requests must cross that network boundary. Unknown future CDP
target types are destroyed instead of silently running without interception.
The runner also removes browser-use 0.13.8's implicit Docker
`--no-sandbox`/site-isolation bypasses, explicitly enables Chromium's process
sandbox and `--site-per-process`, and inspects the final argv before every
launch. A dependency change that restores a forbidden switch fails closed.

Run the worker's offline protocol and safety tests with:

```bash
cd runner && .venv/bin/python -m unittest -v test_browser_worker.py
```

Run the non-destructive real-library smoke (Bionic + visible Chrome +
`browser_use.Agent`, without Queue or remote API writes) only through a running
safe egress proxy with:

```bash
ZENGUY_EGRESS_PROXY=http://127.0.0.1:3128 \
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
it is still attached, then add the HTTP consumer. Run these one-time commands
from an audited admin workstation with `CLOUDFLARE_API_TOKEN` set to a
short-lived token limited to Queue configuration for the target environment.
Do not use or mint a personal Wrangler OAuth session for runner operations.

Staging:

```bash
pnpm --filter @zenguy/api exec wrangler queues consumer list zenguy-staging-runs
pnpm --filter @zenguy/api exec wrangler queues consumer worker remove zenguy-staging-runs zenguy-api-staging
pnpm --filter @zenguy/api exec wrangler queues consumer http add zenguy-staging-runs --batch-size 1 --message-retries 3 --dead-letter-queue zenguy-staging-runs-dlq --visibility-timeout-secs 900 --retry-delay-secs 30
```

Production uses the corresponding `zenguy-runs`, `zenguy-runs-dlq`, and
`zenguy-api-production` names. Do not activate production merely to test this
flow; its existing release gates still apply.

Cloudflare requires a queue ID rather than a queue name in the pull REST URL;
the production and staging IDs for this account are already fixed in the local
worker.

## Runner API credentials and job capabilities

Each environment has three independent values in the API Worker:

- `RUNNER_API_TOKEN`: primary Queue worker bootstrap/heartbeat only;
- `RUNNER_FALLBACK_API_TOKEN`: fallback claim/heartbeat only;
- `RUNNER_CAPABILITY_SECRET`: HMAC signing key that never leaves the API.

The primary private JSON uses its `*_runner_token`; the fallback service uses
the environment's fallback token as `ZENGUY_RUNNER_TOKEN`. A successful claim
returns a six-minute capability bound to worker, run, attempt, execution
generation and delivery. Start/step/complete reject both bootstrap tokens and
accept only that capability. Secret values are no longer returned by claim;
they are released by the capability-protected start response.

Never reuse the Cloudflare Queues token as the Zenguy runner token. The former
leases queue messages; the latter can read an accepted job and write its
execution results.

## Worker identity and heartbeat

Each worker sends `POST /api/runner/heartbeat` every 5 s with its `workerId`
(env `ZENGUY_WORKER_ID`, `worker_id` in `.browser_worker.local.json`, or the
sanitised hostname); claims carry the same id so admin.zenguy.com can
attribute runs. Outside development, the API binds each bootstrap credential
to one exact identity: `zenguy-<environment>-primary` or
`zenguy-<environment>-fallback`. The reference production Compose stack sets
the latter explicitly; a staging override must use `zenguy-staging-fallback`.

Deploy the API **before** pointing a runner that sends `workerId` at it. The
claim schemas are strict, so an API that predates the field answers `400` to
every claim (which the runner treats as a poison message). For staging that
means pushing `main` to `staging` and letting the deploy finish before
restarting the isolated `zenguy-fallback-staging` unit.

## Fallback runner (plan B)

`--fallback` turns the same executor into the backup runner meant for an
always-on VPS. It exists so runs still execute when this computer is slow,
offline, or without power:

- It never touches Cloudflare Queues and needs no Wrangler profile. Instead it
  polls `POST /api/runner/attempts/claim-stale`, which only returns attempts
  that have been claimable for at least 10 seconds (server-side
  `FALLBACK_CLAIM_MIN_AGE_MS`) and are still unclaimed. While the local worker
  is healthy the fallback therefore stays idle.
- Inference uses the OpenAI API (default model `gpt-5.6-luna`) through the stock
  browser-use `ChatOpenAI` adapter with native structured output. Reasoning
  escalates by functional attempt: `low` on attempt 1, `medium` on attempt 2,
  and `high` on attempts 3 and 4. The Bionic text adapter is not involved.
- Chrome runs headless by default. Steps, screenshots, secret scoping,
  redaction and SSRF rules are identical to the local mode.
- The same stale-claim poll also surfaces attempts whose worker died mid-run,
  triggering the API's normal `WORKER_LOST` recovery, so the system heals
  itself even while the local worker is completely down.

There is no host debugging exception: the job entrypoint requires the Compose
marker, the exact environment/API/worker identity, the `egress-proxy` sidecar
and `--recycle-after-attempt` before it reads credentials. Use mocked unit tests
for protocol debugging and the signed Compose stack for real end-to-end jobs.
Optional container overrides:
`ZENGUY_FALLBACK_MODEL`,
`ZENGUY_FALLBACK_REASONING_EFFORT` (pins every attempt to one level),
`ZENGUY_FALLBACK_MODEL_BASE_URL` (HTTPS
required), `ZENGUY_FALLBACK_HEADLESS=false`, `ZENGUY_FALLBACK_CHROME`
(browser executable path), `ZENGUY_FALLBACK_POLL_SECONDS`, `ZENGUY_API_URL`.

VPS install (Debian/Ubuntu):

```bash
# Install Docker Engine/Compose and cosign from their official repositories.
mkdir -p /opt/zenguy && cd /opt/zenguy
# Copy the runner/ directory here, install deploy/zenguy-fallback.service,
# and create the two environment files described below.
```

Keep secrets only in `/etc/zenguy/fallback.env` (`root:root`, mode `0600`).
systemd copies it into a private `LoadCredential` ramfs readable by the service
user; Compose reads that copy, so the long-lived service environment and the
unprivileged host account never receive the source file or its values.
`/etc/zenguy/fallback.runtime.env` is the non-secret control file: it pins
`ZENGUY_RUNNER_IMAGE` and `ZENGUY_EGRESS_PROXY_IMAGE` to the two
`image@sha256` values emitted by one release workflow, pins their common
`ZENGUY_RUNNER_RELEASE_TAG` and the release artifact's common 40-character
`ZENGUY_RUNNER_RELEASE_SHA`, and sets the exact
`ZENGUY_RUNNER_ENVIRONMENT`, `ZENGUY_WORKER_ID` and `ZENGUY_API_URL` triplet.
Staging uses `staging`, `zenguy-staging-fallback` and
`https://staging-app.zenguy.com` in a separate unit/host with an independent
`LoadCredential` source. The verifier rejects any mismatch. Install `cosign`
as a root-owned, non-writable regular file at `/usr/bin/cosign` or
`/usr/local/bin/cosign`; use Cosign 3.0.6 or newer, because earlier releases are
affected by GHSA-whqx-f9j3-ch6m and/or GHSA-w6c6-c85g-mmv6. Its parent
directories must also be root-owned and non-writable by the service user. The
GHCR packages must be public, or that user must have a read-only registry
login; no write-capable registry credential belongs on the runner host.

Do not add the `zenguy` host account to the Docker group. The unit grants full
privilege only to its fixed Docker orchestration commands via systemd's `+`
prefix; every other preflight runs as the locked-down service user, while the
actual image explicitly runs as UID/GID `10001:10001`.

`requirements.lock` contiene el grafo transitivo completo y hashes de PyPI para
el único artefacto soportado en producción: CPython 3.12.14 sobre Linux amd64
con glibc 2.36 (Debian Bookworm). No es un lock universal: excluir explícitamente
dependencias y markers de macOS/Windows evita que `pip` evalúe versiones de
kernel no PEP 440 en Linux. Docker y CI aceptan únicamente wheels
hash-verificadas; un sdist no puede introducir un backend de build o
dependencias de compilación fuera del lock.
`browser-use==0.13.8` still declares exact metadata pins for `click==8.3.1`,
`mcp==1.26.0` and `pypdf==6.14.2`; the reviewed lock deliberately overrides
them with `8.4.2`, `1.29.0` and `6.16.1`. A plain `pip check` therefore reports
those three conflicts and must not be presented as green. The image/CI command
`browser_worker.py --verify-locked-runtime` verifies the exact installed
versions, accepts only those three known metadata messages and fails on any
additional or changed conflict.
Para actualizarlo de forma deliberada, revisa primero
`requirements-overrides.txt` y ejecuta:

```bash
uv pip compile runner/requirements.txt \
  --overrides runner/requirements-overrides.txt \
  --python-platform x86_64-manylinux_2_36 \
  --python-version 3.12.14 \
  --only-binary :all: --generate-hashes \
  --output-file runner/requirements.lock
```

Install `runner/deploy/zenguy-fallback.service` so systemd keeps the isolated
Compose stack alive.
See `BACKUP_RUNNER.md` at the repository root for the full design and the
activation checklist.

## Verifiable isolation deployment

`deploy/compose.yml` is the reference fallback deployment. The runner joins
only an `internal: true` Docker network whose IPv4 gateway mode is `isolated`,
so the bridge has no host address at `172.30.0.1` and the runner has no Internet
route. Its only peer is an unprivileged Squid container on a second egress
network. This requires Docker Engine 28.0.0+ and Docker Compose 2.33.1+; the
service preflight rejects older runtimes. Squid denies
loopback, private, link-local, carrier-grade NAT, benchmark, multicast and
reserved IPv4/IPv6 destinations after DNS resolution, including deprecated
IPv6 site-local space. Both containers are
read-only, drop every Linux capability, set memory/PID limits and use bounded
tmpfs storage. Browser downloads and automatic PDF downloads are denied again
inside Chrome/CDP. Declared responses over 32 MiB, attachments and PDFs are
rejected at response headers. CDP accounts `Network.dataReceived.dataLength`
(decoded bytes, with encoded bytes as a lower-bound fallback), terminates
Chromium when one response exceeds 32 MiB or the attempt exceeds 256 MiB, and
Squid applies the same 32 MiB cap to plaintext HTTP responses.
The memory cgroup is the final bound even for a dishonest chunked HTTPS
response.

Chromium uses the reviewed profile at
`deploy/seccomp/chromium-moby-v0.2.1.json`, derived from the Moby profile shipped
with Docker Engine 29.5.2. It retains Moby's `SCMP_ACT_ERRNO` default and socket
family filters, and additionally keeps the legacy `socketcall` compatibility
path denied. Its provenance and upstream digest are recorded beside the JSON.
Do not copy an old Playwright profile, grant `SYS_ADMIN`, use
`seccomp=unconfined`, or replace it through an environment variable; those
options discard current syscall fixes or let mutable host configuration choose
the policy. `verify-container-runtime.sh` pins the exact repository path and
SHA-256, checks root ownership, and systemd then launches the image's real
Chromium smoke in the exact Compose sandbox. Activation aborts if the reviewed
profile cannot start sandboxed Chromium or if site isolation is absent.

The proxy bridge can otherwise reach a service bound to the VPS's own public
address even though private ranges are denied. Before activation, inventory
every host interface address in a dedicated Squid ACL:

```bash
{
  printf '# Generated host interface denylist; do not add other directives.\n'
  ip -o -4 address show scope global | awk '{ split($4, value, "/"); print "acl forbidden_host dst " value[1] }'
  ip -o -6 address show scope global | awk '{ split($4, value, "/"); print "acl forbidden_host dst " value[1] }'
} > /etc/zenguy/host-egress-deny.conf
chown root:root /etc/zenguy/host-egress-deny.conf
chmod 0644 /etc/zenguy/host-egress-deny.conf
```

Set `ZENGUY_HOST_EGRESS_DENY_FILE=/etc/zenguy/host-egress-deny.conf` in the
runtime environment. The root preflight accepts only `forbidden_host dst`
entries and proves that every current global-scope IPv4/IPv6 interface address
is present before mounting the file read-only into Squid. Regenerate it after
any host address change; startup fails closed when the inventory is stale.

Install `/opt/zenguy`, `/opt/zenguy/runner`, its `deploy` directory and
`/etc/zenguy` root-owned and non-writable by the service account,
then validate the signed digests manually and let systemd validate host files,
the private credential copy, topology and live sandbox before activation:

```bash
set -a
. /etc/zenguy/fallback.runtime.env
set +a
/bin/sh runner/deploy/verify-runtime-images.sh
docker compose -f runner/deploy/compose.yml config --images
systemctl start zenguy-fallback
journalctl -u zenguy-fallback -n 100 --no-pager
```

Both base images are pinned by digest and APT resolves over authenticated TLS
against the immutable Debian snapshot declared in each Dockerfile; the minimal
Debian proxy stage bootstraps only the CA bundle from the already pinned Python
base, so disabling snapshot expiry cannot enable an on-path metadata rollback.
CI fixes its Linux distribution, verifies the Buildx release binary against a
reviewed SHA-256 before first execution, and enables Buildx's authenticated
default-source policy for a versioned, digest-pinned BuildKit builder created
without `network.host` or `security.insecure` entitlements. CI also downloads
the immutable Trivy release archive directly and verifies its reviewed SHA-256
before executing the scanner in the release job.
`.github/workflows/runner-images.yml`
builds and scans both contexts read-only on pull requests/manual validation,
and launches the resulting Chromium image with the reviewed seccomp profile,
no network, no capabilities and a read-only filesystem.
The profile keeps Moby's default-deny policy and adds only the `clone` and
`unshare` syscall exceptions required for Chromium to create its own namespace
sandbox; CI rejects any byte-level drift from that reviewed profile.
Only a `runner-v*` tag at the current `main` commit enters the protected
`runner-release` environment and receives package-write/OIDC permissions. That
path rechecks the current `main` after Environment approval, builds each release
once, publishes its SBOM and provenance to GHCR,
blocks HIGH/CRITICAL findings, repeats the real sandbox launch against the
published manifest, rechecks `main` again, and only then signs the exact digest through GitHub
OIDC and uploads the two deployable digest references. The host verifies both
Rekor-backed keyless signatures against the same explicitly approved release
tag, 40-character commit SHA and workflow identity before pulling. Recreating
a tag at another commit therefore cannot authorize a different image. The
systemd unit contains no
build path, so a reboot cannot silently compile different Chromium or Squid
packages; it fails closed until the reviewed signed images exist.
The two allowlist-based `.dockerignore` files keep local runner credentials,
virtualenvs and unrelated source files out of the BuildKit contexts.

The systemd unit launches this Compose topology; it never executes Python or
Chromium directly on the host. It uses `docker compose run --rm`: after each
claimed attempt—including a malformed or failed post-claim execution—the runner
process exits, Docker removes the complete container
and systemd creates a fresh one, clearing namespaces, process state and bounded
tmpfs before another tenant's job. The unit also assigns fixed names to the
attempt and sandbox-preflight containers and force-removes those exact names
before start and during stop; a severed Docker CLI therefore cannot leave an
old attempt running beside its replacement. The proxy is an uncredentialed sidecar and
may remain alive. Local macOS use is limited to the non-destructive library
smoke; it cannot claim a staging or production job.

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
