#!/bin/sh
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Runtime accepts only the two repositories produced by runner-images.yml and
# only by immutable digest. Tags are deliberately rejected even when a digest
# is also present elsewhere in the string.
RUNNER_PATTERN='^ghcr\.io/maguayo/zenguy-runner@sha256:[0-9a-f]{64}$'
PROXY_PATTERN='^ghcr\.io/maguayo/zenguy-egress-proxy@sha256:[0-9a-f]{64}$'
OIDC_ISSUER='https://token.actions.githubusercontent.com'

require_reference() {
  name="$1"
  value="$2"
  pattern="$3"
  if ! printf '%s\n' "$value" | grep -Eq "$pattern"; then
    printf '%s\n' "$name must be the approved GHCR repository pinned as image@sha256" >&2
    exit 1
  fi
}

require_trusted_directory() {
  path="$1"
  [ -d "$path" ] || {
    printf '%s\n' "trusted executable directory is missing: $path" >&2
    exit 1
  }
  [ ! -L "$path" ] || {
    printf '%s\n' "trusted executable directory must not be a symlink: $path" >&2
    exit 1
  }
  [ "$(stat -c '%u' "$path")" = "0" ] || {
    printf '%s\n' "trusted executable directory must be owned by root: $path" >&2
    exit 1
  }
  [ -z "$(find "$path" -maxdepth 0 -perm /022 -print -quit)" ] || {
    printf '%s\n' "trusted executable directory must not be group/world writable: $path" >&2
    exit 1
  }
}

version_at_least() {
  installed=${1#v}
  required=$2
  installed=${installed%%[-+]*}
  first=$(printf '%s\n%s\n' "$required" "$installed" | sort -V | head -n 1)
  [ "$first" = "$required" ]
}

runner_image="${ZENGUY_RUNNER_IMAGE:-}"
proxy_image="${ZENGUY_EGRESS_PROXY_IMAGE:-}"
release_tag="${ZENGUY_RUNNER_RELEASE_TAG:-}"
release_sha="${ZENGUY_RUNNER_RELEASE_SHA:-}"
require_reference ZENGUY_RUNNER_IMAGE "$runner_image" "$RUNNER_PATTERN"
require_reference ZENGUY_EGRESS_PROXY_IMAGE "$proxy_image" "$PROXY_PATTERN"
if ! printf '%s\n' "$release_tag" | grep -Eq '^runner-v[0-9A-Za-z][0-9A-Za-z._-]{0,63}$'; then
  printf '%s\n' 'ZENGUY_RUNNER_RELEASE_TAG must identify one approved runner-v release' >&2
  exit 1
fi
if ! printf '%s\n' "$release_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  printf '%s\n' 'ZENGUY_RUNNER_RELEASE_SHA must be the approved 40-character Git commit SHA' >&2
  exit 1
fi
certificate_identity="https://github.com/maguayo/zenguy/.github/workflows/runner-images.yml@refs/tags/$release_tag"

case "${ZENGUY_WORKER_ID:-}" in
  zenguy-production-fallback)
    if [ "${ZENGUY_RUNNER_ENVIRONMENT:-}" != "production" ]; then
      printf '%s\n' 'production worker identity requires ZENGUY_RUNNER_ENVIRONMENT=production' >&2
      exit 1
    fi
    if [ "${ZENGUY_API_URL:-https://app.zenguy.com}" != "https://app.zenguy.com" ]; then
      printf '%s\n' 'production worker identity must use https://app.zenguy.com' >&2
      exit 1
    fi
    ;;
  zenguy-staging-fallback)
    if [ "${ZENGUY_RUNNER_ENVIRONMENT:-}" != "staging" ]; then
      printf '%s\n' 'staging worker identity requires ZENGUY_RUNNER_ENVIRONMENT=staging' >&2
      exit 1
    fi
    if [ "${ZENGUY_API_URL:-}" != "https://staging-app.zenguy.com" ]; then
      printf '%s\n' 'staging worker identity requires ZENGUY_API_URL=https://staging-app.zenguy.com' >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' 'ZENGUY_WORKER_ID must identify the production or staging fallback' >&2
    exit 1
    ;;
esac

# A manual invocation may have sourced the combined secret file. The verifier
# and cosign need none of these values, so do not pass them to child processes.
unset ZENGUY_RUNNER_TOKEN OPENAI_API_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET CLOUDFLARE_QUEUES_TOKEN

cosign_bin=$(command -v cosign || true)
case "$cosign_bin" in
  /usr/bin/cosign|/usr/local/bin/cosign) ;;
  *)
    printf '%s\n' 'cosign must be installed at /usr/bin/cosign or /usr/local/bin/cosign' >&2
    exit 1
    ;;
esac
[ ! -L "$cosign_bin" ] || {
  printf '%s\n' 'cosign must not be a symlink' >&2
  exit 1
}
[ "$(stat -c '%u' "$cosign_bin")" = "0" ] || {
  printf '%s\n' 'cosign must be owned by root' >&2
  exit 1
}
[ -z "$(find "$cosign_bin" -prune -perm /022 -print -quit)" ] || {
  printf '%s\n' 'cosign must not be group/world writable' >&2
  exit 1
}
cosign_canonical=$(readlink -f -- "$cosign_bin") || {
  printf '%s\n' 'cosign could not be resolved' >&2
  exit 1
}
[ "$cosign_canonical" = "$cosign_bin" ] || {
  printf '%s\n' 'cosign must use its canonical path' >&2
  exit 1
}
require_trusted_directory /usr
if [ "$cosign_bin" = "/usr/local/bin/cosign" ]; then
  require_trusted_directory /usr/local
  require_trusted_directory /usr/local/bin
else
  require_trusted_directory /usr/bin
fi
cosign_version=$("$cosign_bin" version | sed -n 's/^[[:space:]]*GitVersion:[[:space:]]*v\([0-9][0-9.]*\).*$/\1/p' | head -n 1)
[ -n "$cosign_version" ] || {
  printf '%s\n' 'cosign version output is not recognized' >&2
  exit 1
}
version_at_least "$cosign_version" "3.0.6" || {
  printf '%s\n' 'cosign 3.0.6+ is required; older verification is vulnerable (GHSA-whqx-f9j3-ch6m/GHSA-w6c6-c85g-mmv6)' >&2
  exit 1
}

for image in "$runner_image" "$proxy_image"; do
  "$cosign_bin" verify \
    --certificate-identity "$certificate_identity" \
    --certificate-oidc-issuer "$OIDC_ISSUER" \
    --certificate-github-workflow-repository maguayo/zenguy \
    --certificate-github-workflow-ref "refs/tags/$release_tag" \
    --certificate-github-workflow-sha "$release_sha" \
    --certificate-github-workflow-trigger push \
    "$image" >/dev/null
done
