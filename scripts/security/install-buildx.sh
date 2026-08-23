#!/bin/sh
set -eu
PATH=/usr/bin:/bin
export PATH

BUILDX_VERSION=v0.36.1
BUILDX_SHA256=48af8a397ebd60178778bf63611dbcebe5f5e7a9be90eb9147b24b9587455778
BUILDX_URL="https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-amd64"

: "${RUNNER_TEMP:?RUNNER_TEMP must identify the private GitHub runner temp directory}"
: "${HOME:?HOME must identify the ephemeral GitHub runner account}"
[ "$(/usr/bin/uname -s)" = "Linux" ] || {
  printf '%s\n' "Buildx installer supports only the reviewed Linux runner" >&2
  exit 1
}
[ "$(/usr/bin/uname -m)" = "x86_64" ] || {
  printf '%s\n' "Buildx installer supports only the reviewed amd64 runner" >&2
  exit 1
}

umask 077
download_path="${RUNNER_TEMP}/zenguy-buildx-${BUILDX_VERSION}"
/usr/bin/curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --proto-redir '=https' \
  --tlsv1.2 \
  --output "$download_path" \
  "$BUILDX_URL"
actual_sha=$(/usr/bin/sha256sum "$download_path")
actual_sha=${actual_sha%% *}
[ "$actual_sha" = "$BUILDX_SHA256" ] || {
  printf '%s\n' "Downloaded Buildx digest does not match the reviewed release" >&2
  exit 1
}

plugin_directory="${HOME}/.docker/cli-plugins"
/usr/bin/install -d -m 0700 "${HOME}/.docker" "$plugin_directory"
/usr/bin/install -m 0755 "$download_path" "${plugin_directory}/docker-buildx"
installed_sha=$(/usr/bin/sha256sum "${plugin_directory}/docker-buildx")
installed_sha=${installed_sha%% *}
[ "$installed_sha" = "$BUILDX_SHA256" ] || {
  printf '%s\n' "Installed Buildx digest changed unexpectedly" >&2
  exit 1
}
/usr/bin/docker buildx version | /usr/bin/grep -F "${BUILDX_VERSION}" >/dev/null
