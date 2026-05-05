#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RUNNER_SCRIPT="${REPO_ROOT}/scripts/e2e-isolated-runner.js"
CLI_ENTRY="${REPO_ROOT}/out/cli/index.js"

POLL_INTERVAL=20
MAX_WAIT=360
REQUESTED_AGENT=""
REQUESTED_ROOT=""
INNER_MODE=0

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

info() { printf '%s▶%s %s\n' "${BLUE}" "${RESET}" "$*"; }
ok() { printf '%s✔%s %s\n' "${GREEN}" "${RESET}" "$*"; }
warn() { printf '%s⚠%s %s\n' "${YELLOW}" "${RESET}" "$*"; }
die() { printf '%s✘%s %s\n' "${RED}" "${RESET}" "$*" >&2; exit 1; }

print_usage() {
  cat <<'EOF'
Hydra Quickstart Demo

Usage:
  ./quickstart/run.sh [options]

Options:
  --agent <name>            Force a specific agent: codex, claude, or gemini.
  --root <path>             Reuse a specific isolated sandbox root.
  --poll-interval <secs>    Worker polling interval in seconds. Default: 20.
  --max-wait <secs>         Max time to wait for all branches. Default: 360.
  --inner                   Internal flag used by the isolated runner.
  -h, --help                Show this help.
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
    --poll-interval)
      require_value "$1" "${2-}"
      POLL_INTERVAL="$2"
      shift 2
      ;;
    --max-wait)
      require_value "$1" "${2-}"
      MAX_WAIT="$2"
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

case "${POLL_INTERVAL}" in
  ''|*[!0-9]*)
    die "--poll-interval must be a positive integer"
    ;;
esac
case "${MAX_WAIT}" in
  ''|*[!0-9]*)
    die "--max-wait must be a positive integer"
    ;;
esac
if (( POLL_INTERVAL <= 0 )); then
  die "--poll-interval must be greater than 0"
fi
if (( MAX_WAIT <= 0 )); then
  die "--max-wait must be greater than 0"
fi

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
  inner_args=(
    --inner
    --poll-interval "${POLL_INTERVAL}"
    --max-wait "${MAX_WAIT}"
  )
  if [[ -n "${REQUESTED_ROOT}" ]]; then
    runner_args+=(--root "${REQUESTED_ROOT}")
  fi
  if [[ -n "${REQUESTED_AGENT}" ]]; then
    inner_args+=(--agent "${REQUESTED_AGENT}")
  fi

  exec node "${RUNNER_SCRIPT}" "${runner_args[@]}" -- \
    bash "${SCRIPT_DIR}/run.sh" \
      "${inner_args[@]}"
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

pick_agent() {
  if [[ -n "${REQUESTED_AGENT}" ]]; then
    if ! command_exists "${REQUESTED_AGENT}"; then
      die "Requested agent '${REQUESTED_AGENT}' is not on PATH"
    fi
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

count_running_workers() {
  hydra list --json | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const workers = Array.isArray(data.workers) ? data.workers : [];
    const running = workers.filter(worker => worker && worker.status === "running").length;
    process.stdout.write(String(running));
  '
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

write_demo_files() {
  cat > package.json <<'EOF'
{
  "name": "hydra-demo",
  "version": "1.0.0",
  "private": true,
  "description": "Hydra quickstart sandbox project",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "commander": "^14.0.3"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
EOF

  cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF

  cat > .gitignore <<'EOF'
dist
node_modules
EOF

  mkdir -p src

  cat > src/calculator.ts <<'EOF'
export type CalcOperation = 'add' | 'subtract' | 'multiply' | 'divide';

function todo(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}

export function add(a: number, b: number): number {
  return todo(`add(${a}, ${b})`);
}

export function subtract(a: number, b: number): number {
  return todo(`subtract(${a}, ${b})`);
}

export function multiply(a: number, b: number): number {
  return todo(`multiply(${a}, ${b})`);
}

export function divide(a: number, b: number): number {
  return todo(`divide(${a}, ${b})`);
}

export function calculate(op: CalcOperation, a: number, b: number): number {
  switch (op) {
    case 'add':
      return add(a, b);
    case 'subtract':
      return subtract(a, b);
    case 'multiply':
      return multiply(a, b);
    case 'divide':
      return divide(a, b);
  }
}
EOF

  cat > src/index.ts <<'EOF'
export * from './calculator.js';
EOF

  cat > README.md <<'EOF'
# Hydra Demo Workspace

This repository was scaffolded by `quickstart/run.sh` inside an isolated Hydra sandbox.

Branches created by the demo:

- `feat/core` implements the calculator contract
- `feat/cli` builds a small CLI on top of that contract
- `feat/tests` adds Vitest coverage for the contract
EOF
}

make_task_core() {
  cat <<'EOF'
You own `src/calculator.ts` and `src/index.ts`.

Implement the calculator contract that is already scaffolded in `src/calculator.ts`:
- `add(a, b)`
- `subtract(a, b)`
- `multiply(a, b)`
- `divide(a, b)` with an `Error` on division by zero
- `calculate(op, a, b)` as the dispatcher

Constraints:
- Keep the branch focused on the calculator core.
- Do not edit the CLI or test files.
- Keep relative TypeScript imports compatible with `module: "NodeNext"` by using `.js` extensions in TS imports when needed.

Before finishing:
1. Run `npm run build`.
2. Commit with message `feat: implement calculator core`.
3. Push with `git push -u origin feat/core`.
EOF
}

make_task_cli() {
  cat <<'EOF'
You own `src/cli.ts` only.

Build a CLI using `commander` with the shape `calc <operation> <a> <b>`.
Requirements:
- Use a `#!/usr/bin/env node` shebang.
- Import `calculate` and `CalcOperation` from `./calculator.js`.
- Accept `add`, `subtract`, `multiply`, and `divide`.
- Print the numeric result to stdout.
- Print errors to stderr and exit with code 1.

Constraints:
- Do not modify calculator logic or test files.
- Assume the calculator contract in `src/calculator.ts` is the source of truth.

Before finishing:
1. Run `npm run build`.
2. Commit with message `feat: add calculator cli`.
3. Push with `git push -u origin feat/cli`.
EOF
}

make_task_tests() {
  cat <<'EOF'
You own `src/calculator.test.ts` only.

Write a Vitest suite for the calculator contract in `src/calculator.ts`.
Coverage requirements:
- add, subtract, multiply, divide
- division by zero
- the `calculate` dispatcher
- negative numbers, zero, and decimals
- at least 12 assertions total

Constraints:
- Do not edit the calculator implementation or the CLI.
- This branch is allowed to target the contract even if the placeholder implementation on `main` still fails the new tests.

Before finishing:
1. Commit with message `test: add calculator coverage`.
2. Push with `git push -u origin feat/tests`.
EOF
}

spawn_worker() {
  local branch="$1"
  local task="$2"
  local result
  result="$(hydra worker create --repo "${WORK_DIR}" --branch "${branch}" --agent "${AGENT}" --task "${task}" --json)"
  local session workdir
  session="$(printf '%s' "${result}" | json_field session)"
  workdir="$(printf '%s' "${result}" | json_field workdir)"
  printf '%s\t%s' "${session}" "${workdir}"
}

remote_branch_exists() {
  git --git-dir="${ORIGIN_DIR}" show-ref --verify --quiet "refs/heads/$1"
}

local_commits_ahead() {
  git -C "${WORK_DIR}" rev-list --count "main..$1" 2>/dev/null || printf '0'
}

branch_state_label() {
  local branch="$1"
  local expected_file="$2"
  local workdir="$3"

  if remote_branch_exists "${branch}" && [[ -f "${workdir}/${expected_file}" ]]; then
    printf 'pushed'
    return
  fi

  if [[ -f "${workdir}/${expected_file}" ]]; then
    printf 'edited'
    return
  fi

  local commits
  commits="$(local_commits_ahead "${branch}")"
  if [[ "${commits}" != "0" ]]; then
    printf 'committed'
    return
  fi

  printf 'running'
}

printf '\n%sHydra Quickstart Demo%s\n' "${BOLD}" "${RESET}"
printf '%sIsolated sandbox, local repo, 3 parallel workers.%s\n\n' "${DIM}" "${RESET}"

for required_cmd in git node npm hydra tmux; do
  if ! command_exists "${required_cmd}"; then
    die "Required command '${required_cmd}' is not on PATH"
  fi
done

AGENT="$(pick_agent)"
SANDBOX_ROOT="${HYDRA_E2E_ROOT:-}"
if [[ -z "${SANDBOX_ROOT}" ]]; then
  SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hydra-quickstart-XXXXXX")"
fi

ACTIVATE_SCRIPT="${SANDBOX_ROOT}/activate.sh"
PLAYGROUND_DIR="${SANDBOX_ROOT}/playground"
ORIGIN_DIR="${PLAYGROUND_DIR}/hydra-demo-origin.git"
WORK_DIR="${PLAYGROUND_DIR}/hydra-demo"
INSTALL_LOG="${PLAYGROUND_DIR}/npm-install.log"

info "Using agent: ${AGENT}"
info "Sandbox root: ${SANDBOX_ROOT}"

reset_isolated_state

if [[ -e "${PLAYGROUND_DIR}" ]]; then
  warn "Resetting existing quickstart playground at ${PLAYGROUND_DIR}"
  rm -rf "${PLAYGROUND_DIR}"
fi
mkdir -p "${PLAYGROUND_DIR}"

info "Creating local demo repository..."
git init --bare "${ORIGIN_DIR}" >/dev/null
git init -b main "${WORK_DIR}" >/dev/null
cd "${WORK_DIR}"
git config user.name "Hydra Quickstart"
git config user.email "quickstart@hydra.local"
git remote add origin "${ORIGIN_DIR}"
write_demo_files
ok "Workspace scaffolded at ${WORK_DIR}"

info "Installing demo dependencies..."
if npm install --no-fund --no-audit >"${INSTALL_LOG}" 2>&1; then
  ok "Dependencies installed"
else
  die "npm install failed. See ${INSTALL_LOG}"
fi

git add -A
git commit -m "chore: scaffold quickstart demo" >/dev/null
git push -u origin main >/dev/null
ok "Local origin seeded"

TASK_CORE="$(make_task_core)"
TASK_CLI="$(make_task_cli)"
TASK_TESTS="$(make_task_tests)"

declare -A SESSION_BY_BRANCH
declare -A WORKDIR_BY_BRANCH
declare -A FILE_BY_BRANCH=(
  ["feat/core"]="src/calculator.ts"
  ["feat/cli"]="src/cli.ts"
  ["feat/tests"]="src/calculator.test.ts"
)

info "Spawning 3 parallel workers..."

IFS=$'\t' read -r core_session core_workdir <<<"$(spawn_worker "feat/core" "${TASK_CORE}")"
SESSION_BY_BRANCH["feat/core"]="${core_session}"
WORKDIR_BY_BRANCH["feat/core"]="${core_workdir}"
printf '  %s●%s %sfeat/core%s  -> %s\n' "${GREEN}" "${RESET}" "${BOLD}" "${RESET}" "${core_session}"

IFS=$'\t' read -r cli_session cli_workdir <<<"$(spawn_worker "feat/cli" "${TASK_CLI}")"
SESSION_BY_BRANCH["feat/cli"]="${cli_session}"
WORKDIR_BY_BRANCH["feat/cli"]="${cli_workdir}"
printf '  %s●%s %sfeat/cli%s   -> %s\n' "${GREEN}" "${RESET}" "${BOLD}" "${RESET}" "${cli_session}"

IFS=$'\t' read -r tests_session tests_workdir <<<"$(spawn_worker "feat/tests" "${TASK_TESTS}")"
SESSION_BY_BRANCH["feat/tests"]="${tests_session}"
WORKDIR_BY_BRANCH["feat/tests"]="${tests_workdir}"
printf '  %s●%s %sfeat/tests%s -> %s\n' "${GREEN}" "${RESET}" "${BOLD}" "${RESET}" "${tests_session}"

ok "All workers launched"

info "Monitoring worker branches for up to ${MAX_WAIT}s..."
printf '%sUse the activation script below if you want to inspect the sandbox in another shell.%s\n\n' "${DIM}" "${RESET}"

elapsed=0
completed=0
branches=("feat/core" "feat/cli" "feat/tests")

while (( elapsed < MAX_WAIT )); do
  completed=0
  status_parts=()

  for branch in "${branches[@]}"; do
    status="$(branch_state_label "${branch}" "${FILE_BY_BRANCH[$branch]}" "${WORKDIR_BY_BRANCH[$branch]}")"
    status_parts+=("${branch}=${status}")
    if [[ "${status}" == "pushed" ]]; then
      completed=$((completed + 1))
    fi
  done

  running_workers="$(count_running_workers)"
  printf '  %s[%3ss]%s branches: %s/3 | active workers: %s | %s\n' \
    "${DIM}" "${elapsed}" "${RESET}" "${completed}" "${running_workers}" "${status_parts[*]}"

  if (( completed == 3 )); then
    break
  fi

  sleep "${POLL_INTERVAL}"
  elapsed=$((elapsed + POLL_INTERVAL))
done

printf '\n'
if (( completed == 3 )); then
  printf '%s%sHydra Quickstart Complete%s\n' "${GREEN}" "${BOLD}" "${RESET}"
else
  printf '%s%sHydra Quickstart Timed Out%s\n' "${YELLOW}" "${BOLD}" "${RESET}"
fi

printf '  sandbox:   %s\n' "${SANDBOX_ROOT}"
printf '  activate:  source %q\n' "${ACTIVATE_SCRIPT}"
printf '  workspace: %s\n' "${WORK_DIR}"
printf '  origin:    %s\n' "${ORIGIN_DIR}"
printf '  agent:     %s\n' "${AGENT}"
printf '\n'

info "Worker summary"
for branch in "${branches[@]}"; do
  printf '  %-10s | %-8s | %s\n' \
    "${branch}" \
    "$(branch_state_label "${branch}" "${FILE_BY_BRANCH[$branch]}" "${WORKDIR_BY_BRANCH[$branch]}")" \
    "${SESSION_BY_BRANCH[$branch]}"
done

printf '\n'
info "Next commands"
printf '  source %q\n' "${ACTIVATE_SCRIPT}"
printf '  hydra list --json\n'
printf '  git -C %q log --oneline --graph --all --decorate\n' "${WORK_DIR}"
printf '  hydra worker logs %q --lines 80\n' "${SESSION_BY_BRANCH[feat/core]}"
printf '  code --extensionDevelopmentPath=%q %q\n' "${REPO_ROOT}" "${WORK_DIR}"
printf '\n'
