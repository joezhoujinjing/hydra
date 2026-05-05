---
name: test-hydra
description: Use when you need to build and validate the Hydra extension. Compiles TypeScript, runs linting, and reports a pass/fail summary.
---

# Skill: test-hydra

Build and validate the Hydra VS Code extension by compiling and linting the codebase.

## Prerequisites

- Must be run from the repo root or a worktree of the hydra repo.
- Requires **Node.js 18+** and dependencies installed (`npm install`).

## Steps

1. **Compile the TypeScript source**

   ```bash
   npm run compile
   ```

   This runs `tsc -p ./` and the post-compile script. If compilation fails, report the TypeScript errors and stop.

2. **Run the linter**

   ```bash
   npm run lint
   ```

   This runs `eslint src --ext ts`. If linting fails, report the lint errors and stop.

3. **Report summary**

   Print a clear pass/fail summary:

   - If both steps succeed:
     ```
     --- Hydra Test Summary ---
     Compile: PASS
     Lint:    PASS
     Result:  ALL CHECKS PASSED
     ```

   - If any step fails, report which step failed and include the error output:
     ```
     --- Hydra Test Summary ---
     Compile: FAIL
     Lint:    SKIPPED
     Result:  CHECKS FAILED
     ```

## Notes

- There is currently no unit test suite configured in this project. When tests are added (e.g., `npm test`), this skill should be updated to include them.
- Fix any errors found before committing code.
- Only run this skill from the repo root or a worktree of the hydra repo.
