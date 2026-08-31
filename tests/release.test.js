import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const releaseSource = join(__dirname, '..', 'scripts', 'release.js');
const fixtures = [];

function writeVersions(root, version) {
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version }, null, 2));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture',
        version,
        type: 'module',
        scripts: {
          test: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"'
        }
      },
      null,
      2
    )
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'fixture',
        version,
        lockfileVersion: 3,
        packages: { '': { name: 'fixture', version } }
      },
      null,
      2
    )
  );
}

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bookmark-release-'));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(releaseSource, join(root, 'scripts', 'release.js'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'release-test@example.com']);
  git(root, ['config', 'user.name', 'Release Test']);
  return root;
}

function runRelease(root, args) {
  return spawnSync(process.execPath, ['scripts/release.js', ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop(), { recursive: true, force: true });
});

describe('发布版本校验', () => {
  it('在没有本地或远端发布 tag 时可以创建首个 v1.0.0 发布', () => {
    const root = createFixture();
    const remote = mkdtempSync(join(tmpdir(), 'bookmark-release-remote-'));
    fixtures.push(remote);

    writeVersions(root, '0.1.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['branch', '-M', 'main']);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-u', 'origin', 'main']);

    const release = runRelease(root, ['1.0.0', '--push', '--yes']);
    const check = runRelease(root, ['--check']);

    expect(release.status, release.stdout + release.stderr).toBe(0);
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(execFileSync('git', ['cat-file', '-t', 'refs/tags/v1.0.0'], { cwd: root, encoding: 'utf8' }).trim())
      .toBe('tag');
    expect(execFileSync('git', ['--git-dir', remote, 'cat-file', '-t', 'refs/tags/v1.0.0'], { encoding: 'utf8' }).trim())
      .toBe('tag');
  });

  it('将所有版本字段提交后再创建指向 HEAD 的 tag', () => {
    const root = createFixture();
    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);

    const release = runRelease(root, ['1.1.0', '--yes']);
    const check = runRelease(root, ['--check']);

    expect(release.status, release.stdout + release.stderr).toBe(0);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('最新本地 tag v1.1.0');
    expect(check.stdout).toContain('tag 内版本正确');
  });

  it('拒绝 tag 名与 tag 内版本不一致的历史发布', () => {
    const root = createFixture();
    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['tag', '-a', 'v1.1.0', '-m', 'incorrect tag', 'HEAD']);

    writeVersions(root, '1.1.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'release v1.1.0']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('v1.1.0 内版本不一致');
    expect(result.stdout).not.toContain('暂无 git tag');
  });

  it('校验 package-lock 的顶层与根包版本', () => {
    const root = createFixture();
    writeVersions(root, '1.1.0');
    const lockPath = join(root, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.packages[''].version = '1.0.0';
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'inconsistent lock']);
    git(root, ['tag', '-a', 'v1.1.0', '-m', 'inconsistent lock', 'HEAD']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('packageLockRoot=1.0.0');
  });

  it('拒绝超过 Chrome 上限的版本段', () => {
    const root = createFixture();

    const result = runRelease(root, ['1.65536.0', '--yes']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('每段整数范围为 0 到 65535');
  });

  it('拒绝 Chrome 不允许的 0.0.0 版本', () => {
    const root = createFixture();

    const result = runRelease(root, ['0.0.0', '--yes']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('不能为 0.0.0');
  });

  it('拒绝 lightweight tag', () => {
    const root = createFixture();
    writeVersions(root, '1.1.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'lightweight tag']);
    git(root, ['tag', 'v1.1.0']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('v1.1.0 必须是 annotated tag');
  });

  it('发现远端存在本地缺失的更高发布 tag', () => {
    const root = createFixture();
    const remote = mkdtempSync(join(tmpdir(), 'bookmark-release-remote-'));
    const publisher = mkdtempSync(join(tmpdir(), 'bookmark-release-publisher-'));
    fixtures.push(remote, publisher);

    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['branch', '-M', 'main']);
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-u', 'origin', 'main']);
    git(root, ['push', 'origin', 'v1.0.0']);

    execFileSync('git', ['clone', remote, publisher], { stdio: 'pipe' });
    git(publisher, ['checkout', '-b', 'main', 'origin/main']);
    git(publisher, ['config', 'user.email', 'release-test@example.com']);
    git(publisher, ['config', 'user.name', 'Release Test']);
    writeVersions(publisher, '1.1.0');
    git(publisher, ['add', '-A']);
    git(publisher, ['commit', '-m', 'release v1.1.0']);
    git(publisher, ['tag', '-a', 'v1.1.0', '-m', 'v1.1.0', 'HEAD']);
    git(publisher, ['push', 'origin', 'main']);
    git(publisher, ['push', 'origin', 'v1.1.0']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('远端最新 tag v1.1.0 高于本地 v1.0.0');
  });

  it('拒绝与本地同名但指向不同提交的远端 tag', () => {
    const root = createFixture();
    const remote = mkdtempSync(join(tmpdir(), 'bookmark-release-remote-'));
    const publisher = mkdtempSync(join(tmpdir(), 'bookmark-release-publisher-'));
    fixtures.push(remote, publisher);

    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['branch', '-M', 'main']);
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-u', 'origin', 'main']);

    execFileSync('git', ['clone', remote, publisher], { stdio: 'pipe' });
    git(publisher, ['checkout', '-b', 'main', 'origin/main']);
    git(publisher, ['config', 'user.email', 'release-test@example.com']);
    git(publisher, ['config', 'user.name', 'Release Test']);
    writeFileSync(join(publisher, 'release-note.txt'), 'remote tag points here\n');
    git(publisher, ['add', '-A']);
    git(publisher, ['commit', '-m', 'different release commit']);
    git(publisher, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);
    git(publisher, ['push', 'origin', 'v1.0.0']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('远端 v1.0.0 指向校验失败');
  });

  it('拒绝远端最新的无效发布 tag，但历史异常 tag 仅告警', () => {
    const root = createFixture();
    const remote = mkdtempSync(join(tmpdir(), 'bookmark-release-remote-'));
    const publisher = mkdtempSync(join(tmpdir(), 'bookmark-release-publisher-'));
    fixtures.push(remote, publisher);

    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['branch', '-M', 'main']);
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-u', 'origin', 'main']);

    execFileSync('git', ['clone', remote, publisher], { stdio: 'pipe' });
    git(publisher, ['checkout', '-b', 'main', 'origin/main']);
    git(publisher, ['config', 'user.email', 'release-test@example.com']);
    git(publisher, ['config', 'user.name', 'Release Test']);
    git(publisher, ['tag', '-a', '1.0.0', '-m', '1.0.0', 'HEAD']);
    git(publisher, ['tag', 'v1.1.0']);
    git(publisher, ['push', 'origin', '1.0.0']);
    git(publisher, ['push', 'origin', 'v1.1.0']);

    const result = runRelease(root, ['--check']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('历史远端 tag 异常，不阻止更高版本发布：远端发布 tag 1.0.0 必须使用 vX.Y.Z 格式');
    expect(result.stdout).toContain('远端发布 tag v1.1.0 必须是 annotated tag');
  });

  it('仅在显式确认历史异常后，允许在较低的 lightweight tag 之后发布更高版本', () => {
    const root = createFixture();
    const remote = mkdtempSync(join(tmpdir(), 'bookmark-release-remote-'));
    const publisher = mkdtempSync(join(tmpdir(), 'bookmark-release-publisher-'));
    fixtures.push(remote, publisher);

    writeVersions(root, '1.0.0');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'initial']);
    git(root, ['branch', '-M', 'main']);
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', 'HEAD']);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '-u', 'origin', 'main']);
    git(root, ['push', 'origin', 'v1.0.0']);

    execFileSync('git', ['clone', remote, publisher], { stdio: 'pipe' });
    git(publisher, ['checkout', '-b', 'main', 'origin/main']);
    git(publisher, ['tag', 'v1.1.0']);
    git(publisher, ['push', 'origin', 'v1.1.0']);

    const blocked = runRelease(root, ['1.1.1', '--push', '--yes']);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain('--allow-legacy-invalid-tags');

    const result = runRelease(root, ['1.1.1', '--push', '--yes', '--allow-legacy-invalid-tags']);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(execFileSync('git', ['cat-file', '-t', 'refs/tags/v1.1.1'], { cwd: root, encoding: 'utf8' }).trim())
      .toBe('tag');
    expect(execFileSync('git', ['--git-dir', remote, 'cat-file', '-t', 'refs/tags/v1.1.1'], { encoding: 'utf8' }).trim())
      .toBe('tag');
    const check = runRelease(root, ['--check']);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('历史远端 tag 异常，不阻止更高版本发布');
  });
});

describe('跨设备分发文档', () => {
  it('提供商店身份记录并禁止将开发密钥写入生产 manifest', () => {
    const root = join(__dirname, '..');
    const runbook = readFileSync(join(root, 'docs', 'release', 'chrome-web-store.md'), 'utf8');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

    expect(runbook).toContain('Chrome Web Store 条目 URL：');
    expect(runbook).toContain('生产扩展 ID：');
    expect(runbook).toContain('extension-private.pem');
    expect(readme).toContain('Chrome Web Store');
    expect(security).toContain('扩展私钥');
    expect(manifest).not.toHaveProperty('key');
  });
});
