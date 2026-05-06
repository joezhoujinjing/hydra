---
name: release-hydra
description: Use when releasing a new version of Hydra. Bumps version, generates changelog, and creates a release PR.
---

# Skill: release-hydra

Release a new version of the Hydra VS Code extension by creating a release PR.

## Prerequisites

- Must be run from a branch off `main` (e.g., `release/<version>`), NOT directly on `main`.
- If not already on a release branch, create one first: `git checkout -b release/<version>`

## Steps

1. **Determine the current version and next version**

   ```bash
   node -p "require('./package.json').version"
   ```

   Hydra uses the format `0.<minor>.<yyyymmddNN>`:
   - The **second digit** is the major small-release version. Bump it only when the user requests a "major small release" or when there is a schema/breaking change.
   - The **patch** is `<yyyymmdd><NN>` — today's UTC date followed by a 2-digit in-day counter. `NN` starts at `00` for the first release of the day and increments for each subsequent release that same day.

   Compute the next patch:

   ```bash
   TODAY=$(date -u +%Y%m%d)
   CURRENT=$(node -p "require('./package.json').version")
   CURRENT_MINOR=$(echo "$CURRENT" | cut -d. -f2)
   CURRENT_PATCH=$(echo "$CURRENT" | cut -d. -f3)
   # If today's date matches the current patch's date prefix AND the minor is unchanged,
   # increment the counter; otherwise reset to 00.
   if [ "${CURRENT_PATCH:0:8}" = "$TODAY" ] && [ "$CURRENT_MINOR" = "<target-minor>" ]; then
     NN=$(printf "%02d" $((10#${CURRENT_PATCH:8:2} + 1)))
   else
     NN="00"
   fi
   echo "0.<target-minor>.${TODAY}${NN}"
   ```

   Default behavior: keep the current minor, set patch as above. If the user asks for a "major small release" bump (or this release contains a schema/breaking change), increment the minor and reset `NN` to `00`.

   Note: the `0.2.x` line was the last to use a sequential patch counter. The first release on the date scheme jumped to `0.3.<yyyymmdd>00`.

2. **Collect commits since last release**

   Find the last release tag:

   ```bash
   git tag --sort=-creatordate | head -1
   ```

   Then get all commits between that tag and HEAD on `main`, excluding release commits:

   ```bash
   git log --oneline <last-tag>..HEAD --no-merges | grep -v 'chore: release'
   ```

3. **Generate high-level changelog entry**

   Write a concise changelog entry under `## [<version>] - <date>`. Keep it high-level:
   - Summarize changes into categories: Added, Changed, Fixed, Removed
   - Use conventional commit prefixes to classify: `feat:` → Added, `fix:` → Fixed, `revert:` → Removed, everything else → Changed
   - One bullet per logical change (collapse related commits into a single bullet)
   - Do NOT include a per-commit list — keep it brief and user-facing

   Prepend the new section to `CHANGELOG.md` after the `# Changelog` header.

4. **Bump version in all files**

   Update the version string in:
   - `package.json` (`"version"` field)
   - `package-lock.json` (both root `"version"` and `packages[""].version`)

5. **Commit and create release PR**

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release v<version>"
   git push -u origin HEAD
   ```

   Then create a PR targeting `main`:

   ```bash
   gh pr create --title "chore: release v<version>" --body "Release v<version>" --base main
   ```

   When the PR is merged, the `auto-tag-release.yml` workflow detects the version bump in `package.json` and automatically creates + pushes the `v<version>` tag, which in turn triggers the publish workflow.

## Notes

- **Do NOT create or push tags manually.** The `auto-tag-release.yml` workflow handles tagging automatically when the version bump lands on `main`.
- The publish workflow (`.github/workflows/publish.yml`) triggers on `v*` tags and handles: VSIX packaging, Marketplace/Open VSX publishing, and GitHub Release creation.
- Full release pipeline: PR merged → auto-tag detects version bump → creates `v<version>` tag → publish workflow runs.
- Only run this skill from the repo root or a worktree of the hydra repo.
