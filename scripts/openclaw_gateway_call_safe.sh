#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  openclaw_gateway_call_safe.sh --params '<json>' [--timeout-ms 120000] [--process-timeout-seconds 150]

Description:
  Safe wrapper for `openclaw gateway call agent`.
  If CLI hangs but JSON result is already produced, this wrapper force-stops the process,
  extracts JSON from partial output, and still returns success.
EOF
}

PARAMS=""
TIMEOUT_MS="120000"
PROCESS_TIMEOUT_SECONDS="150"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --params)
      [[ $# -ge 2 ]] || {
        echo "[error] --params requires a value" >&2
        exit 2
      }
      PARAMS="$2"
      shift 2
      ;;
    --timeout-ms)
      [[ $# -ge 2 ]] || {
        echo "[error] --timeout-ms requires a value" >&2
        exit 2
      }
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --process-timeout-seconds)
      [[ $# -ge 2 ]] || {
        echo "[error] --process-timeout-seconds requires a value" >&2
        exit 2
      }
      PROCESS_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[error] unknown flag: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PARAMS" ]]; then
  echo "[error] --params is required" >&2
  usage >&2
  exit 2
fi

python3 - "$PARAMS" "$TIMEOUT_MS" "$PROCESS_TIMEOUT_SECONDS" <<'PY'
import json
import subprocess
import sys


def extract_first_json(raw: str):
    decoder = json.JSONDecoder()
    for idx, ch in enumerate(raw):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(raw[idx:])
            return obj
        except Exception:
            continue
    return None


params_raw, timeout_ms_raw, process_timeout_raw = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    timeout_ms = int(timeout_ms_raw)
    process_timeout = int(process_timeout_raw)
except ValueError:
    sys.stderr.write("[error] timeout values must be integers\n")
    sys.exit(2)

if timeout_ms <= 0 or process_timeout <= 0:
    sys.stderr.write("[error] timeout values must be positive\n")
    sys.exit(2)

cmd = [
    "openclaw",
    "gateway",
    "call",
    "agent",
    "--expect-final",
    "--json",
    "--timeout",
    str(timeout_ms),
    "--params",
    params_raw,
]

timed_out = False
stdout_text = ""
stderr_text = ""
returncode = 0

proc = subprocess.Popen(
    cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
try:
    stdout_text, stderr_text = proc.communicate(timeout=process_timeout)
except subprocess.TimeoutExpired:
    timed_out = True
    proc.kill()
    stdout_text, stderr_text = proc.communicate()

returncode = proc.returncode
combined = (stdout_text or "") + "\n" + (stderr_text or "")
obj = extract_first_json(combined)

if obj is None:
    sys.stderr.write("[error] safe gateway call failed: no json payload captured\n")
    if stderr_text.strip():
        sys.stderr.write(stderr_text.strip() + "\n")
    elif stdout_text.strip():
        sys.stderr.write(stdout_text.strip() + "\n")
    if timed_out:
        sys.stderr.write(f"[hint] process timeout after {process_timeout}s\n")
    sys.exit(1)

if timed_out:
    sys.stderr.write(
        f"[warn] safe gateway call recovered json after process timeout ({process_timeout}s)\n"
    )
elif returncode not in (0, None):
    sys.stderr.write(f"[warn] safe gateway call recovered json with rc={returncode}\n")

sys.stdout.write(json.dumps(obj, ensure_ascii=False))
sys.stdout.write("\n")
PY
