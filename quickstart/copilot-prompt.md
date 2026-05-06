You are the copilot for Hydra's isolated quickstart demo.

Operate from the current working directory. Do not ask follow-up questions unless blocked by a real error. Keep the run self-contained and local-only: do not use GitHub, `gh`, or any network repo hosting.

Goal:

1. Create a bare local remote at `./hydra-demo-origin.git`.
2. Create a working repository at `./hydra-demo`.
3. Scaffold a tiny TypeScript calculator project in `./hydra-demo`.
4. Commit and push `main` to the local bare remote.
5. Spawn 3 Hydra workers with agent `__AGENT__` against `./hydra-demo`.
6. Monitor them, review obvious problems, and nudge them if needed.
7. Finish by printing a concise status summary in this copilot session.

Repository scaffold requirements:

- `package.json` with `commander`, `typescript`, and `vitest`
- `tsconfig.json` with a minimal strict NodeNext TypeScript setup
- `src/calculator.ts` exporting:
  - `type CalcOperation = 'add' | 'subtract' | 'multiply' | 'divide'`
  - `add`, `subtract`, `multiply`, `divide`
  - `calculate(op, a, b)`
- `src/index.ts` re-exporting from `./calculator.js`
- `.gitignore` for `dist` and `node_modules`
- `README.md` explaining that this repo is the quickstart sandbox demo

Important constraints:

- Keep everything inside the current directory tree.
- Use the local bare repo as `origin`.
- Do not touch the parent Hydra repository.
- Use `hydra worker create --repo ./hydra-demo --branch <name> --agent __AGENT__ ...`.
- Use one branch per worker.
- Monitor with `hydra worker logs`.
- Review with `git -C <workdir> diff`.
- If a worker makes a bad choice, correct it with `hydra worker send`.
- Do not clean up the workers automatically; leave them available for inspection.

Worker plan:

1. `feat/core`
Task:
Implement the calculator core in `src/calculator.ts`.
Requirements:
- implement `add`, `subtract`, `multiply`, `divide`
- `divide` must throw an `Error` on division by zero
- implement `calculate(op, a, b)` as the dispatcher
- keep the branch focused on the calculator core
- run `npm run build`
- commit with `feat: implement calculator core`
- push with `git push -u origin feat/core`

2. `feat/cli`
Task:
Create `src/cli.ts` using `commander`.
Requirements:
- add a `#!/usr/bin/env node` shebang
- expose `calc <operation> <a> <b>`
- import from `./calculator.js`
- support `add`, `subtract`, `multiply`, `divide`
- print the result to stdout
- print errors to stderr and exit 1
- run `npm run build`
- commit with `feat: add calculator cli`
- push with `git push -u origin feat/cli`

3. `feat/tests`
Task:
Create `src/calculator.test.ts` with Vitest coverage.
Requirements:
- test `add`, `subtract`, `multiply`, `divide`
- test division by zero
- test the `calculate` dispatcher
- include negative numbers, zero, and decimals
- include at least 12 assertions total
- commit with `test: add calculator coverage`
- push with `git push -u origin feat/tests`

Execution notes:

- After scaffolding the repo, run `npm install --no-fund --no-audit`.
- Commit the scaffold on `main` before creating workers.
- Let the workers do the implementation work. Do not manually do their tasks in the copilot unless recovery is necessary.
- Wait until all 3 worker branches are pushed to the local `origin`.
- End with:
  - the repo path
  - the worker session names
  - which branches were pushed
  - any branch that still needs attention
