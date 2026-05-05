---
name: test-hydra
description: Use when you need to test the Hydra extension. Compiles and launches a VS Code Extension Development Host so the user can manually test the extension.
---

# Skill: test-hydra

Launch the Hydra VS Code extension in a Development Host for manual testing.

## Prerequisites

- Must be run from the repo root or a worktree of the hydra repo.
- Requires **Node.js 18+**, **VS Code** (`code` CLI on PATH), and dependencies installed (`npm install`).

## Steps

1. **Compile the extension**

   ```bash
   npm run compile
   ```

   If compilation fails, report the errors and stop.

2. **Ensure a test workspace exists**

   ```bash
   mkdir -p /tmp/hydra-test
   ```

3. **Launch the Extension Development Host**

   Resolve the absolute path to the repo or worktree, then open VS Code in extension development mode:

   ```bash
   code --extensionDevelopmentPath="<absolute-path-to-repo-or-worktree>" /tmp/hydra-test
   ```

   This opens a new VS Code window with the locally-compiled Hydra extension loaded.

4. **Inform the user**

   Tell the user the Extension Development Host is running and they can test the extension in the new VS Code window.

## Notes

- The test workspace (`/tmp/hydra-test`) is a throwaway directory — safe to reuse or delete.
- Only run this skill from the repo root or a worktree of the hydra repo.
