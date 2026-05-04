#!/usr/bin/env bash
# Generate release notes from git history and prepend to CHANGELOG.md
#
# Usage:
#   scripts/release-notes.sh [<prev-tag> <new-tag>]
#
# If no arguments given, computes:
#   prev-tag = second most recent tag (by creator date)
#   new-tag  = most recent tag (by creator date)
#
# Output: writes to stdout AND prepends to CHANGELOG.md (if it exists)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHANGELOG="$REPO_ROOT/CHANGELOG.md"

# --- Resolve tags -----------------------------------------------------------

if [ $# -ge 2 ]; then
  PREV_TAG="$1"
  NEW_TAG="$2"
elif [ $# -eq 1 ]; then
  NEW_TAG="$1"
  PREV_TAG=$(git tag --sort=-creatordate | grep -v "^${NEW_TAG}$" | head -1)
else
  NEW_TAG=$(git tag --sort=-creatordate | head -1)
  PREV_TAG=$(git tag --sort=-creatordate | sed -n '2p')
fi

if [ -z "$PREV_TAG" ] || [ -z "$NEW_TAG" ]; then
  echo "Error: could not determine tag range" >&2
  exit 1
fi

# --- Collect commits ---------------------------------------------------------

DATE=$(git log -1 --format=%ci "$NEW_TAG" | cut -d' ' -f1)
VERSION="${NEW_TAG#v}"  # strip leading 'v'

# Get commits between tags, excluding release commits
COMMITS=$(git log --oneline "$PREV_TAG".."$NEW_TAG" --no-merges | grep -v 'chore: release' || true)

if [ -z "$COMMITS" ]; then
  # Include merge commits if no non-merge commits found
  COMMITS=$(git log --oneline "$PREV_TAG".."$NEW_TAG" | grep -v 'chore: release' || true)
fi

if [ -z "$COMMITS" ]; then
  echo "No commits found between $PREV_TAG and $NEW_TAG" >&2
  exit 0
fi

# --- Classify commits --------------------------------------------------------

ADDED=""
CHANGED=""
FIXED=""
REMOVED=""
COMMIT_LIST=""
NUM=0

while IFS= read -r line; do
  [ -z "$line" ] && continue
  HASH=$(echo "$line" | awk '{print $1}')
  MSG=$(echo "$line" | cut -d' ' -f2-)
  NUM=$((NUM + 1))

  # Build numbered commit list
  COMMIT_LIST="${COMMIT_LIST}${NUM}. ${HASH} ${MSG}
"

  # Extract PR number if present — pattern: (#NN)
  PR=""
  if echo "$MSG" | grep -qE '\(#[0-9]+\)'; then
    PR=$(echo "$MSG" | grep -oE '\(#[0-9]+\)' | tail -1)
  fi

  # Format entry: use full message (already includes PR ref)
  ENTRY="- ${MSG}"

  # Classify by conventional commit prefix
  case "$MSG" in
    feat:*|feat\(*) ADDED="${ADDED}${ENTRY}
" ;;
    fix:*|fix\(*)   FIXED="${FIXED}${ENTRY}
" ;;
    revert:*|revert\(*) REMOVED="${REMOVED}${ENTRY}
" ;;
    *)               CHANGED="${CHANGED}${ENTRY}
" ;;
  esac
done <<< "$COMMITS"

# --- Build release section ---------------------------------------------------

build_section() {
  echo "## [${VERSION}] - ${DATE}"
  echo ""

  if [ -n "$ADDED" ]; then
    echo "### Added"
    printf '%s' "$ADDED"
    echo ""
  fi

  if [ -n "$CHANGED" ]; then
    echo "### Changed"
    printf '%s' "$CHANGED"
    echo ""
  fi

  if [ -n "$FIXED" ]; then
    echo "### Fixed"
    printf '%s' "$FIXED"
    echo ""
  fi

  if [ -n "$REMOVED" ]; then
    echo "### Removed"
    printf '%s' "$REMOVED"
    echo ""
  fi

  echo "### Commits"
  printf '%s' "$COMMIT_LIST"
}

SECTION=$(build_section)

# --- Output ------------------------------------------------------------------

# Print to stdout (for CI to capture as release body)
echo "$SECTION"

# --- Prepend to CHANGELOG.md ------------------------------------------------

if [ -f "$CHANGELOG" ]; then
  # Read existing content after the "# Changelog" header
  EXISTING=$(sed '1{/^# Changelog$/d;}' "$CHANGELOG" | sed '/./,$!d')

  {
    echo "# Changelog"
    echo ""
    echo "$SECTION"
    if [ -n "$EXISTING" ]; then
      echo ""
      echo "$EXISTING"
    fi
  } > "$CHANGELOG"
else
  {
    echo "# Changelog"
    echo ""
    echo "$SECTION"
  } > "$CHANGELOG"
fi

echo "" >&2
echo "Updated $CHANGELOG" >&2
