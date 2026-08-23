# Remote security controls runbook

This runbook covers the remote work that cannot be enforced only by repository
code. Every inspection command below is read-only. Creating or deleting rules,
rotating credentials, purging data, changing deployment protections, and
deploying Workers require an explicit change window and operator approval.

## 1. Contain and rebuild staging

Perform these steps in order; do not reconnect a runner until the final smoke
passes.

1. Stop staging deployments and its runner consumers.
2. Create one Cloudflare Access self-hosted application covering
   `staging-app.zenguy.com/*` and `api-staging.zenguy.com/*`. Limit its Allow
   policy to test identities and require MFA.
3. Create a second, more-specific application only for
   `staging-app.zenguy.com/api/webhooks/paddle`. Its provider bypass must not
   cover any other method, host or path. The Worker still enforces exact POST,
   origin, path, no query string, body cap, and Paddle HMAC.
4. Store the first application's AUD as the staging-only `CF_ACCESS_AUD`
   Worker secret. `required-worker-secrets.json` declares it required and the
   deployment preflight fails before migration when the binding is absent.
5. Recreate or purge the staging D1/KV/R2 data after an approved backup. Remove
   all deterministic fixture users, password hashes, sessions, API keys,
   grants, queued work and artifacts. The repository cannot prove that old
   remote copies are gone.
6. Rotate staging-only JWT, encryption, artifact URL, primary/fallback runner,
   runner capability, Access service-token and provider credentials. Never
   reuse production values. Follow the encrypted-data rotation procedure before
   retiring an old encryption key.
7. Run the secret-name preflight, migrations and deployment from the protected
   staging Environment. Then verify an anonymous request to both staging
   hostnames is denied at Access, an authenticated request reaches the Worker,
   and the exact Paddle callback still reaches HMAC verification.

The deterministic `seed.mjs` fixture is intentionally local-only. It rejects
every `--remote` invocation, there is no `seed:staging` package command, and CI
contains no seed or wipe step.

## 2. Separate GitHub deployment authority

Create `staging`, `production`, and `security-audit` GitHub Environments before
enabling their workflows.

- Store `CLOUDFLARE_STAGING_API_TOKEN` only in `staging` and restrict it to
  staging Worker/D1 resources.
- Store `CLOUDFLARE_PRODUCTION_API_TOKEN` only in `production` and restrict it
  to production resources. Never add either token, or a generic
  `CLOUDFLARE_API_TOKEN`, as a repository-level secret.
- Restrict each Environment to its exact deployment branch. Require an
  approval gate for production.
- Restrict `security-audit` to `main`. Store only a dedicated
  `CLOUDFLARE_SECURITY_AUDIT_TOKEN` there and add the non-secret
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ZONE_ID` as Environment variables.
  Its job is fenced to weekly schedules or explicit manual dispatch; pull
  requests and reusable-workflow calls cannot enter it.
- Create active branch rulesets for `main` and `staging`: deny deletion and
  force-push, require pull requests, CODEOWNERS review, stale-review dismissal,
  and the security status checks. Do not configure bypass actors.
- Keep workflow permissions at `contents: read`. External Actions must remain
  pinned to a full 40-character commit SHA.
- Rotate and revoke the former shared Cloudflare token only after both scoped
  tokens have been tested. Audit Logs should show no subsequent use of the old
  credential.

The workflows and repository guard enforce the local half of these controls,
but only GitHub's Environment/ruleset configuration can enforce the remote
half.

## 3. Protect and provision the production admin Worker

Complete these controls before the first `zenguy-admin` deploy. Do not record a
real admin user ID in this runbook, Wrangler config, GitHub variables, workflow
logs or evidence artifacts.

1. Cover exactly `admin.zenguy.com/*` with a self-hosted Cloudflare Access
   application. Its Allow policy must name only approved operator identities
   and require MFA. An absent or bypassed Access policy is a deployment blocker.
2. Resolve the intended operator through an approved, read-only production
   identity lookup. Require a verified account and copy only its immutable user
   ID in canonical lowercase `usr_<ULID>` form. Fixture IDs beginning with
   `usr_seed_`, emails and workspace roles are never authorization inputs.
3. Store the comma-separated allowlist as the production Worker's encrypted
   `ADMIN_USER_IDS` secret binding. Enter it interactively or pipe it directly
   from the approved secret manager; never place the value on a command line or
   in a file. `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` remain reviewed,
   non-secret Wrangler vars.
4. Run the protected production workflow. Immediately before the admin deploy,
   its preflight invokes `wrangler secret list --format json` for
   `zenguy-admin` and checks only that the binding name exists. It never reads or
   prints the allowlist value. The deploy command repeats that fail-closed
   preflight before invoking Wrangler.
5. Verify anonymously and without MFA that Access denies the route. Then verify
   that an MFA-authenticated, verified and allowlisted user succeeds, while a
   different real user ID and every fixture-shaped ID fail with the generic
   authentication response. Confirm logout and password reset revoke sessions.

For closure, retain the reviewed commit, workflow run, Access application and
policy revisions, the secret-binding name/type metadata, Worker version, and
redacted smoke results. Roll back by setting Access to deny-all or removing the
admin route; never restore a fixture allowlist or the legacy admin Worker.

## 4. Remove Cloudflare IP Access bypasses and enable edge controls

Cloudflare documents that an IP Access `Allow` runs before and bypasses custom
rules, rate limiting and Managed Rules, and that these allowed requests do not
appear in Security Events. Prefer a narrowly scoped custom-rule `skip` only
when a reviewed exception is unavoidable.

1. Inventory account- and zone-level IP Access rules and record an owner and
   expiry for every current exception.
2. Confirm that the zone plan supports at least two new rate limiting rules
   (the Free plan exposes only one). Upgrade the plan or obtain equivalent
   contracted capacity before deployment; never silently omit either rule.
3. Deploy the exact versioned custom, auth and resource-exhaustion rate-limit
   rules from `cloudflare-edge-policy.json`, plus the Cloudflare Free Managed
   Ruleset or Cloudflare Managed Ruleset available to the zone. Validate them
   first with traffic that is not covered by an IP Access `Allow`.
4. Remove the account-wide `Allow` entries in reviewed batches. If an
   exception is still necessary, replace it with the narrowest hostname/path
   custom-rule skip and add its stable rule ID to
   `cloudflare-edge-policy.json` in a reviewed pull request.
5. Confirm the custom rule blocks the two versioned sensitive-file probes and
   truncated API headers, the auth rule challenges the five versioned paths,
   and the resource rule blocks abusive runner, Paddle and expensive workspace
   traffic at its separate threshold. Exercise the latter from both a normal
   client and each authorized machine identity before enabling it. Confirm the
   managed ruleset produces Security Events.
6. Create a dedicated read-only API token with only Account Firewall Access
   Rules Read plus the minimum Zone/Rulesets read permissions. Do not reuse a
   deploy token.
7. Store that token and the two IDs in the protected `security-audit`
   Environment, manually dispatch the workflow from `main`, and then allow its
   weekly schedule. For an approved local read-only check, load the same three
   bindings from the secret manager and run:

       pnpm security:audit:cloudflare

The auditor performs GET requests only, binds the zone ID to `zenguy.com` and
the expected account, paginates both IP Access scopes, and emits counts only.
It requires the exact custom `ref`/description/action/expression, both exact
rate rules and characteristics/thresholds, and an override-free `execute`
targeting a real Cloudflare-managed ruleset whose metadata is resolved
separately. It never prints IPs, rule expressions, tokens, rule IDs, or API
response bodies.

References:

- [Cloudflare IP Access rules](https://developers.cloudflare.com/waf/tools/ip-access-rules/)
- [Cloudflare WAF phase interactions](https://developers.cloudflare.com/waf/troubleshooting/phase-interactions/)
- [Cloudflare Rulesets API endpoints](https://developers.cloudflare.com/ruleset-engine/rulesets-api/endpoints/)
- [GitHub deployment environments](https://docs.github.com/en/rest/deployments/environments)
- [GitHub repository rulesets](https://docs.github.com/en/rest/repos/rules)

## 5. Provision and rotate non-exportable v4 wrapping keys

The repository side is prepared, but SEC-23 is not remotely closed until both
named KMS Workers and their `secret_key` bindings exist. Cloudflare Secrets and
Secrets Store are not substitutes: Worker code can read their plaintext.

Perform one environment at a time, staging first:

1. From its protected GitHub Environment, deploy the explicit
   `deploy:kms:bootstrap:<environment>` target. Verify the resulting
   `zenguy-kms-<environment>` Worker has no route, workers.dev subdomain,
   preview URL, trigger or default fetch entrypoint.
2. Generate an independent 32-byte AES key in the approved secret manager. With
   a temporary, environment-scoped Workers Scripts Write token, use the official
   Worker secret API to create the exact reviewed `KMS_KEY_*` binding as
   `secret_key`, raw AES-GCM, usages `encrypt` and `decrypt`. Stream the value;
   never store it in argv, environment variables, a file, Git or evidence.
3. Run `deploy:preflight:<environment>`. Retain only its metadata evidence:
   Worker/binding name, `secret_key`, raw, AES-GCM, usages, reviewed key ID and
   timestamp. Never retain `key_base64`, a JWK or a response body containing a
   value. A missing/wrong binding blocks KMS deploy, D1 migration and API deploy.
4. Deploy KMS, then API, then execute a v4 create/decrypt smoke in a disposable
   workspace. Record both Worker version IDs and confirm D1 stores only `w1:*`
   wrapped DEKs. Confirm the API cannot start in a named environment without its
   `KEY_WRAPPING` capability.

For rotation, provision new while retaining old; deploy KMS with new active and
temporary `writeKeyIds: [old, new]`; deploy API with new; deploy KMS again with
only new writable but both readable. Re-wrap workspaces in bounded batches and
use a read-only `GROUP BY wrapping_key_id` D1 query as evidence. Keep old for
approved backup retention. Deleting the old binding is a separate destructive
change only after its live/backup reference count is zero.

Rollback while both exist by restoring the API to old first (both IDs must
still be writable), then making old the KMS active/sole writer. Do not restore
`ENCRYPTION_KEY` as the v4 provider. No D1 schema migration is part of this
change: migrations 0039 and 0040 already carry key ID, wrap version and wrapped
material.

## 6. Protect the production runner with Access machine identities

`security/cloudflare-runner-access-policy.json` is the fail-closed repository
contract for production. The production deploy preflight validates that local
contract before it inspects Worker secret metadata, but it cannot prove that a
Cloudflare Access application or policy exists remotely. Do not treat a green
preflight as remote evidence.

Complete these controls before reconnecting either production runner:

1. Create the `zenguy-production-runner` self-hosted Access application. It must
   cover `/api/runner/*` on both `app.zenguy.com` and `api.zenguy.com`; protecting
   only one hostname leaves an alternate Worker route. Keep Workers.dev and
   preview URLs disabled as required by `apps/api/wrangler.jsonc`. Store its
   exact audience tag as the required Worker binding `CF_RUNNER_ACCESS_AUD`;
   the issuer remains the reviewed `CF_ACCESS_TEAM_DOMAIN` var.
2. Create independent service tokens named
   `zenguy-production-primary-runner` and
   `zenguy-production-fallback-runner`. The application policy must be Service
   Auth, deny by default, include only those two machine identities, and contain
   no human identity, `Everyone`, Bypass or reusable shared-token rule.
3. Store each Client ID/secret pair only in its matching runner's approved
   secret manager or systemd `LoadCredential` source. Pair primary with
   `RUNNER_API_TOKEN` and worker ID `zenguy-production-primary`; pair fallback
   with `RUNNER_FALLBACK_API_TOKEN` and worker ID
   `zenguy-production-fallback`. Never copy either pair to the other runner.
4. Run the protected production preflight and deploy workflow. Separately
   retain redacted Access evidence: application name/ID, both exact public
   hostnames and path, Service Auth policy revision, the two service-token names
   and expirations, and confirmation that no bypass/include rule exists. Do not
   retain Client Secrets or request headers.
5. On both hostnames, prove that anonymous requests, human Access identities,
   one-header service-token requests and invalid pairs stop at Access. Then prove
   that each valid machine identity reaches route-level authentication but gets
   `401` without its Zenguy bootstrap token, and that the correctly paired
   primary/fallback runner can heartbeat and claim only through its designated
   bootstrap endpoint. Confirm Access logs attribute them to different service
   token Client IDs.
6. Revoke every former Access service token and runner bearer after the new
   pairs pass. Re-run the denial smokes with the revoked values and retain only
   timestamps/statuses. Roll back by setting the application to deny-all and
   stopping runners, never by adding a Bypass policy.

The two Access identities are independent factors and audit principals. The
origin verifies the RS256 Access assertion and binds its exact `common_name` to
the fixed primary/fallback worker ID before route parsing; distinct bootstrap
bearers and per-job capabilities remain additional factors. A green local
preflight still does not prove that the remote application, audience or policy
matches this contract, so retain the redacted evidence and denial smokes above.
