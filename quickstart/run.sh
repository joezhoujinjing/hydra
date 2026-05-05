#!/usr/bin/env bash
# Hydra Quickstart — Fully Autonomous Demo
# Run this script and walk away. Come back to find 3 PRs created by parallel AI workers.
#
# Usage: ./quickstart/run.sh

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────────

REPO_NAME="hydra-demo"
POLL_INTERVAL=30
MAX_WAIT=600  # 10 minutes

# ─── Colors ─────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()  { echo -e "${BLUE}▶${RESET} $*"; }
ok()    { echo -e "${GREEN}✔${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $*"; }
fail()  { echo -e "${RED}✘${RESET} $*"; exit 1; }

# ─── Preflight ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}🐉 Hydra Quickstart Demo${RESET}"
echo -e "${DIM}Fully autonomous — sit back and watch.${RESET}"
echo ""

info "Running hydra doctor..."
if ! hydra doctor --quiet 2>/dev/null; then
  hydra doctor
  fail "Fix the issues above and re-run."
fi
ok "All prerequisites passed"

# ─── Phase 1: Create demo repo ──────────────────────────────────────────────────

info "Creating private repo: ${REPO_NAME}"

WORK_DIR=$(mktemp -d)/hydra-demo

if gh repo view "$REPO_NAME" &>/dev/null 2>&1; then
  warn "Repo '$REPO_NAME' already exists. Deleting..."
  gh repo delete "$REPO_NAME" --yes
  sleep 2
fi

gh repo create "$REPO_NAME" --private --clone --directory "$WORK_DIR"
cd "$WORK_DIR"
ok "Repo created at $WORK_DIR"

# ─── Phase 2: Scaffold project ──────────────────────────────────────────────────

info "Scaffolding TypeScript project..."

cat > package.json << 'PACKAGE'
{
  "name": "hydra-demo",
  "version": "1.0.0",
  "description": "A TypeScript calculator CLI — built by Hydra workers in parallel",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/cli.js"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "commander": "^12.0.0"
  }
}
PACKAGE

cat > tsconfig.json << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
TSCONFIG

mkdir -p src

cat > src/index.ts << 'INDEX'
// Calculator core — to be implemented by feat/core worker
export function placeholder() {
  return "Hydra demo scaffold";
}
INDEX

git add -A
git commit -m "chore: initial project scaffold"
git push -u origin main
ok "Project scaffolded and pushed"

# ─── Phase 3: Spawn workers ─────────────────────────────────────────────────────

info "Spawning 3 parallel workers..."
echo ""

TASK_CORE="Implement a calculator module in src/calculator.ts. Export functions: add(a: number, b: number): number, subtract(a: number, b: number): number, multiply(a: number, b: number): number, divide(a: number, b: number): number. The divide function should throw an Error on division by zero. Also export a type CalcOperation = 'add' | 'subtract' | 'multiply' | 'divide' and a calculate(op: CalcOperation, a: number, b: number): number dispatcher function. When done: commit, push, and run: gh pr create --title 'feat: calculator core functions' --body 'Implements add, subtract, multiply, divide with type-safe dispatcher.'"

TASK_CLI="Build a CLI in src/cli.ts using the commander package (already in package.json). The CLI should support: calc <operation> <a> <b> where operation is add|subtract|multiply|divide. Import from ./calculator.ts (assume exports: add, subtract, multiply, divide, calculate, CalcOperation). Add a #!/usr/bin/env node shebang. Print the result to stdout. Handle errors gracefully (print message to stderr, exit 1). When done: commit, push, and run: gh pr create --title 'feat: CLI interface with Commander.js' --body 'Adds calc command supporting add/subtract/multiply/divide operations.'"

TASK_TESTS="Write Vitest tests in src/calculator.test.ts. Import from ./calculator.ts (assume exports: add, subtract, multiply, divide, calculate, CalcOperation). Test all operations including: basic arithmetic, division by zero throws, calculate dispatcher with all ops, edge cases (negative numbers, zero, large numbers, decimals). At least 12 test cases in describe blocks. When done: commit, push, and run: gh pr create --title 'feat: comprehensive Vitest test suite' --body 'Adds test coverage for all calculator operations including edge cases.'"

SESSION_CORE=$(hydra worker create --repo "$WORK_DIR" --branch feat/core --task "$TASK_CORE" --json 2>/dev/null | grep -o '"session":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${GREEN}●${RESET} Worker 1: ${BOLD}feat/core${RESET}  → $SESSION_CORE"

SESSION_CLI=$(hydra worker create --repo "$WORK_DIR" --branch feat/cli --task "$TASK_CLI" --json 2>/dev/null | grep -o '"session":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${GREEN}●${RESET} Worker 2: ${BOLD}feat/cli${RESET}   → $SESSION_CLI"

SESSION_TESTS=$(hydra worker create --repo "$WORK_DIR" --branch feat/tests --task "$TASK_TESTS" --json 2>/dev/null | grep -o '"session":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${GREEN}●${RESET} Worker 3: ${BOLD}feat/tests${RESET} → $SESSION_TESTS"

echo ""
ok "All workers spawned"

# ─── Phase 4: Monitor until PRs appear ──────────────────────────────────────────

info "Monitoring workers (polling every ${POLL_INTERVAL}s, timeout ${MAX_WAIT}s)..."
echo -e "${DIM}   Open VS Code to watch live: code . → Hydra sidebar${RESET}"
echo ""

elapsed=0
prs_found=0
target_prs=3

while [ "$elapsed" -lt "$MAX_WAIT" ] && [ "$prs_found" -lt "$target_prs" ]; do
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))

  prs_found=$(gh pr list --repo "$REPO_NAME" --state open --json number 2>/dev/null | grep -c "number" || echo 0)

  # Show brief status
  workers_running=$(hydra list --json 2>/dev/null | grep -o '"status":"running"' | wc -l | tr -d ' ')
  echo -e "  ${DIM}[${elapsed}s]${RESET} PRs: ${BOLD}${prs_found}/${target_prs}${RESET} | Active workers: ${workers_running}"
done

echo ""

# ─── Phase 5: Report ────────────────────────────────────────────────────────────

if [ "$prs_found" -ge "$target_prs" ]; then
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}  🎉 Hydra Demo Complete — All PRs Created!${RESET}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════${RESET}"
else
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════${RESET}"
  echo -e "${YELLOW}${BOLD}  ⏱  Timeout reached — ${prs_found}/${target_prs} PRs created${RESET}"
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════${RESET}"
  echo -e "${DIM}  Workers may still be running. Check: hydra list${RESET}"
fi

echo ""
info "Pull Requests:"
gh pr list --repo "$REPO_NAME" --state open
echo ""
info "Workers:"
hydra list --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for w in data.get('workers', []):
    print(f\"  {w['branch']:20s} | {w['status']:10s} | {w['agent']}\")
" 2>/dev/null || hydra list

echo ""
echo -e "${DIM}Cleanup when done: gh repo delete $REPO_NAME --yes${RESET}"
echo ""
