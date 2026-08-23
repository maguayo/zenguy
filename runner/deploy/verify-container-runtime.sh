#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "container runtime verification failed: $*" >&2
  exit 1
}

require_root_file() {
  path=$1
  description=$2
  [ -f "$path" ] || fail "$description is missing"
  [ ! -L "$path" ] || fail "$description must not be a symlink"
  canonical=$(readlink -f -- "$path") || fail "$description could not be resolved"
  [ "$canonical" = "$path" ] || fail "$description must use its canonical path"
  [ "$(stat -c '%u' "$path")" = "0" ] || fail "$description must be owned by root"
  [ -z "$(find "$path" -prune -perm /022 -print -quit)" ] ||
    fail "$description must not be group/world writable"
}

require_root_directory() {
  path=$1
  description=$2
  [ -d "$path" ] || fail "$description is missing"
  [ ! -L "$path" ] || fail "$description must not be a symlink"
  canonical=$(readlink -f -- "$path") || fail "$description could not be resolved"
  [ "$canonical" = "$path" ] || fail "$description must use its canonical path"
  [ "$(stat -c '%u' "$path")" = "0" ] || fail "$description must be owned by root"
  [ -z "$(find "$path" -maxdepth 0 -perm /022 -print -quit)" ] ||
    fail "$description must not be group/world writable"
}

version_at_least() {
  installed=${1#v}
  required=$2
  installed=${installed%%[-+]*}
  first=$(printf '%s\n%s\n' "$required" "$installed" | sort -V | head -n 1)
  [ "$first" = "$required" ]
}

docker_server_version=$(/usr/bin/docker version --format '{{.Server.Version}}')
version_at_least "$docker_server_version" "28.0.0" ||
  fail "Docker Engine 28.0.0+ is required for isolated bridge gateway mode"

compose_version=$(/usr/bin/docker compose version --short)
version_at_least "$compose_version" "2.33.1" ||
  fail "Docker Compose 2.33.1+ is required"

profile=/opt/zenguy/runner/deploy/seccomp/chromium-moby-v0.2.1.json
expected_sha=c5ce0008dc103f3edf0d9f406c6fccb4f17f5cb7be25c05a9e691b927f69ca6e
require_root_file "$profile" "Chromium seccomp profile"
grep -Eq '"defaultAction"[[:space:]]*:[[:space:]]*"SCMP_ACT_ERRNO"' "$profile" ||
  fail "Chromium seccomp profile must retain Moby's default-deny action"
if grep -Eq '"socketcall"' "$profile"; then
  fail "Chromium seccomp profile must keep the socketcall compatibility path denied"
fi
actual_sha=$(sha256sum "$profile")
actual_sha=${actual_sha%% *}
[ "$actual_sha" = "$expected_sha" ] ||
  fail "Chromium seccomp profile digest does not match the repository-pinned value"

runtime_source=${ZENGUY_RUNTIME_ENV_SOURCE:-}
secret_source=${ZENGUY_SECRET_ENV_SOURCE:-}
[ "$runtime_source" = "/etc/zenguy/fallback.runtime.env" ] ||
  fail "runner runtime environment source must be /etc/zenguy/fallback.runtime.env"
[ "$secret_source" = "/etc/zenguy/fallback.env" ] ||
  fail "runner secret source must be /etc/zenguy/fallback.env"
require_root_directory "/etc/zenguy" "runner configuration directory"
require_root_file "$runtime_source" "runner runtime environment file"
require_root_file "$secret_source" "runner secret source file"
[ "$(stat -c '%a' "$runtime_source")" = "600" ] ||
  fail "runner runtime environment file must have mode 0600"
[ "$(stat -c '%a' "$secret_source")" = "600" ] ||
  fail "runner secret source file must have mode 0600"

host_deny_file=${ZENGUY_HOST_EGRESS_DENY_FILE:-}
[ "$host_deny_file" = "/etc/zenguy/host-egress-deny.conf" ] ||
  fail "ZENGUY_HOST_EGRESS_DENY_FILE must be /etc/zenguy/host-egress-deny.conf"
require_root_file "$host_deny_file" "host egress denylist"
[ "$(stat -c '%a' "$host_deny_file")" = "644" ] ||
  fail "host egress denylist must have mode 0644 for the unprivileged proxy"
awk '
  /^[[:space:]]*($|#)/ { next }
  $1 != "acl" || $2 != "forbidden_host" || $3 != "dst" || NF < 4 { exit 1 }
  {
    for (index = 4; index <= NF; index += 1) {
      if ($index !~ /^[0-9A-Fa-f:.]+(\/(32|128))?$/) { exit 1 }
    }
  }
' "$host_deny_file" ||
  fail "host egress denylist contains an unexpected Squid directive"

host_addresses=$(
  ip -o -4 address show scope global | awk '{ split($4, value, "/"); print value[1] }'
  ip -o -6 address show scope global | awk '{ split($4, value, "/"); print value[1] }'
)
[ -n "$host_addresses" ] || fail "no host interface address could be inventoried"
for host_address in $host_addresses; do
  awk -v expected="$host_address" '
    $1 == "acl" && $2 == "forbidden_host" && $3 == "dst" {
      for (index = 4; index <= NF; index += 1) {
        split($index, value, "/")
        if (tolower(value[1]) == tolower(expected)) { found = 1 }
      }
    }
    END { exit found ? 0 : 1 }
  ' "$host_deny_file" ||
    fail "host egress denylist omits interface address $host_address"
done

credential=${ZENGUY_RUNNER_ENV_FILE:-}
case "$credential" in
  /run/credentials/*/fallback.env) ;;
  *) fail "ZENGUY_RUNNER_ENV_FILE must be the systemd fallback.env credential" ;;
esac
[ -f "$credential" ] || fail "systemd runner credential must be a regular file"
[ -r "$credential" ] || fail "systemd runner credential is not readable"
[ ! -L "$credential" ] || fail "systemd runner credential must not be a symlink"
[ "$(stat -c '%u' "$credential")" = "$(id -u zenguy)" ] ||
  fail "systemd runner credential must be owned by the service user"
[ -z "$(find "$credential" -prune -perm /077 -print -quit)" ] ||
  fail "systemd runner credential must be private to the service user"

deploy_root=${ZENGUY_DEPLOY_ROOT:-}
[ "$deploy_root" = "/opt/zenguy/runner" ] ||
  fail "ZENGUY_DEPLOY_ROOT must be /opt/zenguy/runner"
require_root_directory "/opt" "deployment parent directory"
require_root_directory "/opt/zenguy" "Zenguy deployment directory"
require_root_directory "$deploy_root" "runner deployment root"
require_root_directory "$deploy_root/deploy" "runner deployment configuration directory"
require_root_directory "$deploy_root/deploy/seccomp" "runner seccomp profile directory"
for deployment_file in \
  "$deploy_root/deploy/compose.yml" \
  "$deploy_root/deploy/seccomp/chromium-moby-v0.2.1.json" \
  "$deploy_root/deploy/verify-container-runtime.sh" \
  "$deploy_root/deploy/verify-runtime-images.sh"
do
  require_root_file "$deployment_file" "runner deployment file"
done

printf '%s\n' "container runtime verification passed"
