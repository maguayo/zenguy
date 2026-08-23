FROM python:3.12.14-slim-bookworm@sha256:a116514e19457bcb7af7efe9c3dd0b9b71e85b317694e7882a1c52aa15a78134

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

ARG DEBIAN_SNAPSHOT=20260823T000000Z
RUN test -s /etc/ssl/certs/ca-certificates.crt \
    && sed -i \
      -e "s|http://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g" \
      -e "s|http://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

WORKDIR /opt/zenguy/runner
COPY requirements.lock ./
# The lock is a complete graph. --no-deps prevents pip from re-resolving the
# intentionally overridden, vulnerable exact pins in browser-use metadata.
RUN python -m pip install --no-deps --only-binary=:all: --require-hashes \
      --requirement requirements.lock
COPY browser_worker.py ./

USER 10001:10001
# Verify the exact installed lock and the final browser-use Chromium argv as
# the same unprivileged UID used in production. CI and systemd repeat the real
# launch with the reviewed seccomp profile before signing and activation.
RUN python /opt/zenguy/runner/browser_worker.py --verify-image
ENTRYPOINT ["python", "/opt/zenguy/runner/browser_worker.py"]
