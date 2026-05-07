#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RUNNER_SCRIPT="${REPO_ROOT}/scripts/e2e-isolated-runner.js"
CLI_ENTRY="${REPO_ROOT}/out/cli/index.js"
PROMPT_TEMPLATE="${SCRIPT_DIR}/copilot-prompt.md"

REQUESTED_AGENT=""
REQUESTED_ROOT=""
INNER_MODE=0

BLUE=$'\033[0;34m'
GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

info() { printf '%s▶%s %s\n' "${BLUE}" "${RESET}" "$*"; }
ok() { printf '%s✔%s %s\n' "${GREEN}" "${RESET}" "$*"; }
die() { printf '%s✘%s %s\n' "${RED}" "${RESET}" "$*" >&2; exit 1; }

print_usage() {
  cat <<'EOF'
Hydra Quickstart Demo

Usage:
  ./quickstart/run.sh [options]

Options:
  --agent <name>   Force a specific agent: codex, claude, or gemini.
  --root <path>    Reuse a specific isolated sandbox root.
  --inner          Internal flag used by the isolated runner.
  -h, --help       Show this help.
EOF
}

require_value() {
  local flag="$1"
  local value="${2-}"
  if [[ -z "${value}" ]]; then
    die "${flag} requires a value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      require_value "$1" "${2-}"
      REQUESTED_AGENT="$2"
      shift 2
      ;;
    --root)
      require_value "$1" "${2-}"
      REQUESTED_ROOT="$2"
      shift 2
      ;;
    --inner)
      INNER_MODE=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

ensure_cli_build() {
  if [[ -f "${CLI_ENTRY}" ]]; then
    return
  fi

  info "Hydra CLI build output is missing. Running npm run compile..."
  (
    cd "${REPO_ROOT}"
    npm run compile
  )
}

if (( INNER_MODE == 0 )) && [[ -z "${HYDRA_E2E_ROOT:-}" ]]; then
  ensure_cli_build

  runner_args=(--keep)
  inner_args=(--inner)
  if [[ -n "${REQUESTED_ROOT}" ]]; then
    runner_args+=(--root "${REQUESTED_ROOT}")
  fi
  if [[ -n "${REQUESTED_AGENT}" ]]; then
    inner_args+=(--agent "${REQUESTED_AGENT}")
  fi

  exec node "${RUNNER_SCRIPT}" "${runner_args[@]}" -- \
    bash "${SCRIPT_DIR}/run.sh" "${inner_args[@]}"
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

pick_agent() {
  if [[ -n "${REQUESTED_AGENT}" ]]; then
    command_exists "${REQUESTED_AGENT}" || die "Requested agent '${REQUESTED_AGENT}' is not on PATH"
    printf '%s' "${REQUESTED_AGENT}"
    return
  fi

  local candidate
  for candidate in codex claude gemini; do
    if command_exists "${candidate}"; then
      printf '%s' "${candidate}"
      return
    fi
  done

  die "No supported agent CLI found on PATH. Install codex, claude, or gemini."
}

json_field() {
  local field="$1"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const value = data[process.argv[1]];
    if (value === undefined || value === null) {
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "${field}"
}

render_prompt() {
  local agent="$1"
  local prompt_path="$2"
  sed "s/__AGENT__/${agent}/g" "${PROMPT_TEMPLATE}" > "${prompt_path}"
}

reset_isolated_state() {
  if [[ -n "${HYDRA_TMUX_SOCKET:-}" ]] && command_exists tmux; then
    tmux kill-server >/dev/null 2>&1 || true
  fi

  if [[ -n "${HYDRA_HOME:-}" ]]; then
    rm -f "${HYDRA_HOME}/sessions.json" "${HYDRA_HOME}/archive.json"
    rm -rf "${HYDRA_HOME}/worktrees" "${HYDRA_HOME}/tmux"
    mkdir -p "${HYDRA_HOME}/bin" "${HYDRA_HOME}/tmux"
  fi
}

for required_cmd in hydra node tmux; do
  command_exists "${required_cmd}" || die "Required command '${required_cmd}' is not on PATH"
done

[[ -f "${PROMPT_TEMPLATE}" ]] || die "Missing prompt template: ${PROMPT_TEMPLATE}"

AGENT="$(pick_agent)"
SANDBOX_ROOT="${HYDRA_E2E_ROOT:-}"
ACTIVATE_SCRIPT="${SANDBOX_ROOT}/activate.sh"
PLAYGROUND_DIR="${SANDBOX_ROOT}/playground"
PROMPT_FILE="${PLAYGROUND_DIR}/quickstart-copilot-task.md"
SESSION_NAME="hydra-quickstart"

printf '\n%sHydra Quickstart Demo%s\n' "${BOLD}" "${RESET}"
printf '%sMinimal bootstrap. Hydra does the rest.%s\n\n' "${DIM}" "${RESET}"

info "Using agent: ${AGENT}"
info "Sandbox root: ${SANDBOX_ROOT}"

reset_isolated_state
rm -rf "${PLAYGROUND_DIR}"
mkdir -p "${PLAYGROUND_DIR}"

render_prompt "${AGENT}" "${PROMPT_FILE}"

info "Creating quickstart copilot..."
COPILOT_JSON="$(hydra copilot create --workdir "${PLAYGROUND_DIR}" --agent "${AGENT}" --session "${SESSION_NAME}" --json)"
COPILOT_SESSION="$(printf '%s' "${COPILOT_JSON}" | json_field session)"

info "Sending orchestration task to ${COPILOT_SESSION}..."
hydra copilot send "${COPILOT_SESSION}" "$(cat "${PROMPT_FILE}")" >/dev/null
ok "Quickstart launched"

printf '\n'
printf '  copilot:    %s\n' "${COPILOT_SESSION}"
printf '  sandbox:    %s\n' "${SANDBOX_ROOT}"
printf '  activate:   source %q\n' "${ACTIVATE_SCRIPT}"
printf '  workspace:  %s\n' "${PLAYGROUND_DIR}"
printf '\n'

info "Next commands"
printf '  source %q\n' "${ACTIVATE_SCRIPT}"
printf '  hydra list --json\n'
printf '  hydra copilot logs %q --lines 80\n' "${COPILOT_SESSION}"
printf '  code --extensionDevelopmentPath=%q %q\n' "${REPO_ROOT}" "${PLAYGROUND_DIR}"
printf '\n'
