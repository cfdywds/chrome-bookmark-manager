#!/usr/bin/env node
/**
 * 交互式发布向导：npm run release [版本号] [--push] [--yes] [--allow-legacy-invalid-tags]
 *
 * 未提供版本号时会交互询问；--yes 需同时提供版本号。
 * 发布前执行 diff、单测和 lint，提交后只给 HEAD 打 annotated tag，并校验 tag 内版本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const args = process.argv.slice(2);
const suppliedVersion = (args.find(arg => !arg.startsWith('-')) || '').trim();
const skipPrompts = args.includes('--yes');
const requestedPush = args.includes('--push');
const allowLegacyInvalidTags = args.includes('--allow-legacy-invalid-tags');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let releaseProgress = { stage: 'preflight', branch: '', tag: '' };

function print(kind, message) {
  const color = kind === 'ok' ? '\x1b[32m' : kind === 'warn' ? '\x1b[33m' : '\x1b[31m';
  console.log(color + message + '\x1b[0m');
}

function fail(message) {
  throw new Error(message);
}

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options && options.inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command)
  });
  if (result.error) fail(command + ' 无法执行：' + result.error.message);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(command + ' ' + commandArgs.join(' ') + ' 失败' + (detail ? '：' + detail : ''));
  }
  return String(result.stdout || '').trim();
}

function tryRun(command, commandArgs) {
  try {
    return run(command, commandArgs);
  } catch (e) {
    return null;
  }
}

function git(commandArgs, options) {
  return run('git', commandArgs, options);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function normalizeTagVersion(tag) {
  return String(tag || '').replace(/^v/i, '');
}

function isReleaseVersion(version) {
  const segments = String(version || '').split('.');
  return (
    segments.length === 3 &&
    segments.every(segment => /^(0|[1-9]\d*)$/.test(segment) && Number(segment) <= 65535) &&
    segments.some(segment => Number(segment) > 0)
  );
}

function assertReleaseVersion(version) {
  if (!isReleaseVersion(version)) {
    fail('版本号必须是 x.y.z 纯数字格式，每段整数范围为 0 到 65535，且不能为 0.0.0');
  }
}

function compareVersions(left, right) {
  const a = normalizeTagVersion(left).split('.').map(Number);
  const b = normalizeTagVersion(right).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function listReleaseTags() {
  return git(['tag', '--list'])
    .split(/\r?\n/)
    .map(tag => tag.trim())
    .filter(tag => /^v/.test(tag) && isReleaseVersion(normalizeTagVersion(tag)));
}

function listUnprefixedReleaseTags() {
  return git(['tag', '--list'])
    .split(/\r?\n/)
    .map(tag => tag.trim())
    .filter(tag => isReleaseVersion(tag));
}

function latestReleaseTag() {
  return listReleaseTags().sort((a, b) => compareVersions(b, a))[0] || '';
}

function listRemoteReleaseTagRecords() {
  if (!tryRun('git', ['remote', 'get-url', 'origin'])) return null;
  const tags = new Map();
  git(['ls-remote', '--tags', 'origin'])
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach(line => {
      const ref = line.trim().split(/\s+/)[1] || '';
      const annotated = /\^\{\}$/.test(ref);
      const tag = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
      if (!isReleaseVersion(normalizeTagVersion(tag))) return;
      const record = tags.get(tag) || { tag, annotated: false };
      record.annotated ||= annotated;
      tags.set(tag, record);
    });
  return [...tags.values()];
}

function isValidRemoteReleaseTag(record) {
  return /^v/.test(record.tag) && record.annotated;
}

function remoteTagProblem(record) {
  if (!/^v/.test(record.tag)) return '远端发布 tag ' + record.tag + ' 必须使用 vX.Y.Z 格式';
  return '远端发布 tag ' + record.tag + ' 必须是 annotated tag';
}

function latestRemoteReleaseRecord(records) {
  const tag = latestTag(records.map(record => record.tag));
  return records.find(record => record.tag === tag) || null;
}

function latestTag(tags) {
  return [...tags].sort((a, b) => compareVersions(b, a))[0] || '';
}

function tagExists(tag) {
  return !!tryRun('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag]);
}

function tagCommit(tag) {
  return git(['rev-parse', tag + '^{commit}']);
}

function assertAnnotatedTag(tag) {
  if (git(['cat-file', '-t', 'refs/tags/' + tag]) !== 'tag') {
    fail(tag + ' 必须是 annotated tag；请使用 git tag -a 创建');
  }
}

function versionAt(ref, fileName) {
  return JSON.parse(git(['show', ref + ':' + fileName])).version;
}

function currentVersions() {
  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  const lock = readJson(lockPath);
  return {
    manifest: manifest.version,
    package: pkg.version,
    packageLock: lock.version,
    packageLockRoot: lock.packages && lock.packages[''] && lock.packages[''].version
  };
}

function setVersions(version) {
  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  const lock = readJson(lockPath);
  if (!lock.packages || !lock.packages['']) {
    fail('package-lock.json 缺少 packages[""] 版本字段，无法安全发布');
  }
  manifest.version = version;
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  writeJson(manifestPath, manifest);
  writeJson(packagePath, pkg);
  writeJson(lockPath, lock);
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question) {
  if (skipPrompts) return true;
  return /^y(es)?$/i.test(await ask(question + '（y/N）'));
}

async function selectVersion() {
  if (suppliedVersion) {
    assertReleaseVersion(suppliedVersion);
    return suppliedVersion;
  }
  if (skipPrompts) fail('--yes 必须同时提供版本号，例如：npm run release -- 1.0.1 --yes');
  const answer = await ask('请输入发布版本号（x.y.z）：');
  assertReleaseVersion(answer);
  return answer;
}

function verifyTag(tag, expectedVersion, expectedCommit) {
  assertAnnotatedTag(tag);
  const commit = tagCommit(tag);
  const lock = JSON.parse(git(['show', tag + ':package-lock.json']));
  const versions = {
    manifest: versionAt(tag, 'manifest.json'),
    package: versionAt(tag, 'package.json'),
    packageLock: lock.version,
    packageLockRoot: lock.packages && lock.packages[''] && lock.packages[''].version
  };
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== expectedVersion)
    .map(([name, version]) => name + '=' + version);
  if (mismatches.length) {
    fail(tag + ' 内版本不一致，期望 ' + expectedVersion + '，实际 ' + mismatches.join('，'));
  }
  if (expectedCommit && commit !== expectedCommit) {
    fail(tag + ' 指向 ' + commit + '，期望 ' + expectedCommit);
  }
  return commit;
}

function githubReleaseUrl(tag) {
  const origin = tryRun('git', ['remote', 'get-url', 'origin']) || '';
  const match = origin.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match ? 'https://github.com/' + match[1] + '/releases/new?tag=' + tag : '';
}

function checkReleaseState() {
  const errors = [];
  const versions = currentVersions();
  const invalidVersions = Object.entries(versions)
    .filter(([, version]) => !isReleaseVersion(version))
    .map(([name, version]) => name + '=' + (version || '缺失'));
  if (invalidVersions.length) {
    errors.push('版本格式无效（需 x.y.z，且每段为 0 到 65535）：' + invalidVersions.join('，'));
  }
  if (new Set(Object.values(versions)).size !== 1) {
    errors.push(
      '版本文件不一致：manifest=' +
        versions.manifest +
        '，package=' +
        versions.package +
        '，package-lock=' +
        versions.packageLock +
        '，package-lock packages[""]=' +
        versions.packageLockRoot
    );
  }

  const unprefixedTags = listUnprefixedReleaseTags();
  if (unprefixedTags.length) {
    errors.push('发布 tag 必须使用 vX.Y.Z 格式，发现无 v 前缀的 tag：' + unprefixedTags.join('，'));
  }

  const localTag = latestReleaseTag();
  if (!localTag) {
    errors.push('未找到 x.y.z 格式的本地发布 tag');
  } else {
    try {
      const commit = verifyTag(localTag, normalizeTagVersion(localTag));
      print(
        'ok',
        '✓ 最新本地 tag ' + localTag + ' 指向 ' + commit.slice(0, 12) + '，且 tag 内版本正确'
      );
    } catch (e) {
      errors.push(e.message);
    }
  }

  try {
    const remoteRecords = listRemoteReleaseTagRecords();
    if (remoteRecords === null) {
      print('warn', 'ℹ 未配置 origin，跳过远端 tag 校验');
    } else {
      const remoteRecord = latestRemoteReleaseRecord(remoteRecords);
      const remoteTag = remoteRecord && remoteRecord.tag;
      const historicalInvalid = remoteRecords
        .filter(record => !isValidRemoteReleaseTag(record) && record.tag !== remoteTag);
      historicalInvalid.forEach(record => {
        print('warn', 'ℹ 历史远端 tag 异常，不阻止更高版本发布：' + remoteTagProblem(record));
      });
      if (!remoteTag) {
        print('warn', 'ℹ origin 尚无 x.y.z 格式的发布 tag');
      } else if (!isValidRemoteReleaseTag(remoteRecord)) {
        errors.push(remoteTagProblem(remoteRecord));
      } else if (!localTag || compareVersions(remoteTag, localTag) > 0) {
        errors.push(
          '远端最新 tag ' +
          remoteTag +
            ' 高于本地 ' +
            (localTag || '无') +
            '；请先执行 git fetch --tags origin 并切换到正确发布基线'
        );
      } else if (compareVersions(remoteTag, localTag) === 0) {
        const localCommit = tagCommit(localTag);
        verifyRemoteTag(remoteTag, localCommit);
        print('ok', '✓ 远端 ' + remoteTag + ' 与本地 tag 指向同一提交');
      } else {
        print('warn', 'ℹ 本地最新 tag ' + localTag + ' 尚未推送到 origin');
      }
    }
  } catch (e) {
    errors.push('远端 tag 校验失败：' + e.message);
  }

  if (errors.length) {
    errors.forEach(message => print('warn', '⚠️ ' + message));
    process.exitCode = 1;
  } else {
    print('ok', '✓ 发布版本与最新 tag 校验通过');
  }
}

function runQualityChecks() {
  print('warn', '→ 运行发布前检查：git diff --check、npm test、npm run lint');
  git(['diff', '--check']);
  git(['diff', '--cached', '--check']);
  run(npmCommand, ['test'], { inherit: true });
  run(npmCommand, ['run', 'lint'], { inherit: true });
}

function verifyRemoteTag(tag, expectedCommit) {
  const refs = git([
    'ls-remote',
    '--tags',
    'origin',
    'refs/tags/' + tag,
    'refs/tags/' + tag + '^{}'
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  const peeled = refs.find(line => line.endsWith('refs/tags/' + tag + '^{}'));
  const direct = refs.find(line => line.endsWith('refs/tags/' + tag));
  if (!peeled) {
    fail('远端 ' + tag + ' 必须是 annotated tag；请勿推送 lightweight tag');
  }
  const remoteCommit = (peeled || direct || '').split(/\s+/)[0];
  if (remoteCommit !== expectedCommit) {
    fail(
      '远端 ' +
        tag +
        ' 指向校验失败，期望 ' +
        expectedCommit +
        '，实际 ' +
        (remoteCommit || '不存在')
    );
  }
}

function remoteTagExists(tag) {
  return !!git(['ls-remote', '--tags', 'origin', 'refs/tags/' + tag]);
}

function recoveryHint() {
  const { stage, branch, tag } = releaseProgress;
  if (stage === 'versions-written' || stage === 'changes-staged') {
    return '版本文件已更新但尚未完成提交。检查 git status 后可重新运行本命令继续发布。';
  }
  if (stage === 'committed') {
    return (
      '发布 commit 已创建但 tag 尚未建立。确认 HEAD 后运行：git tag -a ' +
      tag +
      ' -m "' +
      tag +
      '" HEAD'
    );
  }
  if (stage === 'tagged') {
    return (
      '发布 commit 和本地 tag 已创建。先执行 npm run check-version，再推送：git push origin ' +
      branch +
      '；git push origin ' +
      tag
    );
  }
  if (stage === 'branch-pushed') {
    return (
      '发布分支已推送，但 tag 尚未确认推送。先执行 npm run check-version，再推送：git push origin ' +
      tag
    );
  }
  if (stage === 'tag-pushed') {
    return '分支和 tag 均已推送，但远端校验未完成。请执行 npm run check-version 后再决定是否创建 GitHub Release。';
  }
  return '';
}

async function release() {
  const version = await selectVersion();
  const tag = 'v' + version;
  const branch = git(['branch', '--show-current']);
  releaseProgress = { stage: 'preflight', branch, tag };
  if (!branch) fail('当前为 detached HEAD，无法确定要推送的分支');
  if (tagExists(tag)) fail('本地 tag ' + tag + ' 已存在；请发布新版本，不要覆盖已有 tag');

  const latest = latestReleaseTag();
  if (latest && compareVersions(version, latest) <= 0) {
    fail('发布版本 ' + version + ' 必须大于最新 tag ' + latest);
  }

  runQualityChecks();
  const status = git(['status', '--short']);
  const versions = currentVersions();
  let shouldPush = requestedPush;
  if (!requestedPush && !skipPrompts) {
    shouldPush = await confirm('完成 commit/tag 后推送 origin/' + branch + ' 与 ' + tag + '？');
  }
  if (shouldPush) {
    git(['remote', 'get-url', 'origin']);
    if (remoteTagExists(tag)) fail('远端 tag ' + tag + ' 已存在；请发布新版本，不要覆盖已有 tag');
    const remoteRecords = listRemoteReleaseTagRecords();
    if (remoteRecords === null) fail('未配置 origin，无法推送发布');
    const remoteRecord = latestRemoteReleaseRecord(remoteRecords);
    const remoteLatest = remoteRecord && remoteRecord.tag;
    if (remoteRecord && !isValidRemoteReleaseTag(remoteRecord)) {
      if (!allowLegacyInvalidTags) {
        fail(
          remoteTagProblem(remoteRecord) +
          '；如已核实这是历史遗留问题，才可显式传入 --allow-legacy-invalid-tags 发布更高版本'
        );
      }
      print('warn', '⚠️ 已显式允许绕过历史异常的远端最新 tag：' + remoteTagProblem(remoteRecord));
    }
    if (remoteLatest && compareVersions(version, remoteLatest) <= 0) {
      fail('发布版本 ' + version + ' 必须大于远端最新 tag ' + remoteLatest);
    }
  }

  console.log('\n发布计划：');
  console.log('  分支：' + branch);
  console.log('  版本：' + versions.manifest + ' → ' + version);
  console.log('  当前改动：' + (status || '仅版本文件'));
  console.log('  推送：' + (shouldPush ? '是' : '否'));
  const confirmation = shouldPush
    ? '确认写入版本文件、提交、创建 annotated tag ' +
      tag +
      '，并推送 origin/' +
      branch +
      ' 与 ' +
      tag +
      '？'
    : '确认写入版本文件、提交并创建 annotated tag ' + tag + '？';
  if (!(await confirm(confirmation))) {
    print('warn', '已取消，未修改文件或 Git 历史');
    return;
  }

  setVersions(version);
  releaseProgress.stage = 'versions-written';
  git(['add', '-A']);
  releaseProgress.stage = 'changes-staged';
  const staged = git(['diff', '--cached', '--name-only']);
  if (!staged) fail('没有可提交的文件，发布已中止');
  git(['commit', '-m', 'release: ' + tag]);
  const head = git(['rev-parse', 'HEAD']);
  releaseProgress.stage = 'committed';
  git(['tag', '-a', tag, '-m', tag, head]);
  releaseProgress.stage = 'tagged';
  verifyTag(tag, version, head);
  print('ok', '✓ 已提交并创建 ' + tag + '，指向 ' + head.slice(0, 12));

  if (shouldPush) {
    git(['push', 'origin', branch], { inherit: true });
    releaseProgress.stage = 'branch-pushed';
    git(['push', 'origin', tag], { inherit: true });
    releaseProgress.stage = 'tag-pushed';
    verifyRemoteTag(tag, head);
    releaseProgress.stage = 'verified';
    print('ok', '✓ 已推送并确认远端 ' + tag + ' 指向正确提交');
  } else {
    print('warn', 'ℹ 尚未推送：git push origin ' + branch + ' && git push origin ' + tag);
  }

  const releaseUrl = githubReleaseUrl(tag);
  if (releaseUrl) console.log('下一步：' + releaseUrl);
}

function showHelp() {
  console.log('用法：');
  console.log('  npm run release                         # 交互输入版本并选择是否推送');
  console.log('  npm run release -- 1.0.1                # 指定版本，仍会交互确认');
  console.log('  npm run release -- 1.0.1 --push         # 指定版本并在确认后推送');
  console.log('  npm run release -- 1.0.1 --push --yes   # 自动确认；仅在 CI 等受控环境使用');
  console.log('  npm run release -- 1.0.1 --push --allow-legacy-invalid-tags  # 仅在核实远端最新 tag 是历史遗留异常时使用');
  console.log('  npm run check-version                   # 校验最新 tag 指向及版本文件一致性');
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else if (args.includes('--check')) {
  checkReleaseState();
} else {
  release().catch(error => {
    print('warn', '✗ 发布失败：' + (error.message || error));
    const hint = recoveryHint();
    if (hint) print('warn', '恢复建议：' + hint);
    process.exitCode = 1;
  });
}
