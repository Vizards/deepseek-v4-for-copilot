#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: launch-extension-host.sh <stable|insiders> <port> <workspace>
EOF
}

quality="${1:-}"
port="${2:-}"
workspace="${3:-}"

if [ -z "$quality" ] || [ -z "$port" ] || [ -z "$workspace" ]; then
  usage
  exit 2
fi

case "$quality" in
  stable)
    cli="code"
    install_hint="Shell Command: Install 'code' command in PATH"
    ;;
  insiders)
    cli="code-insiders"
    install_hint="Shell Command: Install 'code-insiders' command in PATH"
    ;;
  *)
    usage
    exit 2
    ;;
esac

if ! command -v "$cli" >/dev/null 2>&1; then
  cat >&2 <<EOF
Missing '$cli' in PATH.
Install it from the target VS Code Command Palette:
  $install_hint
Then restart the terminal and try again.
EOF
  exit 127
fi

is_port_listening() {
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port_release() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! is_port_listening; then
      return 0
    fi
    sleep 0.2
  done

  echo "Port $port is still in use after stopping stale extension host processes." >&2
  return 1
}

if command -v lsof >/dev/null 2>&1; then
  stopped_process=false
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  for pid in $pids; do
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      *"--inspect=127.0.0.1:$port"*|*"--inspect-brk=127.0.0.1:$port"*|*"--inspect=localhost:$port"*|*"--inspect-brk=localhost:$port"*)
        kill "$pid" 2>/dev/null || true
        stopped_process=true
        ;;
      "")
        cat >&2 <<EOF
Port $port is already used by PID $pid, but its command line could not be inspected.
Refusing to stop it automatically.
EOF
        exit 1
        ;;
      *)
        cat >&2 <<EOF
Port $port is already used by PID $pid, but it does not look like a VS Code extension host:
$command_line
Refusing to stop it automatically.
EOF
        exit 1
        ;;
    esac
  done

  if [ "$stopped_process" = true ]; then
    wait_for_port_release
  fi
else
  echo "Warning: lsof is not available; skipping stale inspector cleanup for port $port." >&2
fi

"$cli" \
  --new-window \
  "--inspect-extensions=$port" \
  "--extensionDevelopmentPath=$workspace" \
  "$workspace"
