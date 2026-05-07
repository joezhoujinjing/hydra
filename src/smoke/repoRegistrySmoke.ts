import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addRepo,
  fetchRepo,
  isRegisteredRepo,
  isRegistryManagedPath,
  listRegisteredRepos,
  parseRepoIdentifier,
  removeRepo,
  resolveRepoIdentifier,
} from '../core/repoRegistry';

interface SubTest {
  name: string;
  run: () => Promise<void> | void;
}

const tests: SubTest[] = [];
function test(name: string, run: () => Promise<void> | void): void {
  tests.push({ name, run });
}

function setupHydraHome(): { tempHome: string; cleanup: () => void; restore: Record<string, string | undefined> } {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-repo-registry-'));
  const restore: Record<string, string | undefined> = {
    HYDRA_HOME: process.env.HYDRA_HOME,
    HYDRA_CONFIG_PATH: process.env.HYDRA_CONFIG_PATH,
    HOME: process.env.HOME,
  };
  process.env.HYDRA_HOME = path.join(tempHome, '.hydra');
  process.env.HYDRA_CONFIG_PATH = path.join(tempHome, '.hydra', 'config.json');
  process.env.HOME = tempHome;
  return {
    tempHome,
    restore,
    cleanup: () => {
      try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
      for (const [k, v] of Object.entries(restore)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

/** Build a tiny bare-cloneable git repo on disk and return its filesystem URL. */
function makeFakeGitOrigin(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-fake-origin-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git -c user.email=hydra@test.local -c user.name=hydra commit -q --allow-empty -m init', { cwd: dir });
  return {
    dir,
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

// ── parseRepoIdentifier: all 4 input formats normalize correctly ──

test('parseRepoIdentifier: short-form <owner>/<name>', () => {
  const p = parseRepoIdentifier('joezhoujinjing/hydra');
  assert.equal(p.owner, 'joezhoujinjing');
  assert.equal(p.name, 'hydra');
  assert.equal(p.canonical, 'joezhoujinjing/hydra');
  assert.equal(p.cloneUrl, 'https://github.com/joezhoujinjing/hydra.git');
});

test('parseRepoIdentifier: https URL without .git', () => {
  const p = parseRepoIdentifier('https://github.com/joezhoujinjing/hydra');
  assert.equal(p.canonical, 'joezhoujinjing/hydra');
});

test('parseRepoIdentifier: https URL with .git', () => {
  const p = parseRepoIdentifier('https://github.com/joezhoujinjing/hydra.git');
  assert.equal(p.canonical, 'joezhoujinjing/hydra');
});

test('parseRepoIdentifier: SSH URL', () => {
  const p = parseRepoIdentifier('git@github.com:joezhoujinjing/hydra.git');
  assert.equal(p.canonical, 'joezhoujinjing/hydra');
});

test('parseRepoIdentifier: rejects empty input', () => {
  assert.throws(() => parseRepoIdentifier(''), /required/i);
});

test('parseRepoIdentifier: rejects non-GitHub URL', () => {
  assert.throws(() => parseRepoIdentifier('https://gitlab.com/joezhoujinjing/hydra'), /Could not parse/i);
});

test('parseRepoIdentifier: rejects malformed input', () => {
  assert.throws(() => parseRepoIdentifier('not a repo'), /Could not parse/i);
  assert.throws(() => parseRepoIdentifier('foo/bar/baz'), /Could not parse/i);
});

// ── resolveRepoIdentifier ──

test('resolveRepoIdentifier: absolute path passes through unchanged', () => {
  const env = setupHydraHome();
  try {
    const abs = path.resolve('/tmp/fake-repo');
    assert.equal(resolveRepoIdentifier(abs), abs);
  } finally {
    env.cleanup();
  }
});

test('resolveRepoIdentifier: short-form throws when not registered', () => {
  const env = setupHydraHome();
  try {
    assert.throws(
      () => resolveRepoIdentifier('joezhoujinjing/hydra'),
      /not registered.*hydra repo add/,
    );
  } finally {
    env.cleanup();
  }
});

test('resolveRepoIdentifier: URL throws with helpful message', () => {
  const env = setupHydraHome();
  try {
    assert.throws(
      () => resolveRepoIdentifier('https://github.com/joezhoujinjing/hydra'),
      /hydra repo add/,
    );
  } finally {
    env.cleanup();
  }
});

// ── addRepo / listRegisteredRepos / fetchRepo / removeRepo ──

test('addRepo: clones, lists, refetches, and is idempotent', async () => {
  const env = setupHydraHome();
  const origin = makeFakeGitOrigin();
  try {
    // Use the URL directly so we can verify clone success without hitting the network.
    // parseRepoIdentifier rejects file:// URLs, so register manually using the lower-level helpers
    // by spoofing as fake/local.
    const fakeOwner = 'fake';
    const fakeName = 'local';
    const reposRoot = path.join(process.env.HYDRA_HOME!, 'repos');
    const repoPath = path.join(reposRoot, fakeOwner, fakeName);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    execSync(`git clone -q "${origin.dir}" "${repoPath}"`);

    assert.ok(isRegisteredRepo(fakeOwner, fakeName), 'repo should be registered after manual clone');
    assert.equal(resolveRepoIdentifier(`${fakeOwner}/${fakeName}`), repoPath);

    const repos = listRegisteredRepos();
    assert.equal(repos.length, 1);
    assert.equal(repos[0].canonical, `${fakeOwner}/${fakeName}`);

    // addRepo on an already-cloned repo is a no-op (returns alreadyExisted=true).
    // We can't reach the GitHub URL parser path with a file:// origin, so test
    // idempotency via the lower-level entry point.
    const result = await addRepo(`${fakeOwner}/${fakeName}`).catch(err => err);
    // addRepo would attempt to clone from https://github.com/fake/local.git, which
    // doesn't exist — but only if not already-existed. Since the dir exists, it
    // must short-circuit to alreadyExisted=true without touching the network.
    if (result instanceof Error) {
      throw new Error(`addRepo should be idempotent for existing clone, got: ${result.message}`);
    }
    assert.equal(result.alreadyExisted, true);
    assert.equal(result.path, repoPath);

    // fetchRepo against the file:// origin (was set as origin during clone).
    await fetchRepo(fakeOwner, fakeName);

    // After fetch, FETCH_HEAD exists.
    const refreshed = listRegisteredRepos();
    assert.equal(refreshed[0].lastFetchedAt !== null, true, 'lastFetchedAt should be set after fetch');

    // removeRepo without force: clone is bare clone with only the main worktree, so it succeeds.
    await removeRepo(`${fakeOwner}/${fakeName}`, { force: true });
    assert.equal(isRegisteredRepo(fakeOwner, fakeName), false);
  } finally {
    origin.cleanup();
    env.cleanup();
  }
});

test('removeRepo: refuses when worktrees exist (no --force)', async () => {
  const env = setupHydraHome();
  const origin = makeFakeGitOrigin();
  try {
    const fakeOwner = 'fake';
    const fakeName = 'with-worktree';
    const reposRoot = path.join(process.env.HYDRA_HOME!, 'repos');
    const repoPath = path.join(reposRoot, fakeOwner, fakeName);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    execSync(`git clone -q "${origin.dir}" "${repoPath}"`);

    // Create a worktree off the managed clone
    const worktreePath = path.join(env.tempHome, 'extra-worktree');
    execSync(`git -C "${repoPath}" worktree add -b feat/test "${worktreePath}"`);

    await assert.rejects(
      removeRepo(`${fakeOwner}/${fakeName}`),
      /still has active worktrees/,
    );

    // --force succeeds even with worktrees.
    await removeRepo(`${fakeOwner}/${fakeName}`, { force: true });
    assert.equal(isRegisteredRepo(fakeOwner, fakeName), false);
  } finally {
    origin.cleanup();
    env.cleanup();
  }
});

test('isRegistryManagedPath: classifies paths under ~/.hydra/repos/', () => {
  const env = setupHydraHome();
  try {
    const reposRoot = path.join(process.env.HYDRA_HOME!, 'repos');
    assert.equal(isRegistryManagedPath(path.join(reposRoot, 'fake', 'local')), true);
    assert.equal(isRegistryManagedPath('/tmp/some-other-path'), false);
  } finally {
    env.cleanup();
  }
});

// ── Optional end-to-end smoke against the real GitHub: SMOKE_REPO_REGISTRY=1 ──

if (process.env.SMOKE_REPO_REGISTRY) {
  test('SMOKE: addRepo against real GitHub', async () => {
    const env = setupHydraHome();
    try {
      const result = await addRepo('joezhoujinjing/ladon');
      assert.equal(result.alreadyExisted, false);
      assert.ok(fs.existsSync(path.join(result.path, '.git')));
      const second = await addRepo('joezhoujinjing/ladon');
      assert.equal(second.alreadyExisted, true);
      await removeRepo('joezhoujinjing/ladon', { force: true });
    } finally {
      env.cleanup();
    }
  });
}

// ── Runner ──

async function main(): Promise<void> {
  const failures: string[] = [];
  for (const t of tests) {
    try {
      await t.run();
      console.log(`  ok  ${t.name}`);
    } catch (error) {
      failures.push(`${t.name}: ${(error as Error).message}`);
      console.error(`  FAIL  ${t.name}: ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures.length}/${tests.length} passed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
