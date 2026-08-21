#!/opt/homebrew/bin/python3.11
"""One-command launcher for the local Zenguy browser worker."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
SYSTEM_PYTHON = Path("/opt/homebrew/bin/python3.11")
VENV = ROOT / "runner" / ".venv"
VENV_PYTHON = VENV / "bin" / "python"
WORKER = ROOT / "runner" / "browser_worker.py"
BROWSER_USE_VERSION = "0.13.8"


def ensure_runtime() -> None:
    if not SYSTEM_PYTHON.is_file():
        raise SystemExit(f"Python 3.11 is missing at {SYSTEM_PYTHON}")
    if VENV_PYTHON.is_file():
        ready = subprocess.run(
            [
                str(VENV_PYTHON),
                "-c",
                (
                    "import importlib.metadata as m; "
                    f"assert m.version('browser-use') == '{BROWSER_USE_VERSION}'"
                ),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if ready.returncode == 0:
            return
    print("Preparing the local browser-worker runtime (one time only)...", flush=True)
    if not VENV_PYTHON.is_file():
        subprocess.run([str(SYSTEM_PYTHON), "-m", "venv", str(VENV)], check=True)
    subprocess.run(
        [
            str(VENV_PYTHON),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(ROOT / "runner" / "requirements.txt"),
        ],
        check=True,
    )


def main() -> None:
    ensure_runtime()
    os.execv(
        str(VENV_PYTHON),
        [str(VENV_PYTHON), str(WORKER), *sys.argv[1:]],
    )


if __name__ == "__main__":
    main()
