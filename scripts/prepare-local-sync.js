#!/usr/bin/env node
/**
 * Creates a stable-ID unpacked build for personal Chrome Sync use.
 * The private key stays outside the repository; only its public key is copied
 * into the generated manifest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const defaultKeyDir = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'BookmarkManager', 'local-sync')
  : path.join(os.homedir(), '.bookmark-manager', 'local-sync');
const keyDir = path.resolve(process.env.BM_LOCAL_SYNC_KEY_DIR || defaultKeyDir);
const outputDir = path.resolve(process.env.BM_LOCAL_SYNC_BUILD_DIR || path.join(root, 'local-sync-build'));
const privateKeyPath = path.join(keyDir, 'extension-private.pem');
const outputMarkerPath = path.join(outputDir, '.bookmark-manager-local-sync-build');
const manifestPath = path.join(root, 'manifest.json');
const runtimeFiles = ['popup.html', 'options.html', 'newtab.html'];
const runtimeDirectories = ['css', 'icons', 'js'];
const minimumNodeMajor = 20;

function fail(message) {
  throw new Error(message);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function pathsOverlap(left, right) {
  return left === right || isWithin(left, right) || isWithin(right, left);
}

function assertEnvironment() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < minimumNodeMajor) {
    fail('需要 Node.js ' + minimumNodeMajor + ' 或更高版本，当前为 ' + process.versions.node);
  }
  if (!fs.existsSync(manifestPath)) fail('未找到 manifest.json；请从项目根目录运行此脚本');
  if (outputDir === root) fail('生成目录不能是项目根目录');
  if (keyDir === root || isWithin(root, keyDir)) {
    fail('密钥目录必须位于仓库之外，拒绝写入：' + keyDir);
  }
  if (pathsOverlap(keyDir, outputDir)) {
    fail('密钥目录和生成目录不能重叠，避免私钥进入可分发目录');
  }
  if (fs.existsSync(outputDir) && !fs.existsSync(outputMarkerPath)) {
    fail('生成目录已存在但不是本脚本创建，拒绝覆盖：' + outputDir);
  }
  runtimeFiles.forEach(file => {
    if (!fs.statSync(path.join(root, file)).isFile()) fail('运行时文件缺失：' + file);
  });
  runtimeDirectories.forEach(directory => {
    if (!fs.statSync(path.join(root, directory)).isDirectory()) fail('运行时目录缺失：' + directory);
  });
}

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('manifest.json 无法解析：' + error.message);
  }
  if (manifest.manifest_version !== 3) fail('仅支持 Manifest V3 扩展');
  return manifest;
}

function createOrReadKeyPair() {
  fs.mkdirSync(keyDir, { recursive: true });
  let privateKey;
  let created = false;
  if (fs.existsSync(privateKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  } else {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'der' }
    });
    privateKey = pair.privateKey;
    fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
    created = true;
  }

  let publicKeyDer;
  try {
    publicKeyDer = crypto.createPublicKey(crypto.createPrivateKey(privateKey)).export({
      type: 'spki',
      format: 'der'
    });
  } catch (error) {
    fail('本地私钥无效：' + privateKeyPath + '；' + error.message);
  }
  return { created, publicKeyDer };
}

function extensionId(publicKeyDer) {
  const alphabet = 'abcdefghijklmnop';
  return crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => alphabet[Number.parseInt(digit, 16)]);
}

function copyRuntime(manifest, publicKeyDer, id) {
  fs.mkdirSync(outputDir, { recursive: true });
  runtimeFiles.forEach(file => fs.copyFileSync(path.join(root, file), path.join(outputDir, file)));
  runtimeDirectories.forEach(directory => {
    const targetDirectory = path.join(outputDir, directory);
    fs.rmSync(targetDirectory, { recursive: true, force: true });
    fs.cpSync(path.join(root, directory), targetDirectory, { recursive: true, force: true });
  });
  const buildManifest = { ...manifest, key: publicKeyDer.toString('base64') };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(buildManifest, null, 2) + '\n');
  fs.writeFileSync(outputMarkerPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    expectedExtensionId: id
  }, null, 2) + '\n');
}

function findChrome() {
  if (process.platform !== 'win32') return '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function main() {
  assertEnvironment();
  const manifest = readManifest();
  const { created, publicKeyDer } = createOrReadKeyPair();
  const id = extensionId(publicKeyDer);
  copyRuntime(manifest, publicKeyDer, id);
  const chrome = findChrome();

  console.log('✓ 本地同步构建已生成');
  console.log('  生成目录：' + outputDir);
  console.log('  固定扩展 ID：' + id);
  console.log('  私钥：' + privateKeyPath + (created ? '（首次生成）' : '（已复用）'));
  console.log(chrome ? '  Chrome：已检测到 ' + chrome : '  Chrome：未自动检测到，请确认已安装 Chrome');
  console.log('');
  console.log('下一步：在 chrome://extensions 开启开发者模式，加载上述生成目录。');
  console.log('其他设备复制生成目录、登录同一 Google 账户并启用 Chrome 同步后加载；切勿复制私钥。');
  console.log('权威设备应加密离线备份私钥，以便换机后继续生成同一扩展 ID。');
}

try {
  main();
} catch (error) {
  console.error('✗ 本地同步构建失败：' + (error.message || error));
  process.exitCode = 1;
}
