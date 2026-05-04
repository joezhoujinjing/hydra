---
name: release-hydra
description: Use when releasing a new version of Hydra. Bumps version, generates changelog from commits since last release, and commits the release.
---

# Skill: release-hydra

Release a new version of the Hydra VS Code extension.

## Steps

1. **Determine the current version and next version**

   ```bash
   node -p "require('./package.json').version"
   ```

   Bump the patch number (e.g., 0.1.27 → 0.1.28) unless the user specifies a different bump type (minor/major).

2. **Collect commits since last release**

   Find the last release tag:

   ```bash
   git tag --sort=-creatordate | head -1
   ```

   Then get all commits between that tag and HEAD, excluding release commits:

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

5. **Commit the release**

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release v<version>"
   ```

   Do NOT push or create tags — the CI workflow handles that on merge to main.

## Notes

- The publish workflow (`.github/workflows/publish.yml`) triggers on push to main and handles: tagging, VSIX packaging, Marketplace/Open VSX publishing, and GitHub Release creation.
- If the CI bumps the version again on its own (e.g., tag collision), that's fine — it will auto-increment past existing tags.
- Only run this skill from the repo root or a worktree of the hydra repo.
