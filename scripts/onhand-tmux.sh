#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SESSION_NAME="${ONHAND_TMUX_SESSION:-onhand}"
SOCKET_NAME="${ONHAND_TMUX_SOCKET:-onhand}"

tmux_cmd() {
  tmux -L "${SOCKET_NAME}" "$@"
}

build_window_command() {
  local command="$1"
  printf "cd %q && %s; exit_code=\$?; printf '\\n[onhand tmux] command exited with status %%s\\n' \"\$exit_code\"; exec \$SHELL -l" "${PROJECT_ROOT}" "${command}"
}

start_session() {
  if tmux_cmd has-session -t "${SESSION_NAME}" 2>/dev/null; then
    echo "tmux session '${SESSION_NAME}' is already running"
    return 0
  fi

  local bridge_command
  local desktop_command
  bridge_command="$(build_window_command "node ./packages/browser-bridge/server.mjs")"
  desktop_command="$(build_window_command "./node_modules/.bin/electron ./apps/desktop/main.mjs")"

  tmux_cmd new-session -d -s "${SESSION_NAME}" -n bridge -c "${PROJECT_ROOT}" "${bridge_command}"
  tmux_cmd set-option -t "${SESSION_NAME}" remain-on-exit on >/dev/null
  tmux_cmd new-window -t "${SESSION_NAME}" -n desktop -c "${PROJECT_ROOT}" "${desktop_command}"
  tmux_cmd select-window -t "${SESSION_NAME}:bridge"
  echo "Started tmux session '${SESSION_NAME}' with windows: bridge, desktop"
}

stop_session() {
  if ! tmux_cmd has-session -t "${SESSION_NAME}" 2>/dev/null; then
    echo "tmux session '${SESSION_NAME}' is not running"
    return 0
  fi
  tmux_cmd kill-session -t "${SESSION_NAME}"
  tmux_cmd kill-server >/dev/null 2>&1 || true
  echo "Stopped tmux session '${SESSION_NAME}'"
}

attach_session() {
  tmux_cmd attach -t "${SESSION_NAME}"
}

status_session() {
  if ! tmux_cmd has-session -t "${SESSION_NAME}" 2>/dev/null; then
    echo "tmux session '${SESSION_NAME}' is not running"
    return 0
  fi

  tmux_cmd list-windows -t "${SESSION_NAME}" -F '#{window_index}:#{window_name}:#{window_active}:#{window_panes}'
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|attach|status>

Environment:
  ONHAND_TMUX_SESSION   Override the tmux session name (default: onhand)
  ONHAND_TMUX_SOCKET    Override the tmux socket name (default: onhand)
EOF
}

command="${1:-status}"
case "${command}" in
  start) start_session ;;
  stop) stop_session ;;
  attach) attach_session ;;
  status) status_session ;;
  *)
    usage
    exit 1
    ;;
esac
