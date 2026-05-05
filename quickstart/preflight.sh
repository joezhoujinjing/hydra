#!/usr/bin/env bash
# Hydra Quickstart — Preflight Check
# Verifies all prerequisites are installed before running the demo.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

PASS="${GREEN}✔${RESET}"
FAIL="${RED}✘${RESET}"
WARN="${YELLOW}⚠${RESET}"

errors=0
warnings=0

header() {
  echo ""
  echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${BLUE}${BOLD}║        🐉 Hydra Quickstart Preflight        ║${RESET}"
  echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
}

check() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"
  local required="${4:-true}"

  if command -v "$cmd" &>/dev/null; then
    local version
    version=$("$cmd" --version 2>/dev/null | head -1 || echo "installed")
    echo -e "  ${PASS}  ${BOLD}${name}${RESET} ${DIM}(${version})${RESET}"
    return 0
  else
    if [ "$required" = "true" ]; then
      echo -e "  ${FAIL}  ${BOLD}${name}${RESET} — ${RED}not found${RESET}"
      echo -e "      ${DIM}Install: ${install_hint}${RESET}"
      ((errors++))
    else
      echo -e "  ${WARN}  ${BOLD}${name}${RESET} — ${YELLOW}not found (optional)${RESET}"
      echo -e "      ${DIM}Install: ${install_hint}${RESET}"
      ((warnings++))
    fi
    return 1
  fi
}

check_gh_auth() {
  if ! command -v gh &>/dev/null; then
    echo -e "  ${FAIL}  ${BOLD}gh CLI${RESET} — ${RED}not found${RESET}"
    echo -e "      ${DIM}Install: https://cli.github.com/${RESET}"
    ((errors++))
    return 1
  fi

  if gh auth status &>/dev/null 2>&1; then
    local account
    account=$(gh auth status 2>&1 | grep -o 'Logged in to [^ ]* account [^ ]*' | head -1 || echo "authenticated")
    echo -e "  ${PASS}  ${BOLD}gh CLI${RESET} ${DIM}(${account})${RESET}"
    return 0
  else
    echo -e "  ${FAIL}  ${BOLD}gh CLI${RESET} — ${RED}installed but not authenticated${RESET}"
    echo -e "      ${DIM}Run: gh auth login${RESET}"
    ((errors++))
    return 1
  fi
}

check_hydra() {
  if command -v hydra &>/dev/null || [ -x "$HOME/.hydra/bin/hydra" ]; then
    local hydra_cmd
    hydra_cmd=$(command -v hydra 2>/dev/null || echo "$HOME/.hydra/bin/hydra")
    local version
    version=$("$hydra_cmd" --version 2>/dev/null | head -1 || echo "installed")
    echo -e "  ${PASS}  ${BOLD}Hydra CLI${RESET} ${DIM}(${version})${RESET}"
    return 0
  else
    echo -e "  ${FAIL}  ${BOLD}Hydra CLI${RESET} — ${RED}not found${RESET}"
    echo -e "      ${DIM}Install the Hydra Code extension in VS Code, then restart your terminal.${RESET}"
    ((errors++))
    return 1
  fi
}

check_agents() {
  echo ""
  echo -e "${BOLD}  AI Agents ${DIM}(at least one required)${RESET}"
  echo ""

  local found=0

  if command -v claude &>/dev/null; then
    echo -e "  ${PASS}  ${BOLD}claude${RESET} ${DIM}(Claude Code CLI)${RESET}"
    ((found++))
  else
    echo -e "  ${DIM}  ·   claude — not found (npm install -g @anthropic-ai/claude-code)${RESET}"
  fi

  if command -v codex &>/dev/null; then
    echo -e "  ${PASS}  ${BOLD}codex${RESET} ${DIM}(OpenAI Codex CLI)${RESET}"
    ((found++))
  else
    echo -e "  ${DIM}  ·   codex — not found (npm install -g @openai/codex)${RESET}"
  fi

  if command -v gemini &>/dev/null; then
    echo -e "  ${PASS}  ${BOLD}gemini${RESET} ${DIM}(Gemini CLI)${RESET}"
    ((found++))
  else
    echo -e "  ${DIM}  ·   gemini — not found (npm install -g @anthropic-ai/gemini-cli)${RESET}"
  fi

  echo ""
  if [ "$found" -eq 0 ]; then
    echo -e "  ${FAIL}  ${RED}No AI agent CLI found. Install at least one of the above.${RESET}"
    ((errors++))
  else
    echo -e "  ${PASS}  ${GREEN}${found} agent(s) available${RESET}"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────────

header

echo -e "${BOLD}  Core Tools${RESET}"
echo ""

check "git" "git" "https://git-scm.com/downloads"
check "tmux" "tmux" "brew install tmux (macOS) / apt install tmux (Linux)"
check "VS Code CLI" "code" "Install VS Code and run: Shell Command: Install 'code' command in PATH"
check_hydra
check_gh_auth

check_agents

# ─── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}──────────────────────────────────────────────────${RESET}"

if [ "$errors" -gt 0 ]; then
  echo ""
  echo -e "  ${FAIL}  ${RED}${BOLD}${errors} issue(s) found.${RESET} Fix the items above and re-run this script."
  echo ""
  exit 1
else
  echo ""
  echo -e "  ${PASS}  ${GREEN}${BOLD}All checks passed!${RESET} You're ready to run the Hydra demo."
  if [ "$warnings" -gt 0 ]; then
    echo -e "      ${DIM}(${warnings} optional warning(s) — safe to ignore)${RESET}"
  fi
  echo ""
  exit 0
fi
