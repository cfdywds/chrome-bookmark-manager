#!/usr/bin/env node
/**
 * 书签管家 · 原生同步核验工具
 *
 * 读取浏览器本机的 Bookmarks 文件（Chrome/Edge 磁盘上的书签镜像），解码
 * 「书签管家同步数据（请勿修改）」内部目录，核对隐藏书签记录是否已写入
 * 本设备的分片（即 Chrome 书签同步将要上传到云端的内容）。
 *
 * 使用方式：
 *   node scripts/check-native-sync.js
 *       自动扫描 Chrome / Edge 各配置文件的 Bookmarks 文件并核验。
 *   node scripts/check-native-sync.js --bookmarks "<Bookmarks 文件路径>"
 *       指定具体配置文件的书签文件。
 *   node scripts/check-native-sync.js --hidden "<bmHiddenIds JSON 文件>"
 *       传入扩展存储中的 bmHiddenIds（JSON 数组，或 {"bmHiddenIds": [...]}），
 *       逐条核验每个本机隐藏书签是否已在某设备分片中以 hidden=true 发布。
 *   node scripts/check-native-sync.js --device "<设备ID>"
 *       只把指定设备的分片当作"发布来源"（默认任意设备分片均可）。
 *   node scripts/check-native-sync.js --json
 *       输出机器可读 JSON（便于脚本/测试消费）。
 *
 * 退出码：
 *   0  全部核验通过（未传 --hidden 时表示：同步目录存在、分片完整、无校验错误）
 *   1  发现问题（分片损坏 / 存在未发布的隐藏书签等）
 *   2  未找到同步目录或尚无任何数据（该配置文件的同步从未成功发布）
 *
 * 说明：
 *   - 磁盘 Bookmarks 文件是 Chrome 每次变更后（防抖）与退出时写入的镜像；
 *     浏览器运行期间文件可能滞后于内存，长时间未退出时请以本脚本结果结合
 *     chrome://bookmarks 实时视图交叉确认。
 *   - 本工具只能证明"本地镜像已就绪、等待/已进入 Chrome 书签同步"。
 *     云端是否真的收到，仍需 chrome://sync-internals 或另一台设备端到端确认。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const NATIVE_SYNC_ROOT_TITLE = '书签管家同步数据（请勿修改）';
export const NATIVE_SYNC_PROTOCOL = 'BMN1';
export const NATIVE_SYNC_BUCKETS = 32;
export const NATIVE_SYNC_CHUNK_CHARS = 180;

// ---- URL 规范化键：与 js/background.js 的 syncUrlKey 完全一致 ----
export function syncUrlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = String(url.hostname || '').toLowerCase().replace(/^www\./, '');
    const port = url.port ? ':' + url.port : '';
    const pathname = url.pathname.replace(/\/+$/, '');
    const hashRoute = /^#!?\//.test(url.hash) ? url.hash.toLowerCase() : '';
    return (host + port + pathname + url.search + hashRoute).toLowerCase();
  } catch (e) {
    return String(rawUrl || '').trim().toLowerCase();
  }
}

// ---- FNV-1a 32 位校验和：与 js/background.js 的 nativeChecksum 完全一致 ----
export function nativeChecksum(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + '-' + text.length.toString(36);
}

// ---- URL 键 → 分桶：与 js/background.js 的 nativeBucketForUrl 完全一致 ----
export function nativeBucketForUrl(key) {
  let hash = 2166136261;
  const text = String(key || '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % NATIVE_SYNC_BUCKETS).padStart(2, '0');
}

export function nativeBase64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

// ---- 解码分片：j=纯 base64url(JSON)，z=gzip 后 base64url(JSON) ----
export function decodeNativePayload(value) {
  const encoded = String(value || '');
  if (encoded.length < 2 || !/^[jz]$/.test(encoded[0])) return null;
  try {
    let bytes = nativeBase64UrlDecode(encoded.slice(1));
    if (encoded[0] === 'z') bytes = zlib.gunzipSync(bytes);
    return JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    return null;
  }
}

function titleParts(title) {
  const parts = String(title || '').split('|');
  return parts[0] === NATIVE_SYNC_PROTOCOL ? parts : null;
}

function deviceIdOf(node) {
  const parts = titleParts(node && node.name);
  return parts && parts.length === 3 && parts[1] === 'D' && parts[2] ? parts[2] : '';
}

function headInfo(node) {
  const parts = titleParts(node && node.name);
  if (!parts || parts.length !== 6 || parts[1] !== 'H') return null;
  const count = Number(parts[4]);
  if (!parts[2] || !parts[3] || !Number.isInteger(count) || count < 1 || !parts[5]) return null;
  return { node, bucket: parts[2], generation: parts[3], count, checksum: parts[5] };
}

function chunkInfo(node) {
  const parts = titleParts(node && node.name);
  if (!parts || parts.length !== 7 || parts[1] !== 'S') return null;
  const index = Number(parts[4]);
  const count = Number(parts[5]);
  if (!parts[2] || !parts[3] || !Number.isInteger(index) || index < 0 ||
    !Number.isInteger(count) || count < 1 || !parts[6]) return null;
  return { node, bucket: parts[2], generation: parts[3], index, count, payload: parts[6] };
}

export function compareNativeGeneration(left, right) {
  const parse = value =>
    String(value || '').split('-', 2).map(part => parseInt(part, 36) || 0);
  const a = parse(left);
  const b = parse(right);
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return String(left || '').localeCompare(String(right || ''));
}

export function compareNativeRevision(left, right) {
  const a = normalizeRevision(left);
  const b = normalizeRevision(right);
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2]);
}

function normalizeRevision(value) {
  if (!Array.isArray(value) || value.length !== 3) return [0, 0, ''];
  return [
    Math.max(0, Math.floor(Number(value[0]) || 0)),
    Math.max(0, Math.floor(Number(value[1]) || 0)),
    String(value[2] || '')
  ];
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tags)) return null;
  const revision = normalizeRevision(value.revision);
  if (!revision[0] || !revision[2]) return null;
  const record = {
    tags: [...new Set(value.tags.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 6),
    revision
  };
  if (typeof value.hidden === 'boolean') record.hidden = value.hidden;
  if (value.provisional === true) record.provisional = true;
  return record;
}

// ---- 磁盘 Bookmarks 文件使用 name 字段（chrome.bookmarks API 是 title） ----
export function findSyncRoot(nodes) {
  for (const node of nodes || []) {
    if (node && node.type === 'folder' && node.name === NATIVE_SYNC_ROOT_TITLE) return node;
    const nested = findSyncRoot(node && node.children);
    if (nested) return nested;
  }
  return null;
}

export function collectUserBookmarks(nodes, out, inInternalTree) {
  const result = out || [];
  for (const node of nodes || []) {
    if (!node) continue;
    const internal = inInternalTree || (node.type === 'folder' && node.name === NATIVE_SYNC_ROOT_TITLE);
    if (!internal && node.type === 'url' && node.url) {
      result.push({ id: String(node.id), url: node.url, name: node.name || '' });
    }
    if (node.children) collectUserBookmarks(node.children, result, internal);
  }
  return result;
}

export function collectSyncData(tree) {
  const root = findSyncRoot(tree);
  if (!root) return { root: null, devices: [], errors: [] };
  const devices = [];
  const errors = [];
  for (const folder of root.children || []) {
    const deviceId = deviceIdOf(folder);
    if (!deviceId) continue;
    const children = folder.children || [];
    const heads = children.map(headInfo).filter(Boolean);
    const chunks = children.map(chunkInfo).filter(Boolean);
    if (!heads.length) {
      devices.push({
        deviceId, heads: [], buckets: [], records: {},
        recordCount: 0, hiddenCount: 0, maxRevision: [0, 0, ''], empty: true
      });
      continue;
    }
    const byBucket = new Map();
    for (const head of heads) {
      const current = byBucket.get(head.bucket);
      if (!current || compareNativeGeneration(head.generation, current.generation) > 0) {
        byBucket.set(head.bucket, head);
      }
    }
    const records = {};
    let maxRevision = [0, 0, ''];
    for (const head of byBucket.values()) {
      const bucketChunks = chunks
        .filter(c => c.bucket === head.bucket && c.generation === head.generation && c.count === head.count)
        .sort((a, b) => a.index - b.index);
      let error = '';
      if (bucketChunks.length !== head.count || bucketChunks.some((c, i) => c.index !== i)) {
        error = '分片缺失或序号不连续';
      } else {
        const encoded = bucketChunks.map(c => c.payload).join('');
        if (nativeChecksum(encoded) !== head.checksum) error = '分片校验和不匹配';
        else {
          const payload = decodeNativePayload(encoded);
          error = payload ? '' : '分片内容无法解码';
          if (payload) {
            if (payload.version !== 1 || payload.deviceId !== deviceId) {
              error = '分片协议内容无效';
            } else if (payload.type === 'records' && payload.records &&
              typeof payload.records === 'object' && !Array.isArray(payload.records)) {
              Object.entries(payload.records).forEach(([key, raw]) => {
                const record = normalizeRecord(raw);
                if (!record) {
                  errors.push(`${deviceId}/${head.bucket}: 标签记录内容无效`);
                  return;
                }
                records[key] = record;
                if (compareNativeRevision(record.revision, maxRevision) > 0) maxRevision = record.revision;
              });
            } else if (payload.type === 'config') {
              /* 配置分片不在本工具核验范围 */
            } else {
              error = '分片类型无效';
            }
          }
        }
      }
      if (error) errors.push(`${deviceId}/${head.bucket}: ${error}`);
    }
    const recordCount = Object.keys(records).length;
    const hiddenCount = Object.values(records).filter(r => r.hidden === true).length;
    devices.push({
      deviceId, heads, buckets: byBucket.size, records,
      recordCount, hiddenCount, maxRevision, empty: false
    });
  }
  return { root, devices, errors };
}

// ---- 逐条核验本机隐藏书签是否已发布（hidden=true） ----
export function crossCheckHidden(tree, data, hiddenIds, onlyDeviceId) {
  const bookmarks = collectUserBookmarks(tree);
  const byId = new Map(bookmarks.map(bookmark => [String(bookmark.id), bookmark]));
  const results = [];
  let okCount = 0;
  let missingCount = 0;
  let notPublishedCount = 0;
  let noBookmarkCount = 0;
  for (const rawId of hiddenIds || []) {
    const id = String(rawId);
    const bookmark = byId.get(id);
    if (!bookmark) {
      results.push({
        id, status: 'NO_BOOKMARK',
        detail: '本机书签文件中不存在该 id（可能已被删除，或 Bookmarks 文件过期）'
      });
      noBookmarkCount++;
      continue;
    }
    const key = syncUrlKey(bookmark.url);
    const sources = onlyDeviceId ? data.devices.filter(d => d.deviceId === onlyDeviceId) : data.devices;
    const holder = sources.find(d => d.records[key] && d.records[key].hidden === true);
    if (holder) {
      results.push({
        id, url: bookmark.url, key, holder: holder.deviceId, status: 'OK',
        detail: `${holder.deviceId}/${key} hidden=true（revision ${holder.records[key].revision.join(',')}）`
      });
      okCount++;
      continue;
    }
    const any = data.devices.find(d => d.records[key]);
    if (any) {
      results.push({
        id, url: bookmark.url, key, holder: any.deviceId, status: 'NOT_PUBLISHED',
        detail: `设备 ${any.deviceId} 已有该 URL 记录但 hidden=false（本机尚未把隐藏状态写入分片）`
      });
      notPublishedCount++;
      continue;
    }
    results.push({
      id, url: bookmark.url, key, status: 'MISSING',
      detail: '任何设备分片中都没有该 URL 的记录：云端尚未收到该书签的隐藏数据'
    });
    missingCount++;
  }
  return { results, okCount, missingCount, notPublishedCount, noBookmarkCount };
}

// ---- 自动扫描 Chrome / Edge 配置文件 ----
export function detectBookmarksFiles(rootDirs) {
  const candidates = [];
  const roots = rootDirs && rootDirs.length
    ? rootDirs
    : [
      path.join(process.env.LOCALAPPDATA || os.homedir(), 'Google', 'Chrome', 'User Data'),
      path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'Edge', 'User Data')
    ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'Bookmarks');
      if (fs.existsSync(file)) candidates.push(file);
    }
  }
  const withRoot = candidates.filter(file => {
    try {
      return fs.readFileSync(file, 'utf8').includes(NATIVE_SYNC_ROOT_TITLE);
    } catch (e) {
      return false;
    }
  });
  return { all: candidates, withRoot };
}

// ---- CLI ----
function readHiddenIds(file) {
  if (!file) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && Array.isArray(raw.bmHiddenIds)) return raw.bmHiddenIds.map(String);
  throw new Error('--hidden 文件需为 JSON 数组，或 {"bmHiddenIds": [...]}');
}

function formatRevision(revision) {
  return revision && revision[0] ? `${revision[0]}.${revision[1]}.${revision[2]}` : '-';
}

function humanReport(report) {
  const lines = [];
  lines.push('书签管家 · 原生同步核验报告');
  lines.push('='.repeat(40));
  lines.push(`书签文件: ${report.file} (${report.fileBytes} B)`);
  lines.push(`同步根目录「${NATIVE_SYNC_ROOT_TITLE}」: ${report.root ? '已找到' : '未找到'}`);
  if (!report.root) {
    lines.push('');
    lines.push('=> 结论：该配置文件的 Chrome 书签中从未写入同步数据。');
    lines.push('   也就是「标签原生同步」未开启，或开启后从未成功发布过任何分片。');
    lines.push('   此时本机隐藏书签数据必然尚未同步到云端。');
    lines.push('   请打开扩展设置页开启「标签原生同步」，等待状态变为“上次同步成功”后重新核验。');
    return lines.join('\n');
  }
  lines.push(`设备分片: ${report.devices.length} 个`);
  report.devices.forEach((device, index) => {
    if (device.empty) {
      lines.push(`  [${index}] 设备 ${device.deviceId}：尚无任何分片数据（等待写入）`);
    } else {
      lines.push(
        `  [${index}] 设备 ${device.deviceId}：${device.buckets} 个桶 / ` +
        `${device.recordCount} 条记录 / 隐藏 ${device.hiddenCount} 条 / ` +
        `最大修订 ${formatRevision(device.maxRevision)}`
      );
    }
  });
  if (report.errors.length) {
    lines.push('');
    lines.push(`完整性错误（${report.errors.length} 项）：`);
    report.errors.slice(0, 20).forEach(error => lines.push(`  ! ${error}`));
  }
  lines.push('');
  lines.push(`所有设备合并记录: ${report.mergedRecordCount} 条，其中隐藏 ${report.mergedHiddenCount} 条`);
  if (report.hiddenKeys && report.hiddenKeys.length) {
    lines.push(`已发布 hidden=true 的 URL 键（前 ${Math.min(report.hiddenKeys.length, 30)} 条 / 共 ${report.hiddenKeys.length} 条）：`);
    report.hiddenKeys.slice(0, 30).forEach(key => lines.push(`  - ${key}`));
  }
  if (!report.hiddenCheck) {
    lines.push('');
    lines.push('提示：未做“本机隐藏书签逐条核验”。把扩展存储里的 bmHiddenIds 导出为 JSON');
    lines.push('文件后加 --hidden 参数重跑，可确认每个隐藏书签都已写入分片。');
    lines.push('扩展控制台导出命令：');
    lines.push('  chrome.storage.local.get("bmHiddenIds").then(r => console.log(JSON.stringify(r.bmHiddenIds || [])))');
  } else {
    const check = report.hiddenCheck;
    lines.push('');
    lines.push(`本机隐藏书签逐条核验（共 ${check.total} 个）：`);
    check.results.forEach(result => {
      const statusLabel = {
        OK: '已发布', MISSING: '缺失', NOT_PUBLISHED: '未发布', NO_BOOKMARK: '无此书签'
      }[result.status] || result.status;
      lines.push(`  [${statusLabel}] id=${result.id}${result.url ? '  ' + result.url : ''} ${result.detail}`);
    });
    if (check.okCount === check.total && check.total > 0) {
      lines.push('');
      lines.push('=> 结论：本机全部隐藏书签均已以 hidden=true 写入分片，本地镜像已就绪，');
      lines.push('   可交由 Chrome 书签同步上传云端。');
    } else if (check.total === 0) {
      lines.push('');
      lines.push('=> 结论：本机 bmHiddenIds 为空（没有任何隐藏书签），无需核验。');
    } else {
      lines.push('');
      lines.push(`=> 结论：仍有 ${check.total - check.okCount} 个隐藏书签未发布到分片。`);
      lines.push('   请打开侧边栏/设置页触发同步，或等待后台防抖发布完成后重新核验。');
    }
  }
  lines.push('');
  lines.push('注意：分片就绪只代表“Chrome 书签同步将上传的内容”。云端是否已收到，请结合');
  lines.push('chrome://sync-internals 的书签同步状态，或在另一台设备登录同一账号端到端确认。');
  return lines.join('\n');
}

function buildReport(file, hiddenFile, deviceId) {
  const content = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(content);
  // Chrome/Edge 磁盘上的 Bookmarks 是 { checksum, roots: {...} } 包装；
  // 测试与手工文件也可能是裸节点数组。
  const nodes = Array.isArray(parsed) ? parsed : Object.values(parsed.roots || parsed);
  const data = collectSyncData(nodes);
  const merged = {};
  let mergedHiddenCount = 0;
  (data.devices || []).forEach(device => {
    Object.entries(device.records).forEach(([key, record]) => {
      const current = merged[key];
      if (!current || compareNativeRevision(record.revision, current.revision) > 0) {
        merged[key] = record;
        if (record.hidden === true) mergedHiddenCount++;
      } else if (record.hidden === true && current.hidden !== true) {
        merged[key] = { ...current, hidden: true };
        mergedHiddenCount++;
      }
    });
  });
  const hiddenKeys = Object.entries(merged)
    .filter(([, record]) => record.hidden === true)
    .map(([key]) => key)
    .sort();
  let hiddenCheck = null;
  if (hiddenFile) {
    const hiddenIds = readHiddenIds(hiddenFile);
    const check = crossCheckHidden(nodes, data, hiddenIds, deviceId || '');
    hiddenCheck = {
      total: hiddenIds.length,
      ...check,
      results: check.results
    };
  }
  return {
    file,
    fileBytes: Buffer.byteLength(content, 'utf8'),
    root: !!data.root,
    devices: data.devices.map(device => ({
      deviceId: device.deviceId,
      buckets: device.buckets,
      recordCount: device.recordCount,
      hiddenCount: device.hiddenCount,
      maxRevision: device.maxRevision,
      empty: device.empty
    })),
    errors: data.errors,
    mergedRecordCount: Object.keys(merged).length,
    mergedHiddenCount,
    hiddenKeys,
    hiddenCheck
  };
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : null;
  };
  const bookmarksFile = arg('--bookmarks');
  const hiddenFile = arg('--hidden');
  const deviceId = arg('--device') || '';
  const jsonOutput = args.includes('--json');

  let file = bookmarksFile;
  if (!file) {
    const detected = detectBookmarksFiles();
    if (detected.withRoot.length === 1) {
      file = detected.withRoot[0];
    } else if (detected.withRoot.length > 1) {
      fail('检测到多个配置文件包含同步目录，请用 --bookmarks 指定：\n  ' +
        detected.withRoot.join('\n  '));
    } else if (detected.all.length === 1) {
      file = detected.all[0];
    } else if (detected.all.length > 1) {
      fail('未自动定位到包含同步目录的书签文件。候选文件如下，请用 --bookmarks 指定：\n  ' +
        detected.all.join('\n  '));
    } else {
      fail('未找到 Chrome / Edge 的 Bookmarks 文件。请用 --bookmarks 指定路径。');
    }
  }
  if (!fs.existsSync(file)) fail('Bookmarks 文件不存在：' + file);

  const report = buildReport(file, hiddenFile, deviceId);
  if (jsonOutput) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(humanReport(report) + '\n');
  }
  const hasHiddenIssues = report.hiddenCheck &&
    report.hiddenCheck.okCount < report.hiddenCheck.total;
  if (!report.root) process.exit(2);
  if (report.errors.length || hasHiddenIssues) process.exit(1);
  process.exit(0);
}

if (process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}