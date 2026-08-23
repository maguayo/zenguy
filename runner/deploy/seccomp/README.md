# Runner seccomp profile

`chromium-moby-v0.2.1.json` is vendored from the `default.json` profile in
Moby `docker-v29.5.2` / `moby/profiles` tag `seccomp/v0.2.1`:

- upstream URL: `https://raw.githubusercontent.com/moby/moby/docker-v29.5.2/vendor/github.com/moby/profiles/seccomp/default.json`
- upstream SHA-256: `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`
- vendored SHA-256: `e3b409d7dced72dbd0ed5fe5652230164275082df37b4420cacfb0635ea8f426`

The only semantic change is the removal of `socketcall` from the general
allowlist. The upstream profile already rejects `socket(AF_ALG, ...)`, but the
compatibility `socketcall` path can bypass that filter on affected
architectures. Keeping it denied also provides defense in depth for
CVE-2026-31431 while hosts are patched.

The systemd deployment uses this exact repository path and
`verify-container-runtime.sh` contains the expected digest. Do not copy a
profile into `/etc`, make the path or checksum configurable, or update either
file without security review and a real Chromium sandbox smoke test.
