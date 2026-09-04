// 书签管家 · 后台服务（Manifest V3 Service Worker）
// ① 点击工具栏图标 → Chrome 原生自动打开右侧 Side Panel（openPanelOnActionClick:true）。
// ② 监听 chrome.bookmarks.onCreated：浏览器地址栏 ⭐ 收藏后，在后台写入默认标签。

// 点击图标自动打开侧边栏（Chrome 原生行为，100% 可靠）
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.warn('[书签管家] 无法设置侧边栏行为', err));
}

// ---- 接管 ⭐ 收藏按钮：后台默认打标，不打开侧边栏或新增抽屉 ----
const STAR_HOOK_KEY = 'bmStarHook';   // storage.local 键，true/false，默认 true
const AUTO_AI_TAG_KEY = 'bmAutoAiTag'; // 明确开启后，普通浏览器收藏才允许静默请求 LLM
const TAGS_KEY = 'bmTags';
const FIXED_TAGS_KEY = 'bmFixedTags';
const TAG_RULES_KEY = 'bmTagRules';
const LEGACY_DOMAIN_GROUPS_MIGRATED_KEY = 'bmDomainGroupsMigrated';
const TAG_MUTATION_MESSAGE = 'bmTagMutation';
const FALLBACK_TAG = '其他';
const MAX_FIXED_TAGS = 50;
const MAX_TAGS_PER_BOOKMARK = 6;
const AUTO_TAG_BATCH_DELAY_MS = 200;
const SYNC_STATUS_KEY = 'bmTagSyncStatus';
const NATIVE_SYNC_ENABLED_KEY = 'bmNativeTagSyncEnabled';
const NATIVE_SYNC_STATE_KEY = 'bmNativeTagSyncState';
const NATIVE_SYNC_RECORDS_KEY = 'bmNativeTagSyncRecords';
const NATIVE_SYNC_CONFIG_KEY = 'bmNativeTagSyncConfig';
const NATIVE_SYNC_URLS_KEY = 'bmNativeTagSyncUrls';
const NATIVE_SYNC_ROOT_TITLE = '书签管家同步数据（请勿修改）';
const NATIVE_SYNC_PROTOCOL = 'BMN1';
const NATIVE_SYNC_BUCKETS = 32;
const NATIVE_SYNC_CHUNK_CHARS = 900;
const NATIVE_SYNC_MESSAGE = 'bmNativeTagSync';
const NATIVE_SYNC_DELAY_MS = 800;
const LEGACY_DEFAULT_FIXED_TAGS = [
  'AI', '前端', '后端', '移动端', 'JAVA', 'Python', '数据库', '运维', '安全', '设计',
  '学习', '教程', '工具', '效率', '工作', '资讯', '阅读', '视频', '娱乐', '生活', '社交', '博客',
  'linux.do', 'GitHub', '掘金', '知乎', 'V2EX', '中转站', 'Telegram', '微信公众号'
];
const DEFAULT_FIXED_TAGS = [
  'AI', '代码', '前端', '后端', '移动端', 'JAVA', 'Python', '数据库', '运维', '安全', '设计',
  '学习', '教程', '工具', '效率', '工作', '资讯', '阅读', '视频', '娱乐', '生活', '社交', '论坛', '博客'
];
const DOMAIN_TAG_RULES = [
  { signals: ['figma', 'mastergo', 'js.design', 'modao'], tags: ['设计', '工作'] },
  { signals: ['github', 'gitlab', 'gitee', 'bitbucket', 'codeberg', 'sourceforge'], tags: ['代码'] },
  { signals: ['reddit', 'discourse', 'stackoverflow', 'stackexchange', 'segmentfault'], tags: ['论坛'] },
  { signals: ['tailscale', 'zerotier', 'wireguard'], tags: ['运维', '工具'] },
  { signals: ['docker', 'kubernetes', 'rancher', 'jenkins', 'grafana'], tags: ['运维'] },
  { signals: ['notion', 'feishu', 'dingtalk', 'yuque', 'shimo'], tags: ['工作', '效率'] },
  { signals: ['openai', 'anthropic', 'deepseek', 'huggingface'], tags: ['AI'] }
];
const BACKGROUND_TAG_HINTS = [
  ['AI', ['openai', 'chatgpt', 'claude', 'gemini', 'deepseek', 'qwen', 'ollama', 'huggingface', 'llm', '大模型', '人工智能']],
  ['前端', ['react', 'vue', 'angular', 'svelte', 'css', 'html', 'javascript', 'typescript', 'webpack', 'vite']],
  ['后端', ['spring', 'django', 'flask', 'fastapi', 'nodejs', 'node.js', 'api', 'graphql', 'grpc']],
  ['移动端', ['android', 'ios', 'flutter', 'react native', 'uniapp', '小程序']],
  ['JAVA', ['java', 'maven', 'gradle']],
  ['Python', ['python', 'pypi']],
  ['数据库', ['mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'elasticsearch']],
  ['运维', ['docker', 'kubernetes', 'k8s', 'nginx', 'jenkins', 'terraform', 'ansible', 'linux']],
  ['安全', ['security', '安全', 'cve', 'owasp', '漏洞']],
  ['设计', ['figma', 'sketch', 'adobe', 'dribbble', 'behance', '设计']],
  ['学习', ['course', '课程', '学习', 'education', 'edu.', '大学']],
  ['教程', ['tutorial', '教程', 'guide', '文档', 'docs.']],
  ['工具', ['tool', '工具', 'calculator', '转换', '下载']],
  ['效率', ['notion', 'todo', '待办', '效率', '日历', 'calendar']],
  ['资讯', ['news', '新闻', '资讯', '日报', 'reuters', 'bbc']],
  ['阅读', ['read', '阅读', '小说', '书籍', 'ebook']],
  ['视频', ['youtube', 'bilibili', '视频', 'movie', 'netflix']],
  ['娱乐', ['game', '游戏', '娱乐', 'music', '音乐']],
  ['社交', ['twitter', 'x.com', 'weibo', '微博', 'zhihu', '知乎', 'reddit', 'discord']],
  ['博客', ['blog', '博客', 'medium', 'substack']],
  ['运维', ['v2ray', 'clash', 'shadowsocks', 'vpn']]
];
let tagMutationQueue = Promise.resolve();
let autoTagFlushTimer = null;
let nativeSyncQueue = Promise.resolve();
let nativeSyncTimer = null;
let nativeSyncApplying = false;
let nativeSyncGeneration = 0;
const deferredNativeSyncAutoTags = new Map();
// storage.onChanged 在 Service Worker 队列执行时，apply 期间的布尔标志已经会复位。
// 用实际写入值消费一次事件，避免接收端把远端内容重新写成自己的新版本。
const nativeSyncIgnoredTagValues = new Set();
const nativeSyncIgnoredConfigValues = new Set();
let nativeBookmarkImportInProgress = false;
let nativeBookmarkImportEnded = false;
let nativeImportCreatedInFlight = 0;
const pendingAutoTags = new Map();
const BACKUP_IMPORT_MESSAGE = 'bmBackupImportBookmark';
const SELF_CREATION_MESSAGE = 'bmSelfCreatingBookmark';
const BACKUP_IMPORT_TOKEN_TTL_MS = 15000;
const BACKUP_IMPORT_CONFIRM_WAIT_MS = 500;
const backupImportTokens = new Map();
const backupImportWaiters = new Map();

function backupImportTokenKey(parentId, url) {
  return 'import\n' + String(parentId || '') + '\n' + url;
}

function selfCreationTokenKey(parentId, url) {
  return 'self\n' + String(parentId || '') + '\n' + url;
}

function queueTagMutation(task) {
  const result = tagMutationQueue.then(task, task);
  tagMutationQueue = result.catch(() => {});
  return result;
}

function syncUrlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = String(url.hostname || '').toLowerCase().replace(/^www\./, '');
    const port = url.port ? ':' + url.port : '';
    const path = url.pathname.replace(/\/+$/, '');
    const hashRoute = /^#!?\//.test(url.hash) ? url.hash.toLowerCase() : '';
    return (host + port + path + url.search + hashRoute).toLowerCase();
  } catch (e) {
    return String(rawUrl || '').trim().toLowerCase();
  }
}

// ---- 原生书签标签同步 -------------------------------------------------------
// Chrome 不提供书签自定义字段。此处用一个保留文件夹承载按设备分片的元数据，
// 每台设备只写自己的分片，读取时按 URL 修订号合并，避免并发覆盖整份数据。
function nativeBase64UrlEncode(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function nativeBase64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function nativeCompress(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function nativeDecompress(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function encodeNativePayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const compressed = await nativeCompress(bytes);
  return (compressed ? 'z' : 'j') + nativeBase64UrlEncode(compressed || bytes);
}

async function decodeNativePayload(value) {
  const encoded = String(value || '');
  if (encoded.length < 2 || !/^[jz]$/.test(encoded[0])) return null;
  try {
    let bytes = nativeBase64UrlDecode(encoded.slice(1));
    if (encoded[0] === 'z') {
      bytes = await nativeDecompress(bytes);
      if (!bytes) return null;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

function nativeChecksum(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + '-' + text.length.toString(36);
}

function nativeTitleParts(title) {
  const parts = String(title || '').split('|');
  return parts[0] === NATIVE_SYNC_PROTOCOL ? parts : null;
}

function nativeDeviceFolderId(node) {
  const parts = nativeTitleParts(node && node.title);
  return parts && parts.length === 3 && parts[1] === 'D' && parts[2] ? parts[2] : '';
}

function nativeHeadInfo(node) {
  const parts = nativeTitleParts(node && node.title);
  if (!parts || parts.length !== 6 || parts[1] !== 'H') return null;
  const count = Number(parts[4]);
  if (!parts[2] || !parts[3] || !Number.isInteger(count) || count < 1 || !parts[5]) return null;
  return { node, bucket: parts[2], generation: parts[3], count, checksum: parts[5] };
}

function nativeChunkInfo(node) {
  const parts = nativeTitleParts(node && node.title);
  if (!parts || parts.length !== 7 || parts[1] !== 'S') return null;
  const index = Number(parts[4]);
  const count = Number(parts[5]);
  if (!parts[2] || !parts[3] || !Number.isInteger(index) || index < 0 ||
    !Number.isInteger(count) || count < 1 || !parts[6]) return null;
  return { node, bucket: parts[2], generation: parts[3], index, count, payload: parts[6] };
}

function isNativeSyncRoot(node) {
  return !!node && !node.url && node.title === NATIVE_SYNC_ROOT_TITLE;
}

function findNativeSyncRoot(nodes) {
  for (const node of nodes || []) {
    if (isNativeSyncRoot(node)) return node;
    const nested = findNativeSyncRoot(node && node.children);
    if (nested) return nested;
  }
  return null;
}

function collectNativeUserBookmarks(nodes, out, inInternalTree) {
  for (const node of nodes || []) {
    if (!node) continue;
    const internal = inInternalTree || isNativeSyncRoot(node);
    if (!internal && node.url) out.push(node);
    if (node.children) collectNativeUserBookmarks(node.children, out, internal);
  }
  return out;
}

function nativeBookmarkUrlMap(bookmarks) {
  const result = {};
  (bookmarks || []).forEach(bookmark => {
    const id = String(bookmark && bookmark.id || '');
    const key = syncUrlKey(bookmark && bookmark.url);
    if (id && key) result[id] = key;
  });
  return result;
}

function nativeRecordTagsForUrl(bookmarks, tags, key) {
  const values = [];
  (bookmarks || []).forEach(bookmark => {
    if (syncUrlKey(bookmark.url) !== key) return;
    values.push(...normalizeNativeTags(tags && tags[bookmark.id]));
  });
  return normalizeNativeTags(values);
}

function updateNativeRecordsForUrls(records, state, bookmarks, tags, keys) {
  [...new Set(keys || [])].filter(Boolean).sort().forEach(key => {
    records[key] = {
      tags: nativeRecordTagsForUrl(bookmarks, tags, key),
      revision: nativeNextRevision(state)
    };
  });
}

function nativeBucketForUrl(key) {
  let hash = 2166136261;
  const text = String(key || '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % NATIVE_SYNC_BUCKETS).padStart(2, '0');
}

function nativeCreateDeviceId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'device-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function nativeRevision(value) {
  if (!Array.isArray(value) || value.length !== 3) return [0, 0, ''];
  return [
    Math.max(0, Math.floor(Number(value[0]) || 0)),
    Math.max(0, Math.floor(Number(value[1]) || 0)),
    String(value[2] || '')
  ];
}

function compareNativeRevision(left, right) {
  const a = nativeRevision(left);
  const b = nativeRevision(right);
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2]);
}

function nativeNextRevision(state, observed) {
  const current = nativeRevision([state.clock, state.sequence, state.deviceId]);
  const remote = nativeRevision(observed);
  const nextClock = Math.max(Date.now(), current[0], remote[0]);
  state.sequence = nextClock === current[0] ? current[1] + 1 : 0;
  state.clock = nextClock;
  return [state.clock, state.sequence, state.deviceId];
}

function normalizeNativeTags(tags) {
  return [...new Set((tags || []).map(tag => String(tag || '').trim()).filter(tag => tag && tag !== FALLBACK_TAG))].slice(0, 6);
}

function normalizeNativeRecord(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tags)) return null;
  const revision = nativeRevision(value.revision);
  if (!revision[0] || !revision[2]) return null;
  return { tags: normalizeNativeTags(value.tags), revision };
}

function normalizeNativeConfig(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.fixedTags)) return null;
  const revision = nativeRevision(value.revision);
  if (!revision[0] || !revision[2]) return null;
  return {
    revision,
    fixedTags: [...new Set(value.fixedTags.map(tag => String(tag || '').trim()).filter(Boolean))]
      .filter(tag => tag !== FALLBACK_TAG).slice(0, MAX_FIXED_TAGS),
    tagRules: normalizeBackgroundTagRules(value.tagRules)
  };
}

function nativeConfigValues(fixedTags, tagRules) {
  return {
    fixedTags: backgroundFixedTagPool(fixedTags).filter(tag => tag !== FALLBACK_TAG),
    tagRules: normalizeBackgroundTagRules(tagRules)
  };
}

function nativeStableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(nativeStableJson).join(',') + ']';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + nativeStableJson(value[key])
  ).join(',') + '}';
}

function sameNativeConfigValues(left, right) {
  return !!left && !!right &&
    sameTags(left.fixedTags || [], right.fixedTags || []) &&
    nativeStableJson(left.tagRules || {}) === nativeStableJson(right.tagRules || {});
}

function ignoreNativeTagChange(value) {
  nativeSyncIgnoredTagValues.add(nativeStableJson(value || {}));
}

function consumeIgnoredNativeTagChange(value) {
  const signature = nativeStableJson(value || {});
  if (!nativeSyncIgnoredTagValues.has(signature)) return false;
  nativeSyncIgnoredTagValues.delete(signature);
  return true;
}

function ignoreNativeConfigChange(value) {
  nativeSyncIgnoredConfigValues.add(nativeStableJson(value));
}

function consumeIgnoredNativeConfigChange(changes) {
  if (!changes[FIXED_TAGS_KEY] || !changes[TAG_RULES_KEY]) return false;
  const signature = nativeStableJson({
    fixedTags: changes[FIXED_TAGS_KEY].newValue,
    tagRules: changes[TAG_RULES_KEY].newValue
  });
  if (!nativeSyncIgnoredConfigValues.has(signature)) return false;
  nativeSyncIgnoredConfigValues.delete(signature);
  return true;
}

async function loadNativeSyncState(api) {
  const stored = await api.storage.local.get([NATIVE_SYNC_ENABLED_KEY, NATIVE_SYNC_STATE_KEY]);
  const raw = stored[NATIVE_SYNC_STATE_KEY] && typeof stored[NATIVE_SYNC_STATE_KEY] === 'object'
    ? stored[NATIVE_SYNC_STATE_KEY] : {};
  const state = {
    enabled: stored[NATIVE_SYNC_ENABLED_KEY] === true,
    deviceId: String(raw.deviceId || '').trim() || nativeCreateDeviceId(),
    clock: Math.max(0, Math.floor(Number(raw.clock) || 0)),
    sequence: Math.max(0, Math.floor(Number(raw.sequence) || 0)),
    seeded: raw.seeded === true
  };
  return state;
}

async function saveNativeSyncState(api, state) {
  await api.storage.local.set({
    [NATIVE_SYNC_ENABLED_KEY]: !!state.enabled,
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: !!state.seeded
    }
  });
}

async function loadNativeSyncRecords(api) {
  const stored = await api.storage.local.get(NATIVE_SYNC_RECORDS_KEY);
  return stored[NATIVE_SYNC_RECORDS_KEY] && typeof stored[NATIVE_SYNC_RECORDS_KEY] === 'object'
    ? { ...stored[NATIVE_SYNC_RECORDS_KEY] } : {};
}

async function loadNativeSyncUrls(api) {
  const stored = await api.storage.local.get(NATIVE_SYNC_URLS_KEY);
  const raw = stored[NATIVE_SYNC_URLS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .filter(([id, key]) => String(id || '') && String(key || ''))
    .map(([id, key]) => [String(id), String(key)]));
}

async function loadNativeSyncConfig(api) {
  const stored = await api.storage.local.get(NATIVE_SYNC_CONFIG_KEY);
  return normalizeNativeConfig(stored[NATIVE_SYNC_CONFIG_KEY]);
}

function findNativeParent(tree) {
  const roots = tree && tree[0] && tree[0].children || [];
  return roots.find(node => String(node.id) === '2') || roots[1] || roots[0] || null;
}

async function ensureNativeSyncRoot(api, tree) {
  const existing = findNativeSyncRoot(tree);
  if (existing) return existing;
  const parent = findNativeParent(tree);
  if (!parent || !parent.id) throw new Error('未找到可创建同步数据目录的书签根目录');
  return api.bookmarks.create({ parentId: parent.id, title: NATIVE_SYNC_ROOT_TITLE });
}

async function ensureNativeDeviceFolder(api, root, deviceId) {
  const existing = (root.children || []).find(node => nativeDeviceFolderId(node) === deviceId);
  if (existing) return existing;
  return api.bookmarks.create({ parentId: root.id, title: `${NATIVE_SYNC_PROTOCOL}|D|${deviceId}` });
}

function findNativeHead(children, bucket) {
  return (children || []).map(nativeHeadInfo).find(info => info && info.bucket === bucket) || null;
}

async function readNativeHeadPayload(children, head) {
  const chunks = (children || []).map(nativeChunkInfo)
    .filter(chunk => chunk && chunk.bucket === head.bucket && chunk.generation === head.generation && chunk.count === head.count)
    .sort((left, right) => left.index - right.index);
  if (chunks.length !== head.count || chunks.some((chunk, index) => chunk.index !== index)) {
    return { payload: null, error: '分片缺失或序号不连续' };
  }
  const encoded = chunks.map(chunk => chunk.payload).join('');
  if (nativeChecksum(encoded) !== head.checksum) return { payload: null, error: '分片校验和不匹配' };
  const payload = await decodeNativePayload(encoded);
  return payload ? { payload, error: '' } : { payload: null, error: '分片内容无法解码' };
}

async function writeNativeBucket(api, deviceFolder, bucket, payload) {
  const encoded = await encodeNativePayload(payload);
  const chunks = [];
  for (let index = 0; index < encoded.length; index += NATIVE_SYNC_CHUNK_CHARS) {
    chunks.push(encoded.slice(index, index + NATIVE_SYNC_CHUNK_CHARS));
  }
  const generation = Date.now().toString(36) + '-' + (++nativeSyncGeneration).toString(36);
  const checksum = nativeChecksum(encoded);
  for (let index = 0; index < chunks.length; index++) {
    await api.bookmarks.create({
      parentId: deviceFolder.id,
      title: `${NATIVE_SYNC_PROTOCOL}|S|${bucket}|${generation}|${index}|${chunks.length}|${chunks[index]}`
    });
  }
  const current = await api.bookmarks.getChildren(deviceFolder.id);
  const oldHead = findNativeHead(current, bucket);
  const headTitle = `${NATIVE_SYNC_PROTOCOL}|H|${bucket}|${generation}|${chunks.length}|${checksum}`;
  if (oldHead) await api.bookmarks.update(oldHead.node.id, { title: headTitle });
  else await api.bookmarks.create({ parentId: deviceFolder.id, title: headTitle });

  const after = await api.bookmarks.getChildren(deviceFolder.id);
  const staleChunks = after.map(nativeChunkInfo).filter(chunk =>
    chunk && chunk.bucket === bucket && chunk.generation !== generation
  );
  for (const chunk of staleChunks) {
    try { await api.bookmarks.remove(chunk.node.id); } catch (e) { /* 同步乱序时保留旧分片 */ }
  }
}

function nativeRecordsForBucket(records, bucket) {
  const result = {};
  Object.entries(records || {}).forEach(([key, raw]) => {
    if (nativeBucketForUrl(key) !== bucket) return;
    const record = normalizeNativeRecord(raw);
    if (record) result[key] = record;
  });
  return result;
}

function nativeBucketsForRecords(records) {
  const buckets = new Set();
  Object.keys(records || {}).forEach(key => buckets.add(nativeBucketForUrl(key)));
  return buckets;
}

function nativeQueue(task) {
  const result = nativeSyncQueue.then(task, task);
  nativeSyncQueue = result.catch(() => {});
  return result;
}

async function publishNativeSync(api, buckets, includeConfig) {
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return false;
  const tree = await api.bookmarks.getTree();
  const root = findNativeSyncRoot(tree);
  if (!root) throw new Error('未找到书签管家同步数据目录，请重新启用同步');
  const deviceFolder = await ensureNativeDeviceFolder(api, root, state.deviceId);
  const records = await loadNativeSyncRecords(api);
  // null 表示完整发布；空集合仅用于配置变更，不能意外重写所有标签分桶。
  const requested = buckets === null || buckets === undefined ? nativeBucketsForRecords(records) : buckets;
  for (const bucket of requested) {
    await writeNativeBucket(api, deviceFolder, bucket, {
      version: 1,
      type: 'records',
      deviceId: state.deviceId,
      records: nativeRecordsForBucket(records, bucket)
    });
  }
  if (includeConfig) {
    const config = await loadNativeSyncConfig(api);
    if (config) {
      await writeNativeBucket(api, deviceFolder, 'config', {
        version: 1,
        type: 'config',
        deviceId: state.deviceId,
        config
      });
    }
  }
  return true;
}

function mergeNativeRecord(target, key, raw) {
  const record = normalizeNativeRecord(raw);
  if (!record) return;
  const current = target[key];
  if (!current || compareNativeRevision(record.revision, current.revision) > 0) target[key] = record;
}

async function readNativeSyncData(tree) {
  const root = findNativeSyncRoot(tree);
  if (!root) return null;
  const records = {};
  let config = null;
  let maxRevision = [0, 0, ''];
  const errors = [];
  let hasDeviceFolder = false;
  let hasEmptyDeviceFolder = false;
  for (const deviceFolder of root.children || []) {
    const deviceId = nativeDeviceFolderId(deviceFolder);
    if (!deviceId) continue;
    hasDeviceFolder = true;
    const children = deviceFolder.children || [];
    const heads = children.map(nativeHeadInfo).filter(Boolean);
    if (!heads.length) {
      hasEmptyDeviceFolder = true;
      continue;
    }
    for (const head of heads) {
      const result = await readNativeHeadPayload(children, head);
      if (result.error) {
        errors.push(`${deviceId}/${head.bucket}: ${result.error}`);
        continue;
      }
      const payload = result.payload;
      if (!payload || payload.version !== 1 || payload.deviceId !== deviceId) {
        errors.push(`${deviceId}/${head.bucket}: 分片协议内容无效`);
        continue;
      }
      if (payload.type === 'records' && payload.records && typeof payload.records === 'object' && !Array.isArray(payload.records)) {
        Object.entries(payload.records).forEach(([key, record]) => {
          const normalized = normalizeNativeRecord(record);
          if (!normalized) {
            errors.push(`${deviceId}/${head.bucket}: 标签记录内容无效`);
            return;
          }
          mergeNativeRecord(records, key, normalized);
          if (compareNativeRevision(normalized.revision, maxRevision) > 0) maxRevision = normalized.revision;
        });
      } else if (payload.type === 'config') {
        const normalized = normalizeNativeConfig(payload.config);
        if (!normalized) {
          errors.push(`${deviceId}/${head.bucket}: 配置分片内容无效`);
          continue;
        }
        if (!config || compareNativeRevision(normalized.revision, config.revision) > 0) config = normalized;
        if (compareNativeRevision(normalized.revision, maxRevision) > 0) maxRevision = normalized.revision;
      } else {
        errors.push(`${deviceId}/${head.bucket}: 分片类型无效`);
      }
    }
  }
  return {
    root, records, config, maxRevision, errors,
    complete: hasDeviceFolder && !hasEmptyDeviceFolder
  };
}

async function applyNativeSyncData(api, source) {
  const data = await readNativeSyncData(source);
  if (!data) return { changed: false, ready: false, records: {} };
  // 任一分片尚未到达时，不能用其他设备的旧值覆盖本机或抢先写出新修订号。
  // Chrome 书签同步的节点到达顺序不保证，等待下次 hydrate 才是可恢复的选择。
  if (!data.complete || data.errors.length) {
    const reason = data.errors.length ? data.errors[0] : '同步目录尚未完整到达';
    await setBackgroundTagSyncStatus(api, '同步数据不完整或损坏：' + reason);
    return { changed: false, ready: false, records: data.records };
  }
  const stored = await api.storage.local.get([
    TAGS_KEY, FIXED_TAGS_KEY, TAG_RULES_KEY, NATIVE_SYNC_URLS_KEY
  ]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? { ...stored[TAGS_KEY] } : {};
  const nextTags = { ...tags };
  let tagsChanged = false;
  const bookmarks = collectNativeUserBookmarks(source, []);
  bookmarks.forEach(bookmark => {
    const record = data.records[syncUrlKey(bookmark.url)];
    if (!record) return;
    const next = record.tags;
    if (next.length) {
      if (!sameTags(nextTags[bookmark.id] || [], next)) {
        nextTags[bookmark.id] = next;
        tagsChanged = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(nextTags, bookmark.id)) {
      delete nextTags[bookmark.id];
      tagsChanged = true;
    }
  });
  const updates = {};
  if (tagsChanged) updates[TAGS_KEY] = nextTags;
  let configChanged = false;
  if (data.config) {
    const currentConfig = nativeConfigValues(stored[FIXED_TAGS_KEY], stored[TAG_RULES_KEY]);
    if (!sameNativeConfigValues(currentConfig, data.config)) {
      updates[FIXED_TAGS_KEY] = data.config.fixedTags;
      updates[TAG_RULES_KEY] = data.config.tagRules;
      configChanged = true;
    }
    updates[NATIVE_SYNC_CONFIG_KEY] = data.config;
  }
  const state = await loadNativeSyncState(api);
  if (compareNativeRevision(data.maxRevision, [state.clock, state.sequence, state.deviceId]) > 0) {
    state.clock = data.maxRevision[0];
    state.sequence = data.maxRevision[1];
    updates[NATIVE_SYNC_STATE_KEY] = {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: state.seeded
    };
  }
  const currentUrls = nativeBookmarkUrlMap(bookmarks);
  const nextUrls = stored[NATIVE_SYNC_URLS_KEY] && typeof stored[NATIVE_SYNC_URLS_KEY] === 'object'
    ? { ...stored[NATIVE_SYNC_URLS_KEY] } : {};
  // URL 变更事件无法区分本机编辑和远端书签先到。保留首次记录的旧 URL，
  // 只有用户明确修改标签时才同时写旧、新 URL，避免远端到达乱序写出空墓碑。
  Object.entries(currentUrls).forEach(([id, key]) => {
    if (!nextUrls[id]) nextUrls[id] = key;
  });
  if (nativeStableJson(stored[NATIVE_SYNC_URLS_KEY] || {}) !== nativeStableJson(nextUrls)) {
    updates[NATIVE_SYNC_URLS_KEY] = nextUrls;
  }
  if (Object.keys(updates).length) {
    if (tagsChanged) ignoreNativeTagChange(nextTags);
    if (configChanged) ignoreNativeConfigChange({
      fixedTags: data.config.fixedTags,
      tagRules: data.config.tagRules
    });
    nativeSyncApplying = true;
    try { await api.storage.local.set(updates); }
    finally { nativeSyncApplying = false; }
  }
  await setBackgroundTagSyncStatus(api, '');
  return { changed: tagsChanged || configChanged, ready: true, records: data.records };
}

async function publishMissingNativeSyncRecords(api, state, tree, remoteRecords) {
  const stored = await api.storage.local.get([TAGS_KEY, NATIVE_SYNC_RECORDS_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const records = stored[NATIVE_SYNC_RECORDS_KEY] && typeof stored[NATIVE_SYNC_RECORDS_KEY] === 'object'
    ? { ...stored[NATIVE_SYNC_RECORDS_KEY] } : {};
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const keys = new Set();
  bookmarks.forEach(bookmark => {
    const key = syncUrlKey(bookmark.url);
    if (!key || Object.prototype.hasOwnProperty.call(remoteRecords, key)) return;
    if (!normalizeNativeTags(tags[bookmark.id]).length) return;
    keys.add(key);
  });
  updateNativeRecordsForUrls(records, state, bookmarks, tags, keys);
  state.seeded = true;
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: true
    }
  });
  if (keys.size) {
    await publishNativeSync(api, new Set([...keys].map(nativeBucketForUrl)), false);
  }
  return keys.size > 0;
}

async function hydrateNativeSyncResult(api) {
  if (!api.bookmarks || typeof api.bookmarks.getTree !== 'function') {
    return { changed: false, ready: true };
  }
  const state = await loadNativeSyncState(api);
  const tree = await api.bookmarks.getTree();
  const root = findNativeSyncRoot(tree);
  if (!root) {
    if (state.enabled) await setBackgroundTagSyncStatus(api, '未找到书签管家同步数据目录');
    return { changed: false, ready: !state.enabled };
  }
  if (!state.enabled) {
    state.enabled = true;
    await saveNativeSyncState(api, state);
  }
  const result = await applyNativeSyncData(api, tree);
  if (!result.ready) return result;
  const currentState = await loadNativeSyncState(api);
  if (!currentState.seeded) {
    const published = await publishMissingNativeSyncRecords(api, currentState, tree, result.records);
    return { ...result, changed: result.changed || published };
  }
  return result;
}

async function hydrateNativeSync(api) {
  const result = await hydrateNativeSyncResult(api);
  return result.changed;
}

// Chrome 书签同步的元数据目录和普通书签没有固定到达顺序。目录先到时，
// 必须先把远端标签应用到新书签，才能避免默认打标写出一个更新的本机修订号。
async function hydrateNativeSyncBeforeAutoTag(api) {
  return nativeQueue(() => hydrateNativeSyncResult(api));
}

function deferNativeSyncAutoTag(id, bookmark, allowAi) {
  deferredNativeSyncAutoTags.set(String(id), { id, bookmark, allowAi });
}

function discardDeferredNativeSyncAutoTags(node) {
  collectNativeUserBookmarks([node], []).forEach(bookmark => {
    deferredNativeSyncAutoTags.delete(String(bookmark.id));
  });
}

async function flushDeferredNativeSyncAutoTags(result) {
  if (!result.ready || !deferredNativeSyncAutoTags.size) return;
  const entries = [...deferredNativeSyncAutoTags.values()];
  deferredNativeSyncAutoTags.clear();
  entries.forEach(entry => {
    queueBrowserBookmarkAutoTag(entry.id, entry.bookmark, false, entry.allowAi)
      .catch(error => console.warn('[书签管家] 延迟默认打标失败', error));
  });
}

async function seedNativeSyncFromLocal(api, state, tree, replaceRecords) {
  const stored = await api.storage.local.get([TAGS_KEY, FIXED_TAGS_KEY, TAG_RULES_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const records = replaceRecords ? {} : await loadNativeSyncRecords(api);
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const byKey = {};
  bookmarks.forEach(bookmark => {
    const key = syncUrlKey(bookmark.url);
    const values = normalizeNativeTags(tags[bookmark.id]);
    if (!key || !values.length) return;
    byKey[key] = normalizeNativeTags([...(byKey[key] || []), ...values]);
  });
  Object.entries(byKey).forEach(([key, values]) => {
    records[key] = { tags: values, revision: nativeNextRevision(state) };
  });
  const config = {
    revision: nativeNextRevision(state),
    ...nativeConfigValues(stored[FIXED_TAGS_KEY], stored[TAG_RULES_KEY])
  };
  state.seeded = true;
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_CONFIG_KEY]: config,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: true
    }
  });
  return { records, config };
}

async function setNativeSyncEnabled(api, enabled) {
  const state = await loadNativeSyncState(api);
  if (!enabled) {
    state.enabled = false;
    await saveNativeSyncState(api, state);
    await setBackgroundTagSyncStatus(api, '');
    return false;
  }
  const tree = await api.bookmarks.getTree();
  const existingRoot = findNativeSyncRoot(tree);
  await ensureNativeSyncRoot(api, tree);
  state.enabled = true;
  await saveNativeSyncState(api, state);
  if (!existingRoot) {
    // 根目录被误删或首次启用时，以本机当前标签重建一份完整的起始数据。
    await seedNativeSyncFromLocal(api, state, tree, true);
    const records = await loadNativeSyncRecords(api);
    await publishNativeSync(api, nativeBucketsForRecords(records), true);
    await setBackgroundTagSyncStatus(api, '');
  } else {
    await hydrateNativeSync(api);
  }
  return true;
}

async function recordNativeTagChanges(api, change) {
  if (nativeSyncApplying) return;
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return;
  const before = change && change.oldValue && typeof change.oldValue === 'object' ? change.oldValue : {};
  const after = change && change.newValue && typeof change.newValue === 'object' ? change.newValue : {};
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  if (!ids.size) return;
  const tree = await api.bookmarks.getTree();
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const byId = new Map(bookmarks.map(bookmark => [String(bookmark.id), bookmark]));
  const previousUrls = await loadNativeSyncUrls(api);
  const currentUrls = nativeBookmarkUrlMap(bookmarks);
  const affectedKeys = new Set();
  ids.forEach(id => {
    const bookmark = byId.get(String(id));
    if (bookmark) affectedKeys.add(syncUrlKey(bookmark.url));
    if (previousUrls[String(id)]) affectedKeys.add(previousUrls[String(id)]);
  });
  if (!affectedKeys.size) {
    if (nativeStableJson(previousUrls) !== nativeStableJson(currentUrls)) {
      await api.storage.local.set({ [NATIVE_SYNC_URLS_KEY]: currentUrls });
    }
    return;
  }
  const records = await loadNativeSyncRecords(api);
  updateNativeRecordsForUrls(records, state, bookmarks, after, affectedKeys);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: currentUrls,
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: state.seeded
    }
  });
  await publishNativeSync(api, new Set([...affectedKeys].map(nativeBucketForUrl)), false);
}

async function recordNativeConfigChange(api) {
  if (nativeSyncApplying) return;
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return;
  const stored = await api.storage.local.get([FIXED_TAGS_KEY, TAG_RULES_KEY]);
  const config = {
    revision: nativeNextRevision(state),
    ...nativeConfigValues(stored[FIXED_TAGS_KEY], stored[TAG_RULES_KEY])
  };
  await api.storage.local.set({
    [NATIVE_SYNC_CONFIG_KEY]: config,
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: state.seeded
    }
  });
  await publishNativeSync(api, new Set(), true);
}

async function recordNativeBookmarkRemoval(api, node) {
  if (!node || nativeSyncApplying) return;
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return;
  const removedBookmarks = collectNativeUserBookmarks([node], []);
  if (!removedBookmarks.length) return;
  const tree = await api.bookmarks.getTree();
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const stored = await api.storage.local.get([TAGS_KEY, NATIVE_SYNC_URLS_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const previousUrls = stored[NATIVE_SYNC_URLS_KEY] && typeof stored[NATIVE_SYNC_URLS_KEY] === 'object'
    ? stored[NATIVE_SYNC_URLS_KEY] : {};
  const affectedKeys = new Set();
  removedBookmarks.forEach(bookmark => {
    const id = String(bookmark.id || '');
    const key = syncUrlKey(bookmark.url);
    if (key) affectedKeys.add(key);
    if (previousUrls[id]) affectedKeys.add(previousUrls[id]);
  });
  if (!affectedKeys.size) return;
  const records = await loadNativeSyncRecords(api);
  updateNativeRecordsForUrls(records, state, bookmarks, tags, affectedKeys);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: state.seeded
    }
  });
  await publishNativeSync(api, new Set([...affectedKeys].map(nativeBucketForUrl)), false);
}

// 仅由扩展页面在 chrome.bookmarks.update 成功后发起。原生 onChanged 不携带来源，
// 不能据此发布 URL 迁移，否则远端书签先到会生成空墓碑覆盖正确标签。
async function recordNativeBookmarkUrlMigration(api, id, oldUrl, newUrl) {
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return false;
  const oldKey = syncUrlKey(oldUrl);
  const newKey = syncUrlKey(newUrl);
  if (!oldKey || !newKey || oldKey === newKey) return false;
  const tree = await api.bookmarks.getTree();
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const bookmark = bookmarks.find(node => String(node.id) === String(id));
  if (!bookmark || syncUrlKey(bookmark.url) !== newKey) {
    throw new Error('书签地址尚未更新，无法迁移标签');
  }
  const stored = await api.storage.local.get(TAGS_KEY);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const records = await loadNativeSyncRecords(api);
  const affectedKeys = new Set([oldKey, newKey]);
  updateNativeRecordsForUrls(records, state, bookmarks, tags, affectedKeys);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: {
      deviceId: state.deviceId,
      clock: state.clock,
      sequence: state.sequence,
      seeded: state.seeded
    }
  });
  await publishNativeSync(api, new Set([...affectedKeys].map(nativeBucketForUrl)), false);
  return true;
}

function scheduleNativeHydration(api = chrome) {
  if (nativeSyncTimer) clearTimeout(nativeSyncTimer);
  nativeSyncTimer = setTimeout(() => {
    nativeSyncTimer = null;
    nativeQueue(async () => {
      const result = await hydrateNativeSyncResult(api);
      await flushDeferredNativeSyncAutoTags(result);
      return result.changed;
    })
      .catch(error => console.warn('[书签管家] 原生标签同步读取失败', error));
  }, NATIVE_SYNC_DELAY_MS);
}


async function setBackgroundTagSyncStatus(api, lastError) {
  const at = Date.now();
  const status = lastError
    ? { lastError: String(lastError), at }
    : { lastError: '', at, lastSuccessAt: at };
  try {
    await api.storage.local.set({ [SYNC_STATUS_KEY]: status });
  } catch (e) { /* 保留原始同步错误 */ }
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[TAGS_KEY] && !consumeIgnoredNativeTagChange(changes[TAGS_KEY].newValue)) {
      nativeQueue(() => recordNativeTagChanges(chrome, changes[TAGS_KEY]))
        .catch(async error => {
          await setBackgroundTagSyncStatus(chrome, error && error.message || error);
          console.warn('[书签管家] 原生标签同步写入失败', error);
        });
    }
    if ((changes[FIXED_TAGS_KEY] || changes[TAG_RULES_KEY]) && !consumeIgnoredNativeConfigChange(changes)) {
      nativeQueue(() => recordNativeConfigChange(chrome))
        .catch(async error => {
          await setBackgroundTagSyncStatus(chrome, error && error.message || error);
          console.warn('[书签管家] 原生标签配置同步失败', error);
        });
    }
  });
}

function poolTag(pool, name) {
  const normalized = String(name || '').trim().toLowerCase();
  return pool.find(tag => String(tag).toLowerCase() === normalized) || '';
}

function backgroundFixedTagPool(storedTags) {
  let pool = [];
  if (!Array.isArray(storedTags)) {
    pool = [...DEFAULT_FIXED_TAGS];
  } else {
    const isLegacyDefault = storedTags.length === LEGACY_DEFAULT_FIXED_TAGS.length &&
      storedTags.every((tag, index) => tag === LEGACY_DEFAULT_FIXED_TAGS[index]);
    pool = isLegacyDefault ? [...DEFAULT_FIXED_TAGS] : [...new Set(storedTags)];
  }
  if (!pool.includes(FALLBACK_TAG)) pool.push(FALLBACK_TAG);
  return pool.slice(0, MAX_FIXED_TAGS);
}

function domainTagsForBookmark(bookmark, pool) {
  let host = '';
  try { host = new URL(bookmark.url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return []; }
  const tags = [];
  const add = name => {
    const tag = poolTag(pool, name);
    if (tag && tag !== FALLBACK_TAG && !tags.includes(tag) && tags.length < 3) tags.push(tag);
  };
  DOMAIN_TAG_RULES.forEach(rule => {
    if (rule.signals.some(signal => host.includes(signal))) rule.tags.forEach(add);
  });
  return tags;
}

function normalizeBackgroundTagRules(raw, legacyGroups) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const normalizeMap = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([rawKey, rawTags]) => {
      const key = String(rawKey || '').trim();
      const values = Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(/[,，、;；]/);
      const tags = [...new Set(values.map(tag => String(tag || '').trim()).filter(Boolean))];
      return key && tags.length ? [[key, tags]] : [];
    }));
  };
  const domain = normalizeMap(raw.domain);
  if (legacyGroups && typeof legacyGroups === 'object' && !Array.isArray(legacyGroups)) {
    Object.entries(legacyGroups).forEach(([rawDomain, rawCategory]) => {
      const name = String(rawDomain || '').trim().toLowerCase().replace(/^www\./, '');
      const category = String(rawCategory || '').trim();
      if (!name || !category || Object.keys(domain).some(key => key.toLowerCase() === name)) return;
      domain[name] = [category];
    });
  }
  return { domain, keyword: normalizeMap(raw.keyword) };
}

function customTagsForBookmark(bookmark, rules, pool) {
  let host = '';
  let pathname = '';
  try {
    const url = new URL(bookmark.url);
    host = url.hostname.toLowerCase().replace(/^www\./, '');
    try { pathname = decodeURIComponent(url.pathname); }
    catch (e) { pathname = url.pathname; }
  } catch (e) { /* 无效 URL 仍允许标题匹配 */ }
  const keywordText = [bookmark.title || '', host, pathname].join(' ').toLowerCase();
  const match = (map, text) => {
    const tags = [];
    Object.entries(map).forEach(([signal, values]) => {
      if (!text.includes(signal.toLowerCase())) return;
      values.forEach(value => {
        const tag = poolTag(pool, value);
        if (tag && tag !== FALLBACK_TAG && !tags.includes(tag) && tags.length < MAX_TAGS_PER_BOOKMARK) tags.push(tag);
      });
    });
    return tags;
  };
  const normalized = normalizeBackgroundTagRules(rules);
  return { domain: match(normalized.domain, host), keyword: match(normalized.keyword, keywordText) };
}

function defaultTagsForBookmark(bookmark, fixedTags, tagRules) {
  const pool = Array.isArray(fixedTags) && fixedTags.length ? [...new Set(fixedTags)] : [...DEFAULT_FIXED_TAGS];
  if (!pool.includes(FALLBACK_TAG)) pool.push(FALLBACK_TAG);
  let host = '';
  let pathname = '';
  try {
    const url = new URL(bookmark.url);
    host = url.hostname;
    pathname = url.pathname;
  } catch (e) { /* keep empty */ }
  const text = (host + ' ' + pathname + ' ' + (bookmark.title || '')).toLowerCase();
  const tags = [];
  const add = tag => {
    if (tag && tag !== FALLBACK_TAG && !tags.includes(tag) && tags.length < MAX_TAGS_PER_BOOKMARK) tags.push(tag);
  };
  const custom = customTagsForBookmark(bookmark, tagRules, pool);
  custom.domain.forEach(add);
  const domainTags = domainTagsForBookmark(bookmark, pool);
  domainTags.forEach(add);
  custom.keyword.forEach(add);
  const highConfidence = !!custom.domain.length || !!domainTags.length || !!custom.keyword.length;
  if (!highConfidence) {
    BACKGROUND_TAG_HINTS.forEach(([tag, hints]) => {
      if (hints.some(hint => text.includes(hint))) add(poolTag(pool, tag));
    });
    pool.forEach(tag => {
      const normalized = String(tag).toLowerCase();
      if (normalized === FALLBACK_TAG || normalized.length < 3 || tags.length >= 3) return;
      if (text.includes(normalized)) add(tag);
    });
  }
  return { tags: tags.length ? tags : [FALLBACK_TAG], highConfidence };
}

function sanitizeUrlForBackgroundAI(rawUrl) {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.origin + url.pathname;
}

function isBackgroundAiEligible(bookmark) {
  let url;
  try { url = new URL(bookmark.url); } catch (e) { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const loginSignals = new Set(['login', 'signin', 'sign-in', 'auth', 'sso', 'oauth', 'passport', 'accounts']);
  const hostLabels = url.hostname.toLowerCase().split('.');
  if (hostLabels.some(label => loginSignals.has(label))) return false;
  const loginPath = url.pathname.split('/').filter(Boolean).some(segment => {
    try { segment = decodeURIComponent(segment); } catch (e) { /* keep original */ }
    return loginSignals.has(segment.toLowerCase().replace(/\.(?:html?|php|aspx?)$/, ''));
  });
  if (loginPath) return false;
  const sensitiveKeys = new Set([
    'token', 'access_token', 'refresh_token', 'session', 'sess', 'sid', 'phpsessid', 'jsessionid',
    'password', 'pwd', 'passwd', 'api_key', 'apikey', 'secret', 'authorization', 'code', 'ticket', 'jwt', 'bearer'
  ]);
  const parameterSources = [url.search.slice(1), url.hash.slice(1)];
  const fragmentQuery = url.hash.indexOf('?');
  if (fragmentQuery >= 0) parameterSources.push(url.hash.slice(fragmentQuery + 1));
  if (parameterSources.some(source => {
    const params = new URLSearchParams(source);
    for (const [key, value] of params) {
      if (sensitiveKeys.has(key.toLowerCase()) && value) return true;
    }
    return false;
  })) return false;
  const financialLabels = new Set([
    'bank', 'banking', 'paypal', 'alipay', 'metamask', 'binance', 'coinbase', 'okx', 'kraken', 'bybit'
  ]);
  if (hostLabels.some(label => financialLabels.has(label))) return false;
  return !/(网上银行|银行账户|支付账户|证券账户|加密钱包|数字钱包|crypto wallet)/i.test(bookmark.title || '');
}

function normalizeBackgroundLlmBaseUrl(rawBaseUrl) {
  const url = new URL(String(rawBaseUrl || '').trim());
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('LLM 服务必须使用 HTTPS；本地服务仅允许回环地址');
  }
  return url.href.replace(/\/+$/, '');
}

function backgroundChatEndpoints(rawBaseUrl) {
  const base = normalizeBackgroundLlmBaseUrl(rawBaseUrl);
  const endpoints = [base + '/chat/completions'];
  if (base.endsWith('/v1')) endpoints.push(base.replace(/\/v1$/, '') + '/chat/completions');
  else endpoints.push(base + '/v1/chat/completions');
  return [...new Set(endpoints)];
}

function parseBackgroundAiTags(content, items, pool) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const parsed = JSON.parse(text);
  const allowedIds = new Set(items.map(item => String(item.id)));
  const out = {};
  const collect = (id, values) => {
    id = String(id);
    if (!allowedIds.has(id)) return;
    if (!Array.isArray(values)) values = typeof values === 'string' ? values.split(/[,，、;；]/) : [];
    const tags = [];
    values.forEach(value => {
      const tag = poolTag(pool, value);
      if (tag && tag !== FALLBACK_TAG && !tags.includes(tag) && tags.length < 3) tags.push(tag);
    });
    if (tags.length) out[id] = tags;
  };
  const rows = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data);
  if (Array.isArray(rows)) rows.forEach(row => {
    if (row && row.id != null) collect(row.id, row.tags != null ? row.tags : row.tag);
  });
  else if (parsed && typeof parsed === 'object') Object.keys(parsed).forEach(id => collect(id, parsed[id]));
  return out;
}

async function requestBackgroundAiTags(items, cfg, pool) {
  const eligible = items.filter(isBackgroundAiEligible);
  if (!eligible.length) return {};
  const candidates = pool.filter(tag => tag !== FALLBACK_TAG);
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: [
        '你是浏览器书签打标签助手。根据域名、路径和标题判断站点实际用途。',
        '从候选标签中选择 1-3 个，不得自创。代码托管选代码，论坛平台选论坛，设计协作选设计/工作，组网或运维平台选运维/工具。',
        '候选标签：' + candidates.join('、') + '。只返回 JSON：{"results":[{"id":"<id>","tags":["标签"]}]}'
      ].join('\n') },
      { role: 'user', content: eligible.map((item, index) =>
        `${index + 1}. [id=${item.id}] ${(item.title || '').slice(0, 80)} — ${sanitizeUrlForBackgroundAI(item.url)}`
      ).join('\n') }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };
  let lastError = null;
  for (const endpoint of backgroundChatEndpoints(cfg.baseUrl)) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify(body)
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || type.includes('text/html') || type.includes('text/plain')) {
        lastError = new Error('LLM 端点返回 HTTP ' + response.status);
        if (response.status === 401 || response.status === 403) break;
        continue;
      }
      const data = await response.json();
      const message = data && data.choices && data.choices[0] && data.choices[0].message;
      const content = message && message.content;
      if (!content) throw new Error('LLM 响应缺少标签内容');
      return parseBackgroundAiTags(content, eligible, pool);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('LLM 后台打标失败');
}

function mergeAutoTags(localTags, aiTags) {
  const merged = [...new Set([...(localTags || []), ...(aiTags || [])])];
  const meaningful = merged.filter(tag => tag !== FALLBACK_TAG);
  return (meaningful.length ? meaningful : merged).slice(0, MAX_TAGS_PER_BOOKMARK);
}

function sameTags(left, right) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function applyTagChanges(tags, changes) {
  let changed = false;
  Object.entries(changes || {}).forEach(([id, value]) => {
    const next = Array.isArray(value)
      ? [...new Set(value.filter(tag => typeof tag === 'string' && tag.trim()))].slice(0, 6)
      : null;
    const current = tags[id] || [];
    if (next && next.length) {
      if (!sameTags(current, next)) {
        tags[id] = next;
        changed = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(tags, id)) {
      delete tags[id];
      changed = true;
    }
  });
  return changed;
}

function mergeTagChanges(tags, changes) {
  const next = {};
  Object.entries(changes || {}).forEach(([id, value]) => {
    if (!Array.isArray(value)) return;
    next[id] = [...new Set([...(tags[id] || []), ...value])].slice(0, 6);
  });
  return applyTagChanges(tags, next);
}

function removeTagChanges(tags, changes) {
  const next = {};
  Object.entries(changes || {}).forEach(([id, value]) => {
    if (!Array.isArray(value) || !tags[id]) return;
    const remove = new Set(value);
    next[id] = tags[id].filter(tag => !remove.has(tag));
  });
  return applyTagChanges(tags, next);
}

async function mutateTags(mutator) {
  return queueTagMutation(async () => {
    const stored = await chrome.storage.local.get([TAGS_KEY, FIXED_TAGS_KEY]) || {};
    const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? { ...stored[TAGS_KEY] } : {};
    const changed = await mutator(tags, stored);
    if (changed) await chrome.storage.local.set({ [TAGS_KEY]: tags });
    return { changed, tags };
  });
}

function commitTagChanges(changes, mode) {
  return mutateTags(tags => {
    if (mode === 'merge') return mergeTagChanges(tags, changes);
    if (mode === 'remove') return removeTagChanges(tags, changes);
    return applyTagChanges(tags, changes);
  });
}

async function autoTagBrowserBookmarks(entries) {
  const stored = await chrome.storage.local.get([
    FIXED_TAGS_KEY, TAG_RULES_KEY, 'bmDomainGroups', LEGACY_DOMAIN_GROUPS_MIGRATED_KEY,
    'bmSettings', AUTO_AI_TAG_KEY
  ]) || {};
  const pool = backgroundFixedTagPool(stored[FIXED_TAGS_KEY]);
  const rules = normalizeBackgroundTagRules(
    stored[TAG_RULES_KEY],
    stored[LEGACY_DOMAIN_GROUPS_MIGRATED_KEY] ? null : stored.bmDomainGroups
  );
  const changes = {};
  const aiCandidates = [];
  entries.forEach(([id, bookmark, allowAi]) => {
    const local = defaultTagsForBookmark(bookmark, pool, rules);
    changes[id] = local.tags;
    if (allowAi && stored[AUTO_AI_TAG_KEY] === true && !local.highConfidence) {
      aiCandidates.push({ id, title: bookmark.title || '', url: bookmark.url });
    }
  });
  const localResult = await mutateTags(tags => {
    const missingOnly = {};
    Object.entries(changes).forEach(([id, values]) => {
      if (!Object.prototype.hasOwnProperty.call(tags, id)) missingOnly[id] = values;
    });
    return applyTagChanges(tags, missingOnly);
  });
  const cfg = stored.bmSettings || {};
  if (aiCandidates.length && cfg.apiKey && cfg.baseUrl && cfg.model) {
    try {
      const aiTags = await requestBackgroundAiTags(aiCandidates, cfg, pool);
      return mutateTags(tags => {
        const merged = {};
        aiCandidates.forEach(item => {
          if (aiTags[item.id] && sameTags(tags[item.id] || [], changes[item.id])) {
            merged[item.id] = mergeAutoTags(tags[item.id], aiTags[item.id]);
          }
        });
        return applyTagChanges(tags, merged);
      });
    } catch (e) {
      console.warn('[书签管家] 后台 AI 打标失败，已使用本地规则', e);
    }
  }
  return localResult;
}

function scheduleAutoTagFlush() {
  if (nativeBookmarkImportInProgress || autoTagFlushTimer) return;
  autoTagFlushTimer = setTimeout(() => {
    autoTagFlushTimer = null;
    flushPendingAutoTags().catch(e => console.warn('[书签管家] 浏览器收藏默认打标失败', e));
  }, AUTO_TAG_BATCH_DELAY_MS);
}

function queueBrowserBookmarkAutoTag(id, bookmark, deferFlush, allowAi) {
  return new Promise((resolve, reject) => {
    const entry = pendingAutoTags.get(id) || { bookmark, allowAi: false, waiters: [] };
    entry.bookmark = bookmark;
    entry.allowAi = entry.allowAi || allowAi;
    entry.waiters.push({ resolve, reject });
    pendingAutoTags.set(id, entry);
    if (!deferFlush) scheduleAutoTagFlush();
  });
}

async function flushPendingAutoTags() {
  if (nativeBookmarkImportInProgress || !pendingAutoTags.size) return;
  const entries = [...pendingAutoTags.entries()];
  pendingAutoTags.clear();
  try {
    const result = await autoTagBrowserBookmarks(entries.map(([id, entry]) => [id, entry.bookmark, entry.allowAi]));
    entries.forEach(([, entry]) => entry.waiters.forEach(waiter => waiter.resolve(result)));
  } catch (e) {
    entries.forEach(([, entry]) => entry.waiters.forEach(waiter => waiter.reject(e)));
    throw e;
  }
}

function flushNativeImportAutoTagsIfReady() {
  if (nativeBookmarkImportInProgress || !nativeBookmarkImportEnded || nativeImportCreatedInFlight) return;
  nativeBookmarkImportEnded = false;
  flushPendingAutoTags().catch(e => console.warn('[书签管家] 原生导入默认打标失败', e));
}

function pruneBackupImportTokens(now) {
  backupImportTokens.forEach((tokens, key) => {
    const valid = tokens.filter(token => token.until > now);
    if (valid.length) backupImportTokens.set(key, valid);
    else backupImportTokens.delete(key);
  });
}

function removeBackupImportToken(key, token) {
  const tokens = backupImportTokens.get(key) || [];
  const next = tokens.filter(item => item !== token);
  if (next.length) backupImportTokens.set(key, next);
  else backupImportTokens.delete(key);
}

function notifyBackupImportWaiters(key) {
  const waiters = backupImportWaiters.get(key);
  if (!waiters) return;
  backupImportWaiters.delete(key);
  waiters.forEach(resolve => resolve());
}

function waitForBackupImportConfirmation(key) {
  return new Promise(resolve => {
    const waiters = backupImportWaiters.get(key) || new Set();
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      if (!waiters.size) backupImportWaiters.delete(key);
      resolve();
    };
    const timer = setTimeout(done, BACKUP_IMPORT_CONFIRM_WAIT_MS);
    waiters.add(done);
    backupImportWaiters.set(key, waiters);
  });
}

async function consumeCreationToken(key, bookmarkId) {
  const now = Date.now();
  pruneBackupImportTokens(now);
  const tokens = backupImportTokens.get(key);
  if (!tokens || !tokens.length) return false;
  let token = tokens.find(item => item.bookmarkId === bookmarkId);
  if (token) {
    removeBackupImportToken(key, token);
    return true;
  }
  if (!tokens.some(item => !item.bookmarkId)) return false;

  await waitForBackupImportConfirmation(key);
  pruneBackupImportTokens(Date.now());
  token = (backupImportTokens.get(key) || []).find(item => item.bookmarkId === bookmarkId);
  if (!token) return false;
  removeBackupImportToken(key, token);
  return true;
}

function consumeBackupImportToken(parentId, url, bookmarkId) {
  return consumeCreationToken(backupImportTokenKey(parentId, url), bookmarkId);
}

function consumeSelfCreationToken(parentId, url, bookmarkId) {
  return consumeCreationToken(selfCreationTokenKey(parentId, url), bookmarkId);
}

// 恢复页和插件手动新增都会在创建前登记精确令牌；onCreated 仅跳过确认的那一项。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
  if (message.type === NATIVE_SYNC_MESSAGE) {
    const action = message.action;
    let task;
    if (action === 'setEnabled') task = nativeQueue(() => setNativeSyncEnabled(chrome, !!message.enabled));
    else if (action === 'hydrate') task = nativeQueue(() => hydrateNativeSync(chrome));
    else if (action === 'publish') task = nativeQueue(() => publishNativeSync(chrome, null, !!message.includeConfig));
    else if (action === 'migrateUrl') {
      task = nativeQueue(() => recordNativeBookmarkUrlMigration(chrome, message.id, message.oldUrl, message.newUrl));
    }
    else task = nativeQueue(() => hydrateNativeSync(chrome));
    task.then(changed => sendResponse({ ok: true, changed: !!changed }))
      .catch(async error => {
        await setBackgroundTagSyncStatus(chrome, error && error.message || error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message.type === TAG_MUTATION_MESSAGE) {
    commitTagChanges(message.changes, message.mode)
      .then(result => sendResponse({ ok: true, changed: result.changed }))
      .catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if ((message.type !== BACKUP_IMPORT_MESSAGE && message.type !== SELF_CREATION_MESSAGE) || !message.url) return;
  const now = Date.now();
  pruneBackupImportTokens(now);
  const key = message.type === SELF_CREATION_MESSAGE
    ? selfCreationTokenKey(message.parentId, message.url)
    : backupImportTokenKey(message.parentId, message.url);
  const tokens = backupImportTokens.get(key) || [];
  if (message.action === 'reserve') {
    tokens.push({ until: now + BACKUP_IMPORT_TOKEN_TTL_MS, bookmarkId: null });
    backupImportTokens.set(key, tokens);
    sendResponse({ ok: true });
  } else if (message.action === 'confirm' && message.bookmarkId) {
    const token = tokens.find(item => !item.bookmarkId);
    if (token) token.bookmarkId = message.bookmarkId;
    notifyBackupImportWaiters(key);
    sendResponse({ ok: !!token });
  } else if (message.action === 'cancel') {
    const token = [...tokens].reverse().find(item => !item.bookmarkId);
    if (token) removeBackupImportToken(key, token);
    notifyBackupImportWaiters(key);
    sendResponse({ ok: true });
  }
});

chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  // 1. 跳过文件夹（folder 没有 url）
  if (!bookmark || !bookmark.url) {
    scheduleNativeHydration();
    return;
  }
  const fromNativeImport = nativeBookmarkImportInProgress;
  let autoTagTask = null;
  if (fromNativeImport) nativeImportCreatedInFlight++;
  try {
    // 2. 跳过恢复流程预先登记的精确创建事件，其他用户收藏照常接管。
    if (await consumeBackupImportToken(bookmark.parentId, bookmark.url, id)) return;
    // 3. 跳过插件内 ➕ 保存已确认的精确创建，不能以 URL 窗口模糊判断。
    if (await consumeSelfCreationToken(bookmark.parentId, bookmark.url, id)) return;
    // 4. 用户可在选项页关闭接管
    try {
      const cfg = await chrome.storage.local.get(STAR_HOOK_KEY);
      if (cfg[STAR_HOOK_KEY] === false) return;
    } catch (e) { /* noop */ }
    // 5. 已启用同步时，先应用可能已经到达的远端标签；原生导入保留批处理，
    // 避免为每个导入项重复读取整棵书签树。
    let nativeSyncReady = true;
    if (!fromNativeImport) {
      try {
        const hydration = await hydrateNativeSyncBeforeAutoTag(chrome);
        nativeSyncReady = hydration.ready;
      }
      catch (e) { console.warn('[书签管家] 收藏前读取原生标签同步失败', e); }
    }
    // 6. 同步分片未完整到达时，默认打标必须等待，不能抢先发布更高本机修订号。
    if (nativeSyncReady || fromNativeImport) {
      autoTagTask = queueBrowserBookmarkAutoTag(id, bookmark, fromNativeImport, !fromNativeImport);
    } else {
      deferNativeSyncAutoTag(id, bookmark, true);
    }
  } finally {
    // 远端书签和内部同步目录到达没有固定先后顺序。延迟拉取能让稍后到达的
    // URL 记录应用到新书签；本地收藏仍照常走下面的默认打标。
    scheduleNativeHydration();
    if (fromNativeImport) {
      nativeImportCreatedInFlight--;
      flushNativeImportAutoTagsIfReady();
    }
  }
  try { if (autoTagTask) await autoTagTask; }
  catch (e) { console.warn('[书签管家] 浏览器收藏默认打标失败', e); }
});

// Chrome 原生导入会连续触发大量 onCreated。导入期间先积压，结束后整批落一次标签表。
if (chrome.bookmarks.onImportBegan && chrome.bookmarks.onImportEnded) {
  chrome.bookmarks.onImportBegan.addListener(() => {
    nativeBookmarkImportInProgress = true;
    nativeBookmarkImportEnded = false;
    if (autoTagFlushTimer) {
      clearTimeout(autoTagFlushTimer);
      autoTagFlushTimer = null;
    }
  });
  chrome.bookmarks.onImportEnded.addListener(() => {
    nativeBookmarkImportInProgress = false;
    nativeBookmarkImportEnded = true;
    flushNativeImportAutoTagsIfReady();
  });
}

// 书签原生同步会以普通书签事件抵达。延迟合并可同时处理多分片到达和事件乱序。
chrome.bookmarks.onChanged.addListener(() => {
  scheduleNativeHydration();
});
chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  discardDeferredNativeSyncAutoTags(removeInfo && removeInfo.node);
  scheduleNativeHydration();
  nativeQueue(() => recordNativeBookmarkRemoval(chrome, removeInfo && removeInfo.node))
    .catch(async error => {
      await setBackgroundTagSyncStatus(chrome, error && error.message || error);
      console.warn('[书签管家] 原生标签删除同步失败', error);
    });
});
chrome.bookmarks.onMoved.addListener(() => { scheduleNativeHydration(); });

if (chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => { scheduleNativeHydration(); });
}
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => { scheduleNativeHydration(); });
}

// ---- 回收站：每天清理超过 30 天的已删除书签记录（真正永久删除）----
// 注意：MV3 Service Worker 不支持 importScripts()（Chrome 121+ 已移除），
// 且 background.js 位于 js/ 子目录，importScripts 相对路径会解析失败导致
// "Service worker registration failed"。故此处内联实现清理逻辑。
// ⚠️ 一致性约束（DRY 技术债）：以下 TRASH_KEY / TRASH_TTL_DAYS / purgeExpiredTrash
//    必须与 lib.js 的 BM.purgeExpiredTrash() 保持同一规则（bmTrash / 30 天）。
//    后续若迁移到 "type": "module"（需 lib.js 同步改造为 ESM），可直接
//    `import { BM } from './lib.js'` 消除双轨——列为技术债，当前保持经典脚本。
const TRASH_KEY = 'bmTrash';
const TRASH_MAX = 5000;
const TRASH_TTL_DAYS = 30;
const TRASH_MUTATION_MESSAGE = 'bmTrashMutation';
const DELETE_PENDING_GRACE_MS = 15000;
const DELETE_HEARTBEAT_TIMEOUT_MS = 30000;
let trashMutationQueue = Promise.resolve();
const activeTrashDeletes = new Map();

function queueTrashMutation(task) {
  const result = trashMutationQueue.then(task, task);
  trashMutationQueue = result.catch(() => {});
  return result;
}

async function readTrash() {
  const stored = await chrome.storage.local.get(TRASH_KEY);
  return Array.isArray(stored[TRASH_KEY]) ? stored[TRASH_KEY] : [];
}

function trashTitle(item) {
  return (item.title || '').trim() || item.url;
}

function touchActiveTrashDeletes(ids) {
  const until = Date.now() + DELETE_HEARTBEAT_TIMEOUT_MS;
  (ids || []).forEach(id => {
    if (id) activeTrashDeletes.set(id, until);
  });
}

function isTrashDeleteActive(trash) {
  const until = activeTrashDeletes.get(trash.id) || 0;
  if (until > Date.now()) return true;
  activeTrashDeletes.delete(trash.id);
  return false;
}

function isTrashDeleteWithinGracePeriod(trash) {
  return Number(trash.deletionPendingAt) > 0
    && Date.now() - trash.deletionPendingAt < DELETE_PENDING_GRACE_MS;
}

function isBookmarkNotFoundError(error) {
  const message = String(error && (error.message || error)).toLowerCase();
  return /not\s*found|can't find|cannot find|does not exist|找不到|未找到|不存在/.test(message);
}

async function findOriginalTrashBookmark(trash) {
  if (!trash.id) return null;
  let matches;
  try {
    matches = await chrome.bookmarks.get(trash.id);
  } catch (e) {
    if (isBookmarkNotFoundError(e)) return null;
    throw e;
  }
  const original = Array.isArray(matches) ? matches[0] : matches;
  return original && original.id === trash.id ? original : null;
}

async function findPreviouslyRestoredBookmark(trash) {
  if (!trash.restoreStartedAt) return null;
  const matches = await chrome.bookmarks.search({ url: trash.url });
  return matches.find(item => item.url === trash.url
    && item.title === trashTitle(trash)
    && item.dateAdded >= trash.restoreStartedAt) || null;
}

async function createRestoredBookmark(info) {
  const now = Date.now();
  const key = backupImportTokenKey(info.parentId, info.url);
  const token = { until: now + BACKUP_IMPORT_TOKEN_TTL_MS, bookmarkId: null };
  const tokens = backupImportTokens.get(key) || [];
  tokens.push(token);
  backupImportTokens.set(key, tokens);
  try {
    const created = await chrome.bookmarks.create(info);
    token.bookmarkId = created.id;
    notifyBackupImportWaiters(key);
    return created;
  } catch (e) {
    removeBackupImportToken(key, token);
    notifyBackupImportWaiters(key);
    throw e;
  }
}

async function restoreTrashItems(ids) {
  const selectedIds = new Set(ids || []);
  let list = await readTrash();
  const now = Date.now();
  const pending = list.filter(item => selectedIds.has(item.id));
  if (!pending.length) return { restored: 0, fallback: 0, failed: [], total: 0 };

  let fallbackParentId = '';
  const getFallbackParentId = async () => {
    if (fallbackParentId) return fallbackParentId;
    const tree = await chrome.bookmarks.getTree();
    const bar = tree[0].children && tree[0].children[0];
    fallbackParentId = bar ? bar.id : '1';
    return fallbackParentId;
  };
  let restored = 0;
  let fallback = 0;
  const failed = [];
  for (let trash of pending) {
    let restoredToFallback = false;
    let created;
    try {
      // 删除失败且回收站记录清理也失败时，原书签可能仍在。此时只丢弃残留记录，
      // 不能再创建一个标题和链接相同的副本。
      const original = await findOriginalTrashBookmark(trash);
      if (original && trash.deletionPending
        && (isTrashDeleteActive(trash) || isTrashDeleteWithinGracePeriod(trash))) {
        // 侧边栏仍在删除原书签；保留记录，等待删除结果的批量收尾操作完成。
        failed.push({ id: trash.id, error: '书签删除仍在进行，请稍后重试' });
        continue;
      }
      created = original || await findPreviouslyRestoredBookmark(trash);
    } catch (e) {
      // 恢复前必须先核验；查询失败时保留记录，以免盲目创建副本。
      failed.push({ id: trash.id, error: e.message || String(e) });
      continue;
    }
    if (!created) {
      if (!trash.restoreStartedAt) {
        // 仅在即将创建前落盘标记。删除进行中的恢复请求不应污染后续恢复判定。
        const markedTrash = { ...trash, restoreStartedAt: now };
        const next = list.map(item => item.id === trash.id ? markedTrash : item);
        try {
          await chrome.storage.local.set({ [TRASH_KEY]: next });
          list = next;
          trash = markedTrash;
        } catch (e) {
          failed.push({ id: trash.id, error: e.message || String(e) });
          continue;
        }
      }
      if (trash.parentId) {
        try {
          created = await createRestoredBookmark({
            parentId: trash.parentId,
            title: trashTitle(trash),
            url: trash.url
          });
        } catch (e) { /* 原文件夹不存在或无法创建时回退书签栏 */ }
      }
      if (!created) {
        try {
          created = await createRestoredBookmark({
            parentId: await getFallbackParentId(),
            title: trashTitle(trash),
            url: trash.url
          });
          restoredToFallback = true;
        } catch (e) {
          failed.push({ id: trash.id, error: e.message || String(e) });
          continue;
        }
      }
    }
    const next = list.filter(item => item.id !== trash.id);
    try {
      await chrome.storage.local.set({ [TRASH_KEY]: next });
      list = next;
      restored++;
      if (restoredToFallback) fallback++;
    } catch (e) {
      // 创建结果已由恢复标记保护；下次恢复会先查找该书签，不会再次创建。
      return { restored, fallback, failed, total: pending.length, persistenceError: e.message || String(e) };
    }
  }
  return { restored, fallback, failed, total: pending.length };
}

async function mutateTrash(action, payload) {
  if (action === 'heartbeatDelete') {
    touchActiveTrashDeletes(payload.ids);
    return { active: (payload.ids || []).length };
  }
  const list = await readTrash();
  if (action === 'add') {
    const now = Date.now();
    const cutoff = now - TRASH_TTL_DAYS * 86400000;
    const active = list.filter(item => item.deletedAt > cutoff);
    const seen = new Set(active.map(item => item.id));
    const fresh = [];
    (payload.items || []).forEach(item => {
      if (!item || !item.url || seen.has(item.id)) return;
      seen.add(item.id);
      fresh.push({
        id: item.id,
        title: (item.title || '').trim() || item.url,
        url: item.url,
        parentId: item.parentId || '',
        path: item.path || [],
        deletedAt: now,
        ...(payload.deletionPending ? {
          deletionPending: true,
          deletionPendingAt: now
        } : {})
      });
    });
    if (fresh.length > TRASH_MAX) {
      throw new Error('单次删除超过回收站上限，请分批处理');
    }
    if (fresh.length) {
      await chrome.storage.local.set({ [TRASH_KEY]: fresh.concat(active).slice(0, TRASH_MAX) });
      if (payload.deletionPending) touchActiveTrashDeletes(fresh.map(item => item.id));
    }
    return { added: fresh.length };
  }
  if (action === 'restore') return restoreTrashItems(payload.ids);
  if (action === 'completeDelete') {
    const removedIds = new Set(payload.removedIds || []);
    const failedIds = new Set(payload.failedIds || []);
    let completed = 0;
    let discarded = 0;
    const next = [];
    list.forEach(item => {
      if (failedIds.has(item.id)) {
        discarded++;
        return;
      }
      if (removedIds.has(item.id) && item.deletionPending) {
        completed++;
        next.push({ ...item, deletionPending: false });
        return;
      }
      next.push(item);
    });
    if (completed || discarded) await chrome.storage.local.set({ [TRASH_KEY]: next });
    [...removedIds, ...failedIds].forEach(id => activeTrashDeletes.delete(id));
    return { completed, discarded };
  }
  if (action === 'discard') {
    const next = list.filter(item => item.id !== payload.id);
    if (next.length !== list.length) await chrome.storage.local.set({ [TRASH_KEY]: next });
    return { discarded: list.length - next.length };
  }
  if (action === 'clear') {
    if (list.length) await chrome.storage.local.set({ [TRASH_KEY]: [] });
    return { cleared: list.length };
  }
  if (action === 'purge') {
    const cutoff = Date.now() - TRASH_TTL_DAYS * 86400000;
    const next = list.filter(item => item.deletedAt > cutoff);
    if (next.length !== list.length) await chrome.storage.local.set({ [TRASH_KEY]: next });
    return { purged: list.length - next.length };
  }
  throw new Error('未知回收站操作');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== TRASH_MUTATION_MESSAGE) return;
  queueTrashMutation(() => mutateTrash(message.action, message))
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function purgeExpiredTrash() {
  try {
    const result = await queueTrashMutation(() => mutateTrash('purge', {}));
    return result.purged;
  } catch (e) { return 0; }
}
chrome.alarms.create('bm-trash-purge', { periodInMinutes: 60 * 24 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'bm-trash-purge') return;
  purgeExpiredTrash()
    .then(n => { if (n) console.log('[书签管家] 回收站已自动清理 ' + n + ' 条过期项'); })
    .catch(err => console.warn('[书签管家] 回收站定时清理失败', err));
});

// 保留极简后台：书签读写都在侧边栏内通过 chrome.bookmarks API 完成。
chrome.runtime.onStartup.addListener(() => {
  console.log('[书签管家] 浏览器启动');
});
