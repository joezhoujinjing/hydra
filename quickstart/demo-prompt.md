# Hydra Demo — Autonomous Copilot Prompt

Paste this entire prompt into your Copilot terminal to start the demo.

---

You are orchestrating a demo of Hydra's parallel worker capabilities. Execute the following plan autonomously, step by step. Do not ask for confirmation — just do it.

## Phase 1: Create the demo repository

```bash
gh repo create hydra-demo --private --clone
cd hydra-demo
```

## Phase 2: Scaffold the TypeScript project

Create the following files:

**package.json:**
```json
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
```

**tsconfig.json:**
```json
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
```

**src/index.ts:**
```typescript
// Calculator core — to be implemented by feat/core worker
export function placeholder() {
  return "Hydra demo scaffold";
}
```

Then commit and push:
```bash
git add -A
git commit -m "chore: initial project scaffold"
git push -u origin main
```

## Phase 3: Spawn parallel workers

Use the `hydra` CLI to create three workers. The repo path is the current directory.

### Worker 1: feat/core
```bash
hydra worker create --repo . --branch feat/core --task "Implement a calculator module in src/calculator.ts. Export functions: add(a, b), subtract(a, b), multiply(a, b), divide(a, b). The divide function should throw an error on division by zero. Also export a type CalcOperation = 'add' | 'subtract' | 'multiply' | 'divide' and a calculate(op, a, b) dispatcher function. Use proper TypeScript types. When done, commit all changes, push the branch, and create a PR with: gh pr create --title 'feat: calculator core functions' --body 'Implements add, subtract, multiply, divide with type-safe dispatcher.'"
```

### Worker 2: feat/cli
```bash
hydra worker create --repo . --branch feat/cli --task "Build a CLI interface in src/cli.ts using the commander package. The CLI should accept: calc <operation> <a> <b> where operation is add|subtract|multiply|divide. Import the calculator functions from ./calculator.ts (assume they will exist with exports: add, subtract, multiply, divide, calculate). Add a shebang line. Handle errors gracefully (print error message and exit 1). When done, commit all changes, push the branch, and create a PR with: gh pr create --title 'feat: CLI interface with Commander.js' --body 'Adds calc command supporting add/subtract/multiply/divide operations.'"
```

### Worker 3: feat/tests
```bash
hydra worker create --repo . --branch feat/tests --task "Write comprehensive Vitest tests in src/calculator.test.ts. Test all calculator operations: add, subtract, multiply, divide (including division by zero error). Also test the calculate dispatcher function with all operation types. Include edge cases: negative numbers, zero, large numbers, floating point. Aim for at least 10 test cases organized in describe blocks. When done, commit all changes, push the branch, and create a PR with: gh pr create --title 'feat: comprehensive Vitest test suite' --body 'Adds test coverage for all calculator operations including edge cases.'"
```

## Phase 4: Monitor progress

Wait 30 seconds, then check worker status:
```bash
hydra list --json
```

Check each worker's logs to track progress:
```bash
hydra worker logs <session-1> --lines 20
hydra worker logs <session-2> --lines 20
hydra worker logs <session-3> --lines 20
```

Repeat monitoring every 60 seconds until all workers show completion or have pushed their branches.

## Phase 5: Report completion

Once all workers have finished, report:
```bash
echo "=== Hydra Demo Complete ==="
gh pr list --repo hydra-demo --state open
echo ""
echo "All workers have finished. Check the PRs above to review their work."
hydra list --json
```

---

**Remember:** Execute everything autonomously. Do not pause for confirmation. If a step fails, diagnose and retry once, then move on.
