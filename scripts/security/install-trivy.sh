#!/bin/sh
set -eu
PATH=/usr/bin:/bin
export PATH

TRIVY_VERSION=0.73.0
TRIVY_ARCHIVE="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
TRIVY_SHA256=2edd39da482bb4e9831962487b68f68e3928ec3137794757f54d00383d79547b
TRIVY_URL="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${TRIVY_ARCHIVE}"

: "${RUNNER_TEMP:?RUNNER_TEMP must identify the private GitHub runner temp directory}"
[ "$(/usr/bin/uname -s)" = "Linux" ] || {
  printf '%s\n' "Trivy installer supports only the reviewed Linux runner" >&2
  exit 1
}
[ "$(/usr/bin/uname -m)" = "x86_64" ] || {
  printf '%s\n' "Trivy installer supports only the reviewed amd64 runner" >&2
  exit 1
}

umask 077
archive_path="${RUNNER_TEMP}/${TRIVY_ARCHIVE}"
install_directory="${RUNNER_TEMP}/zenguy-tools"
/usr/bin/curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --proto-redir '=https' \
  --tlsv1.2 \
  --output "$archive_path" \
  "$TRIVY_URL"
actual_sha=$(/usr/bin/sha256sum "$archive_path")
actual_sha=${actual_sha%% *}
[ "$actual_sha" = "$TRIVY_SHA256" ] || {
  printf '%s\n' "Downloaded Trivy archive does not match the reviewed release" >&2
  exit 1
}

/usr/bin/install -d -m 0700 "$install_directory"
/usr/bin/tar --extract --gzip --file "$archive_path" --directory "$install_directory" trivy
/usr/bin/chmod 0755 "${install_directory}/trivy"
archive_binary_sha=$(/usr/bin/tar --extract --gzip --to-stdout --file "$archive_path" trivy | /usr/bin/sha256sum)
archive_binary_sha=${archive_binary_sha%% *}
installed_binary_sha=$(/usr/bin/sha256sum "${install_directory}/trivy")
installed_binary_sha=${installed_binary_sha%% *}
[ "$installed_binary_sha" = "$archive_binary_sha" ] || {
  printf '%s\n' "Installed Trivy binary differs from the reviewed archive" >&2
  exit 1
}
"${install_directory}/trivy" --version | /usr/bin/grep -F "Version: ${TRIVY_VERSION}" >/dev/null
