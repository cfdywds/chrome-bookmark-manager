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
const HIDDEN_KEY = 'bmHiddenIds';
const FIXED_TAGS_KEY = 'bmFixedTags';
const TAG_RULES_KEY = 'bmTagRules';
const LEGACY_DOMAIN_GROUPS_MIGRATED_KEY = 'bmDomainGroupsMigrated';
const TAG_MUTATION_MESSAGE = 'bmTagMutation';
// 插件内 ➕ 新增不会走 onCreated 打标（创建令牌已确认跳过），完成后按需请求后台补齐一次。
const AUTO_TAG_MESSAGE = 'bmAutoTagBookmark';
const FALLBACK_TAG = '其他';
const MAX_FIXED_TAGS = 50;
const MAX_TAGS_PER_BOOKMARK = 6;
const AUTO_TAG_BATCH_DELAY_MS = 200;
const SYNC_STATUS_KEY = 'bmTagSyncStatus';
const NATIVE_SYNC_ENABLED_KEY = 'bmNativeTagSyncEnabled';
const NATIVE_SYNC_REQUEST_KEY = 'bmNativeTagSyncRequest';
const NATIVE_SYNC_COMPLETED_REQUEST_KEY = 'bmNativeTagSyncCompletedRequest';
const NATIVE_SYNC_STATE_KEY = 'bmNativeTagSyncState';
const NATIVE_SYNC_RECORDS_KEY = 'bmNativeTagSyncRecords';
const NATIVE_SYNC_CONFIG_KEY = 'bmNativeTagSyncConfig';
const NATIVE_SYNC_CONFIG_REQUEST_KEY = 'bmNativeTagSyncConfigRequest';
const NATIVE_SYNC_URLS_KEY = 'bmNativeTagSyncUrls';
const NATIVE_SYNC_ROOT_TITLE = '书签管家同步数据（请勿修改）';
const NATIVE_SYNC_PROTOCOL = 'BMN1';
const NATIVE_SYNC_BUCKETS = 32;
// 同步节点存放在书签标题中。保守控制在常见浏览器标题限制以内，
// 为协议字段预留空间，避免目录创建成功而数据分片被拒绝。
const NATIVE_SYNC_CHUNK_CHARS = 180;
const NATIVE_SYNC_MESSAGE = 'bmNativeTagSync';
const NATIVE_SYNC_WAKE_ACTION = 'wakePendingSetting';
const NATIVE_SYNC_DELAY_MS = 800;
const NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS = [2000, 10000, 30000];
const NATIVE_SYNC_HYDRATION_ALARM = 'bm-native-sync-hydration';
const NATIVE_SYNC_SETTING_ALARM = 'bm-native-sync-setting';
const NATIVE_SYNC_SETTING_RETRY_DELAY_MS = 2000;
const NATIVE_SYNC_SETTING_RETRY_PERIOD_MINUTES = 0.5;
const CLOSED_NATIVE_SYNC_CHANNEL = /(?:message (?:channel|port) closed|asynchronous response.*channel closed)/i;
const LEGACY_CLOSED_NATIVE_SYNC_CHANNEL =
  /^A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received\.?$/i;
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
let nativeSyncActiveSettingId = '';
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
  // Chrome 会在输出尚未被读取时施加背压，必须同时消费输出，不能先等待写入结束。
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function nativeDecompress(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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

function nativeRecordHiddenForUrl(bookmarks, hiddenIds, key) {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(
    Array.isArray(hiddenIds) ? hiddenIds.map(String) :
      (hiddenIds && typeof hiddenIds === 'object' ? Object.keys(hiddenIds).filter(id => hiddenIds[id]) : [])
  );
  return (bookmarks || []).some(bookmark =>
    syncUrlKey(bookmark.url) === key && hidden.has(String(bookmark.id))
  );
}

function updateNativeRecordsForUrls(records, state, bookmarks, tags, keys, hiddenIds) {
  [...new Set(keys || [])].filter(Boolean).sort().forEach(key => {
    records[key] = {
      tags: nativeRecordTagsForUrl(bookmarks, tags, key),
      hidden: nativeRecordHiddenForUrl(bookmarks, hiddenIds, key),
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
  const record = { tags: normalizeNativeTags(value.tags), revision };
  if (typeof value.hidden === 'boolean') record.hidden = value.hidden;
  if (value.provisional === true) record.provisional = true;
  return record;
}

function normalizeNativeConfig(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.fixedTags)) return null;
  const revision = nativeRevision(value.revision);
  if (!revision[0] || !revision[2]) return null;
  const config = {
    revision,
    fixedTags: [...new Set(value.fixedTags.map(tag => String(tag || '').trim()).filter(Boolean))]
      .filter(tag => tag !== FALLBACK_TAG).slice(0, MAX_FIXED_TAGS),
    tagRules: normalizeBackgroundTagRules(value.tagRules)
  };
  if (value.provisional === true) config.provisional = true;
  return config;
}

function nativeConfigValues(fixedTags, tagRules) {
  return {
    fixedTags: backgroundFixedTagPool(fixedTags).filter(tag => tag !== FALLBACK_TAG),
    tagRules: normalizeBackgroundTagRules(tagRules)
  };
}

function nativeConfigGuard(value) {
  if (!value || typeof value !== 'object') return null;
  return nativeConfigValues(value.fixedTags, value.tagRules);
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
    // 区分「从未配置」（值不存在）和「用户明确关闭」（值为 false）：
    // 前者允许同步目录首次到达时自动接管，后者必须保持关闭。
    everConfigured: stored[NATIVE_SYNC_ENABLED_KEY] !== undefined,
    deviceId: String(raw.deviceId || '').trim() || nativeCreateDeviceId(),
    clock: Math.max(0, Math.floor(Number(raw.clock) || 0)),
    sequence: Math.max(0, Math.floor(Number(raw.sequence) || 0)),
    seeded: raw.seeded === true,
    seedAfterIncomplete: raw.seedAfterIncomplete === true,
    seedRequestId: String(raw.seedRequestId || ''),
    presence: raw.presence === true,
    presenceDeviceIds: Array.isArray(raw.presenceDeviceIds)
      ? [...new Set(raw.presenceDeviceIds.map(id => String(id || '')).filter(Boolean))]
      : []
  };
  return state;
}

function nativeSyncStateValue(state) {
  return {
    deviceId: state.deviceId,
    clock: state.clock,
    sequence: state.sequence,
    seeded: !!state.seeded,
    seedAfterIncomplete: !!state.seedAfterIncomplete,
    seedRequestId: state.seedRequestId || '',
    presence: !!state.presence,
    presenceDeviceIds: state.presence ? state.presenceDeviceIds || [] : []
  };
}

async function saveNativeSyncState(api, state) {
  const updates = { [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state) };
  // 设置页已先持久化最新开关；执行中的旧设置任务只能更新元数据，
  // 不能把用户刚切换的新目标重新写回去。
  if (!nativeSyncActiveSettingId) updates[NATIVE_SYNC_ENABLED_KEY] = !!state.enabled;
  await api.storage.local.set(updates);
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
  return (children || []).map(nativeHeadInfo)
    .filter(info => info && info.bucket === bucket)
    .sort((left, right) => compareNativeGeneration(right.generation, left.generation))[0] || null;
}

function compareNativeGeneration(left, right) {
  const parse = value => String(value || '').split('-', 2).map(part => parseInt(part, 36) || 0);
  const a = parse(left);
  const b = parse(right);
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return String(left || '').localeCompare(String(right || ''));
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
  // 内容与已发布版本一致时跳过重写：UI 每次标签操作都会触发兜底全量发布，
  // 不跳过会让所有桶重建分片并在 Chrome 书签同步中放大为大量节点增删。
  const current = await api.bookmarks.getChildren(deviceFolder.id);
  const existingHead = findNativeHead(current, bucket);
  if (existingHead && existingHead.checksum === nativeChecksum(encoded)) {
    const existing = await readNativeHeadPayload(current, existingHead);
    if (!existing.error) return;
  }
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
  const headTitle = `${NATIVE_SYNC_PROTOCOL}|H|${bucket}|${generation}|${chunks.length}|${checksum}`;
  // 新分片验证成功前不能创建提交头。否则分片被浏览器拒绝或静默丢失时，
  // 已同步的上一版本会被新头遮蔽，尽管旧数据仍完整存在。
  const written = await api.bookmarks.getChildren(deviceFolder.id);
  const pending = await readNativeHeadPayload(written, { bucket, generation, count: chunks.length, checksum });
  if (pending.error) {
    throw new Error(`同步分片写入后验证失败：${bucket} ${pending.error}`);
  }
  await api.bookmarks.create({ parentId: deviceFolder.id, title: headTitle });

  const after = await api.bookmarks.getChildren(deviceFolder.id);
  const committedHead = after.map(nativeHeadInfo).find(head =>
    head && head.bucket === bucket && head.generation === generation && head.checksum === checksum
  );
  if (!committedHead) {
    throw new Error(`同步分片写入后验证失败：${bucket} 提交头缺失`);
  }
  const staleHeads = after.map(nativeHeadInfo).filter(head =>
    head && head.bucket === bucket && head.generation !== generation
  );
  for (const head of staleHeads) {
    try { await api.bookmarks.remove(head.node.id); } catch (e) { /* 读取端仍会忽略较旧 Head */ }
  }
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

function nativeHydrationAlarmName(retryAttempt) {
  return `${NATIVE_SYNC_HYDRATION_ALARM}-${retryAttempt}`;
}

function nativeHydrationAlarmAttempt(name) {
  // 兼容旧版本已创建的单一闹钟：它只会在最终恢复窗口触发。
  if (name === NATIVE_SYNC_HYDRATION_ALARM) return NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length;
  const prefix = NATIVE_SYNC_HYDRATION_ALARM + '-';
  if (!String(name || '').startsWith(prefix)) return 0;
  const retryAttempt = Number(String(name).slice(prefix.length));
  return Number.isInteger(retryAttempt) && retryAttempt > 0 &&
    retryAttempt <= NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length ? retryAttempt : 0;
}

function nativeSyncSettingAlarmName(settingId) {
  return settingId ? `${NATIVE_SYNC_SETTING_ALARM}-${settingId}` : NATIVE_SYNC_SETTING_ALARM;
}

function isNativeSyncSettingAlarm(name) {
  return name === NATIVE_SYNC_SETTING_ALARM ||
    String(name || '').startsWith(NATIVE_SYNC_SETTING_ALARM + '-');
}

function nativeSyncSettingAlarmId(name) {
  const prefix = NATIVE_SYNC_SETTING_ALARM + '-';
  return String(name || '').startsWith(prefix) ? String(name).slice(prefix.length) : '';
}

async function clearNativeSyncSettingAlarm(api, settingId, includeLegacy = false) {
  if (!api.alarms || typeof api.alarms.clear !== 'function') return;
  const names = [nativeSyncSettingAlarmName(settingId)];
  if (includeLegacy) names.push(NATIVE_SYNC_SETTING_ALARM);
  await Promise.all(names.map(async name => {
    try {
      const cleared = api.alarms.clear(name);
      if (cleared && typeof cleared.catch === 'function') await cleared.catch(() => {});
    } catch (e) { /* 清理失败只会留下无害的空唤醒 */ }
  }));
}

async function clearStaleNativeSyncSettingAlarms(api, activeSettingId = '') {
  if (!api.alarms || typeof api.alarms.getAll !== 'function') return;
  try {
    const activeName = activeSettingId ? nativeSyncSettingAlarmName(activeSettingId) : '';
    const alarms = await api.alarms.getAll();
    await Promise.all((alarms || []).map(alarm => String(alarm && alarm.name || ''))
      .filter(name => isNativeSyncSettingAlarm(name) && name !== activeName)
      .map(name => clearNativeSyncSettingAlarm(api, nativeSyncSettingAlarmId(name), name === NATIVE_SYNC_SETTING_ALARM)));
  } catch (e) { /* 不影响当前同步任务；下一次设置或 alarm 触发还会再次清理 */ }
}

async function clearNativeHydrationAlarm(api) {
  if (!api.alarms || typeof api.alarms.clear !== 'function') return;
  const names = [NATIVE_SYNC_HYDRATION_ALARM].concat(
    NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.map((_delay, index) => nativeHydrationAlarmName(index + 1))
  );
  await Promise.all(names.map(name => api.alarms.clear(name).catch(() => false)));
}

async function cancelNativeHydrationSchedule(api) {
  if (nativeSyncTimer) {
    clearTimeout(nativeSyncTimer);
    nativeSyncTimer = null;
  }
  await clearNativeHydrationAlarm(api);
}

function scheduleNativeSyncSettingRetry(api, settingId = '') {
  if (!api.alarms || typeof api.alarms.create !== 'function') return;
  try {
    const scheduled = api.alarms.create(nativeSyncSettingAlarmName(settingId), {
      when: Date.now() + NATIVE_SYNC_SETTING_RETRY_DELAY_MS,
      periodInMinutes: NATIVE_SYNC_SETTING_RETRY_PERIOD_MINUTES
    });
    if (scheduled && typeof scheduled.catch === 'function') scheduled.catch(() => {});
  } catch (e) { /* storage 请求和运行时消息仍会唤醒后台 */ }
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
  await setBackgroundTagSyncStatus(api, '');
  return true;
}

async function publishNativeSyncPresence(api) {
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return false;
  const tree = await api.bookmarks.getTree();
  const root = findNativeSyncRoot(tree);
  if (!root) throw new Error('未找到书签管家同步数据目录，请重新启用同步');
  const emptyDeviceIds = nativeEmptyDeviceIds(root);
  const deviceFolder = await ensureNativeDeviceFolder(api, root, state.deviceId);
  // Presence 使用空 records，不携带任何标签或配置 revision，避免压过迟到的远端数据。
  await writeNativeBucket(api, deviceFolder, 'presence', {
    version: 1,
    type: 'records',
    deviceId: state.deviceId,
    records: {}
  });
  state.presence = true;
  state.presenceDeviceIds = emptyDeviceIds;
  await saveNativeSyncState(api, state);
  await setBackgroundTagSyncStatus(api, '');
  return true;
}

async function republishNativeSyncState(api, state) {
  const records = await loadNativeSyncRecords(api);
  const config = await loadNativeSyncConfig(api);
  if (!Object.keys(records).length && !config) {
    return state.presence ? publishNativeSyncPresence(api) : false;
  }
  return publishNativeSync(api, null, true);
}

function mergeNativeRecord(target, key, raw) {
  const record = normalizeNativeRecord(raw);
  if (!record) return;
  const current = target[key];
  const comparison = current && compareNativeRevision(record.revision, current.revision);
  if (!current || comparison > 0) {
    target[key] = record;
  } else if (comparison === 0 && current.provisional === true && record.provisional === true) {
    // 多台设备在尚未看到任意有效提交时都会生成候选种子。相同的候选 revision
    // 不能再依赖随机设备 ID 决胜，否则后到设备的数据会被永久丢弃。
    target[key] = {
      tags: normalizeNativeTags([...current.tags, ...record.tags]),
      revision: current.revision,
      ...(Object.prototype.hasOwnProperty.call(current, 'hidden') || Object.prototype.hasOwnProperty.call(record, 'hidden')
        ? { hidden: current.hidden === true || record.hidden === true } : {}),
      provisional: true
    };
  }
}

function mergeProvisionalNativeConfig(left, right) {
  const rules = { domain: {}, keyword: {} };
  [left, right].forEach(config => {
    ['domain', 'keyword'].forEach(group => {
      Object.entries(config.tagRules && config.tagRules[group] || {}).forEach(([key, tags]) => {
        rules[group][key] = [...new Set([...(rules[group][key] || []), ...(tags || [])])];
      });
    });
  });
  return {
    revision: left.revision,
    fixedTags: [...new Set([...left.fixedTags, ...right.fixedTags])].slice(0, MAX_FIXED_TAGS),
    tagRules: normalizeBackgroundTagRules(rules),
    provisional: true
  };
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
  let hasPublishedDeviceFolder = false;
  const emptyDeviceIds = [];
  for (const deviceFolder of root.children || []) {
    const deviceId = nativeDeviceFolderId(deviceFolder);
    if (!deviceId) continue;
    hasDeviceFolder = true;
    const children = deviceFolder.children || [];
    const malformedProtocolNode = children.find(node => {
      const parts = nativeTitleParts(node && node.title);
      if (!parts || (parts[1] !== 'H' && parts[1] !== 'S')) return false;
      return parts[1] === 'H' ? !nativeHeadInfo(node) : !nativeChunkInfo(node);
    });
    if (malformedProtocolNode) {
      hasPublishedDeviceFolder = true;
      errors.push(`${deviceId}: 同步节点格式无效`);
    }
    const heads = children.map(nativeHeadInfo).filter(Boolean);
    const chunks = children.map(nativeChunkInfo).filter(Boolean);
    const headBuckets = new Set(heads.map(head => head.bucket));
    const orphanChunk = chunks.find(chunk => !headBuckets.has(chunk.bucket));
    if (orphanChunk) {
      hasPublishedDeviceFolder = true;
      errors.push(`${deviceId}/${orphanChunk.bucket}: 提交头缺失`);
    }
    if (!heads.length) {
      hasEmptyDeviceFolder = true;
      emptyDeviceIds.push(deviceId);
      continue;
    }
    hasPublishedDeviceFolder = true;
    const latestHeads = [...new Set(heads.map(head => head.bucket))]
      .map(bucket => findNativeHead(children, bucket));
    for (const head of latestHeads) {
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
        const configComparison = config && compareNativeRevision(normalized.revision, config.revision);
        if (!config || configComparison > 0) config = normalized;
        else if (configComparison === 0 && config.provisional === true && normalized.provisional === true) {
          config = mergeProvisionalNativeConfig(config, normalized);
        }
        if (compareNativeRevision(normalized.revision, maxRevision) > 0) maxRevision = normalized.revision;
      } else {
        errors.push(`${deviceId}/${head.bucket}: 分片类型无效`);
      }
    }
  }
  return {
    root, records, config, maxRevision, errors,
    hasPublishedDeviceFolder, emptyDeviceIds,
    complete: hasDeviceFolder && !hasEmptyDeviceFolder
  };
}

function nativeEmptyDeviceIds(root) {
  return (root && root.children || []).map(device => ({
    id: nativeDeviceFolderId(device),
    heads: (device.children || []).map(nativeHeadInfo).filter(Boolean)
  })).filter(device => device.id && !device.heads.length).map(device => device.id);
}

async function applyNativeSyncData(api, source, allowedEmptyDeviceIds = null, configSnapshot = null) {
  const data = await readNativeSyncData(source);
  if (!data) return { changed: false, ready: false, retry: true, records: {} };
  const allowAllEmptyDevices = allowedEmptyDeviceIds === true;
  const allowedEmptyDevices = new Set(Array.isArray(allowedEmptyDeviceIds) ? allowedEmptyDeviceIds : []);
  const awaitingDeviceData = data.emptyDeviceIds.length > 0 &&
    !allowAllEmptyDevices && !data.emptyDeviceIds.every(id => allowedEmptyDevices.has(id));
  if (data.errors.length) {
    await setBackgroundTagSyncStatus(api, '同步数据损坏：' + data.errors[0]);
    return {
      changed: false,
      ready: false,
      retry: true,
      records: data.records,
      hasPublishedData: data.hasPublishedDeviceFolder,
      hasPayloadErrors: true
    };
  }
  if (!data.hasPublishedDeviceFolder) {
    // 仅有根目录或空设备目录是 Chrome 书签同步的正常到达顺序，不应误报为损坏。
    await setBackgroundTagSyncWaitingStatus(api, data.emptyDeviceIds);
    return {
      changed: false,
      ready: false,
      retry: true,
      records: data.records,
      hasPublishedData: false,
      hasPayloadErrors: false,
      emptyDeviceIds: data.emptyDeviceIds,
      awaitingDeviceData: true
    };
  }
  const stored = await api.storage.local.get([
    TAGS_KEY, HIDDEN_KEY, FIXED_TAGS_KEY, TAG_RULES_KEY, NATIVE_SYNC_CONFIG_KEY, NATIVE_SYNC_URLS_KEY,
    NATIVE_SYNC_CONFIG_REQUEST_KEY
  ]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? { ...stored[TAGS_KEY] } : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  const nextTags = { ...tags };
  const nextHiddenIds = new Set(hiddenIds);
  let tagsChanged = false;
  let hiddenChanged = false;
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
    if (typeof record.hidden === 'boolean') {
      const id = String(bookmark.id);
      if (record.hidden && !nextHiddenIds.has(id)) {
        nextHiddenIds.add(id);
        hiddenChanged = true;
      } else if (!record.hidden && nextHiddenIds.has(id)) {
        nextHiddenIds.delete(id);
        hiddenChanged = true;
      }
    }
  });
  const updates = {};
  if (tagsChanged) updates[TAGS_KEY] = nextTags;
  if (hiddenChanged) updates[HIDDEN_KEY] = [...nextHiddenIds];
  let configChanged = false;
  if (data.config) {
    const currentConfig = nativeConfigValues(stored[FIXED_TAGS_KEY], stored[TAG_RULES_KEY]);
    const latest = await api.storage.local.get([
      FIXED_TAGS_KEY, TAG_RULES_KEY, NATIVE_SYNC_CONFIG_REQUEST_KEY
    ]);
    const pendingConfigRequest = nativeConfigWriteRequest(latest[NATIVE_SYNC_CONFIG_REQUEST_KEY]);
    const latestConfig = nativeConfigValues(latest[FIXED_TAGS_KEY], latest[TAG_RULES_KEY]);
    const localSyncedConfig = normalizeNativeConfig(stored[NATIVE_SYNC_CONFIG_KEY]);
    const guard = nativeConfigGuard(configSnapshot);
    // 水合期间用户可能已在设置页保存了新配置。不能让较早读取到的远端值
    // 覆盖本地写入；标签记录仍可照常合并。
    const configUnchangedDuringApply = sameNativeConfigValues(currentConfig, latestConfig);
    const configMatchesSnapshot = !guard || sameNativeConfigValues(guard, latestConfig);
    const remoteConfigIsNotOlder = !localSyncedConfig ||
      compareNativeRevision(data.config.revision, localSyncedConfig.revision) >= 0;
    // 设置页已发起保存时，不能将远端配置回填到 storage；否则输入框会被覆盖，
    // 且后续连续输入会基于错误的远端文本继续保存。
    if (!pendingConfigRequest && configUnchangedDuringApply && configMatchesSnapshot && remoteConfigIsNotOlder) {
      if (!sameNativeConfigValues(latestConfig, data.config)) {
        updates[FIXED_TAGS_KEY] = data.config.fixedTags;
        updates[TAG_RULES_KEY] = data.config.tagRules;
        configChanged = true;
      }
      updates[NATIVE_SYNC_CONFIG_KEY] = data.config;
    }
  }
  const state = await loadNativeSyncState(api);
  if (compareNativeRevision(data.maxRevision, [state.clock, state.sequence, state.deviceId]) > 0) {
    state.clock = data.maxRevision[0];
    state.sequence = data.maxRevision[1];
    updates[NATIVE_SYNC_STATE_KEY] = nativeSyncStateValue(state);
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
  // 读取同步状态、书签 URL 等步骤包含 await。用户保存请求可能在这些步骤期间
  // 到达，因此真正写入远端配置前必须再次确认，不能只依赖前面的 latest 快照。
  if (Object.prototype.hasOwnProperty.call(updates, FIXED_TAGS_KEY) ||
    Object.prototype.hasOwnProperty.call(updates, TAG_RULES_KEY) ||
    Object.prototype.hasOwnProperty.call(updates, NATIVE_SYNC_CONFIG_KEY)) {
    const latestRequest = await api.storage.local.get(NATIVE_SYNC_CONFIG_REQUEST_KEY);
    if (nativeConfigWriteRequest(latestRequest[NATIVE_SYNC_CONFIG_REQUEST_KEY])) {
      delete updates[FIXED_TAGS_KEY];
      delete updates[TAG_RULES_KEY];
      delete updates[NATIVE_SYNC_CONFIG_KEY];
      configChanged = false;
    }
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
  if (awaitingDeviceData) await setBackgroundTagSyncWaitingStatus(api, data.emptyDeviceIds);
  else await setBackgroundTagSyncStatus(api, '');
  return {
    changed: tagsChanged || hiddenChanged || configChanged,
    ready: true,
    retry: awaitingDeviceData,
    records: data.records,
    hasPublishedData: data.hasPublishedDeviceFolder,
    hasPayloadErrors: false,
    emptyDeviceIds: data.emptyDeviceIds,
    awaitingDeviceData
  };
}

async function publishMissingNativeSyncRecords(api, state, tree, remoteRecords) {
  const stored = await api.storage.local.get([TAGS_KEY, HIDDEN_KEY, NATIVE_SYNC_RECORDS_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  const records = stored[NATIVE_SYNC_RECORDS_KEY] && typeof stored[NATIVE_SYNC_RECORDS_KEY] === 'object'
    ? { ...stored[NATIVE_SYNC_RECORDS_KEY] } : {};
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const keys = new Set();
  bookmarks.forEach(bookmark => {
    const key = syncUrlKey(bookmark.url);
    if (!key || Object.prototype.hasOwnProperty.call(remoteRecords, key)) return;
    if (!normalizeNativeTags(tags[bookmark.id]).length && !hiddenIds.has(String(bookmark.id))) return;
    keys.add(key);
  });
  updateNativeRecordsForUrls(records, state, bookmarks, tags, keys, hiddenIds);
  state.seeded = true;
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
  });
  if (keys.size) {
    await publishNativeSync(api, new Set([...keys].map(nativeBucketForUrl)), false);
  }
  return keys.size > 0;
}

async function hydrateNativeSyncResult(api, recoverIncomplete = false, configSnapshot = null) {
  if (!api.bookmarks || typeof api.bookmarks.getTree !== 'function') {
    return { changed: false, ready: true, retry: false };
  }
  const state = await loadNativeSyncState(api);
  let tree = await api.bookmarks.getTree();
  const root = findNativeSyncRoot(tree);
  if (!root) {
    if (state.enabled) await setBackgroundTagSyncStatus(api, '未找到书签管家同步数据目录');
    return { changed: false, ready: !state.enabled, retry: state.enabled };
  }
  if (!state.enabled) {
    // 同步目录随 Chrome 书签同步首次到达时自动接管（仅限从未配置过的设备）；
    // 用户明确关闭过同步时保持关闭，书签事件不能把开关静默重新打开，
    // 否则「停止读写同步目录」的设置在下一次收藏后就会失效。
    if (state.everConfigured) return { changed: false, ready: true };
  }
  // 兼容 presence 状态首次上线前写入的记录：它没有保存待忽略的旧空设备 ID。
  if (state.presence && !state.presenceDeviceIds.length) {
    state.presenceDeviceIds = nativeEmptyDeviceIds(root);
    await saveNativeSyncState(api, state);
  }
  const enableAfterHydration = !state.enabled;
  const allowedEmptyDeviceIds = recoverIncomplete
    ? true : state.presence ? state.presenceDeviceIds : null;
  let result = await applyNativeSyncData(api, tree, allowedEmptyDeviceIds, configSnapshot);
  if (!result.ready && !result.hasPublishedData && !result.hasPayloadErrors && state.seeded) {
    // 本机缓存已经产生过完整提交，但 Chrome 当前只给出了空设备目录时，
    // 直接按原 revision 重发缓存。这样不会压过稍后抵达的更新远端记录，
    // 却能避免空目录被错误地长期标成“已就绪”。
    const republished = await republishNativeSyncState(api, state);
    if (republished) {
      tree = await api.bookmarks.getTree();
      result = await applyNativeSyncData(api, tree, allowedEmptyDeviceIds, configSnapshot);
    }
  }
  if (!result.ready && !result.hasPublishedData && !result.hasPayloadErrors &&
    !nativeSyncActiveSettingId && state.enabled && state.seedAfterIncomplete && !state.seeded &&
    await hasLocalNativeMetadataAssignments(api, tree)) {
    // 扩展重载后不会再次触发设置页的 change 事件。对用户此前明确开启、且仍只有
    // 空设备目录的状态，直接恢复候选种子，避免本机标签一直滞留在 storage。
    const seedRequestId = 'hydration-' + state.deviceId + '-' + Date.now().toString(36);
    const seeded = await seedNativeSyncFromLocal(api, state, tree, true, {
      lowPriority: true,
      requireCurrentSetting: true,
      seedRequestId
    });
    if (seeded && await publishNativeSyncSeed(api, seeded, seedRequestId)) {
      tree = await api.bookmarks.getTree();
      result = await applyNativeSyncData(api, tree, true, configSnapshot);
    }
  }
  if (!result.ready && recoverIncomplete &&
    !result.hasPublishedData && !result.hasPayloadErrors &&
    (state.seeded || state.seedAfterIncomplete)) {
    if (state.seeded) {
      // 本机已经发布过，但同步根目录只剩空目录时，用本机持久化记录重建提交头。
      const republished = await republishNativeSyncState(api, state);
      if (!republished) await publishNativeSyncPresence(api);
    } else {
      // 卸载重装会清空 seeded，但用户明确启用前可能已经从备份恢复了标签。
      // 等完远端分片到达窗口后仍无发布数据，才将当前本机数据作为候选种子。
      // 低优先级 revision 允许随后抵达的远端提交正常接管。
      const seeded = await seedNativeSyncFromLocal(api, state, tree, true, {
        lowPriority: true,
        requireCurrentSetting: true
      });
      if (!seeded) return result;
      await publishNativeSync(api, nativeBucketsForRecords(seeded.records), true);
    }
    tree = await api.bookmarks.getTree();
    result = await applyNativeSyncData(api, tree, true, configSnapshot);
  }
  if (!result.ready) return result;
  if (state.presence && !result.emptyDeviceIds.some(id => state.presenceDeviceIds.includes(id))) {
    const hydratedState = await loadNativeSyncState(api);
    hydratedState.presence = false;
    hydratedState.presenceDeviceIds = [];
    await saveNativeSyncState(api, hydratedState);
  }
  if (enableAfterHydration && !result.awaitingDeviceData) {
    // 目录可能先于 Head/分片到达；只有完整读取后才完成自动接管，
    // 否则设置页会把空目录误显示成用户已经启用。
    const hydratedState = await loadNativeSyncState(api);
    hydratedState.enabled = true;
    await saveNativeSyncState(api, hydratedState);
  }
  if (!result.retry) await clearNativeHydrationAlarm(api);
  if (result.awaitingDeviceData) return result;
  const currentState = await loadNativeSyncState(api);
  if (!currentState.seeded) {
    const published = await publishMissingNativeSyncRecords(api, currentState, tree, result.records);
    return { ...result, changed: result.changed || published };
  }
  return result;
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
  if (!result.ready || result.awaitingDeviceData || !deferredNativeSyncAutoTags.size) return;
  const entries = [...deferredNativeSyncAutoTags.values()];
  deferredNativeSyncAutoTags.clear();
  entries.forEach(entry => {
    queueBrowserBookmarkAutoTag(entry.id, entry.bookmark, false, entry.allowAi)
      .catch(error => console.warn('[书签管家] 延迟默认打标失败', error));
  });
}

async function canWriteNativeSyncSeed(api) {
  if (!(await isCurrentNativeSyncSetting(api))) return false;
  return (await loadNativeSyncState(api)).enabled;
}

async function seedNativeSyncFromLocal(api, state, tree, replaceRecords, options = {}) {
  // 保持标签读取的独立 await，兼容旧版种子流程的取消时序。
  const storedTags = await api.storage.local.get(TAGS_KEY);
  const stored = {
    ...storedTags,
    ...(await api.storage.local.get([HIDDEN_KEY, FIXED_TAGS_KEY, TAG_RULES_KEY]))
  };
  // storage.get 会让出执行权；用户可能在这期间关闭同步或发起了新请求。
  // 在创建持久化 records/config 前再次检查，不能给已取消的开启任务留下缓存。
  if (options.requireCurrentSetting && !(await canWriteNativeSyncSeed(api))) return null;
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  const records = replaceRecords ? {} : await loadNativeSyncRecords(api);
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const byKey = {};
  const seedRevision = options.lowPriority ? [1, 0, 'candidate'] : null;
  bookmarks.forEach(bookmark => {
    const key = syncUrlKey(bookmark.url);
    const values = normalizeNativeTags(tags[bookmark.id]);
    if (!key || (!values.length && !hiddenIds.has(String(bookmark.id)))) return;
    byKey[key] = normalizeNativeTags([...(byKey[key] || []), ...values]);
    if (hiddenIds.has(String(bookmark.id))) byKey[key] = byKey[key] || [];
  });
  Object.entries(byKey).forEach(([key, values]) => {
    records[key] = {
      tags: values,
      hidden: nativeRecordHiddenForUrl(bookmarks, hiddenIds, key),
      revision: seedRevision || nativeNextRevision(state),
      ...(seedRevision ? { provisional: true } : {})
    };
  });
  state.presence = false;
  state.presenceDeviceIds = [];
  state.seedRequestId = options.seedRequestId || '';
  const config = {
    revision: seedRevision || nativeNextRevision(state),
    ...nativeConfigValues(stored[FIXED_TAGS_KEY], stored[TAG_RULES_KEY]),
    ...(seedRevision ? { provisional: true } : {})
  };
  state.seeded = true;
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_CONFIG_KEY]: config,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
  });
  return { records, config };
}

async function discardCancelledNativeSyncSeed(api, requestId) {
  if (!requestId) return false;
  const state = await loadNativeSyncState(api);
  if (state.seedRequestId !== requestId) return false;
  state.seeded = false;
  state.seedAfterIncomplete = false;
  state.seedRequestId = '';
  state.presence = false;
  state.presenceDeviceIds = [];
  if (api.storage.local && typeof api.storage.local.remove === 'function') {
    await api.storage.local.remove([
      NATIVE_SYNC_RECORDS_KEY, NATIVE_SYNC_CONFIG_KEY, NATIVE_SYNC_URLS_KEY
    ]);
  }
  await saveNativeSyncState(api, state);
  return true;
}

async function finalizeNativeSyncSeed(api, requestId) {
  if (!requestId) return false;
  const state = await loadNativeSyncState(api);
  if (state.seedRequestId !== requestId) return false;
  state.seedRequestId = '';
  await saveNativeSyncState(api, state);
  return true;
}

async function publishNativeSyncSeed(api, seeded, requestId) {
  if (!(await canWriteNativeSyncSeed(api))) {
    await discardCancelledNativeSyncSeed(api, requestId);
    return false;
  }
  await publishNativeSync(api, nativeBucketsForRecords(seeded.records), true);
  // 发布含有多个书签 API await；取消若在中途到达，至少不能让本地候选缓存
  // 留到下一次开启后被重新发布。
  if (!(await canWriteNativeSyncSeed(api))) {
    await discardCancelledNativeSyncSeed(api, requestId);
    return false;
  }
  await finalizeNativeSyncSeed(api, requestId);
  return true;
}

async function hasLocalNativeMetadataAssignments(api, tree) {
  const stored = await api.storage.local.get([TAGS_KEY, HIDDEN_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  return collectNativeUserBookmarks(tree, []).some(bookmark =>
    normalizeNativeTags(tags[bookmark.id]).length > 0 || hiddenIds.has(String(bookmark.id))
  );
}

async function setNativeSyncEnabled(api, enabled, settingId = '') {
  const previousSettingId = nativeSyncActiveSettingId;
  nativeSyncActiveSettingId = settingId;
  try {
    if (!(await isCurrentNativeSyncSetting(api))) return false;
    const state = await loadNativeSyncState(api);
    if (!enabled) {
      state.enabled = false;
      state.seedAfterIncomplete = false;
      await saveNativeSyncState(api, state);
      await cancelNativeHydrationSchedule(api);
      await setBackgroundTagSyncDisabledStatus(api);
      return false;
    }
    await setBackgroundTagSyncProgress(api, 'reading-bookmarks');
    const tree = await api.bookmarks.getTree();
    if (!(await isCurrentNativeSyncSetting(api))) return false;
    const existingRoot = findNativeSyncRoot(tree);
    if (!existingRoot) await setBackgroundTagSyncProgress(api, 'creating-directory');
    await ensureNativeSyncRoot(api, tree);
    state.enabled = true;
    // 只有用户显式开启才设置此标记；后台自动发现目录不会据此覆盖迟到的远端数据。
    if (!state.seeded) state.seedAfterIncomplete = !!existingRoot;
    await saveNativeSyncState(api, state);
    if (!existingRoot) {
      // 根目录被误删或首次启用时，以本机当前标签重建一份完整的起始数据。
      await setBackgroundTagSyncProgress(api, 'preparing-local-data');
      const seeded = await seedNativeSyncFromLocal(api, state, tree, true, {
        requireCurrentSetting: true,
        seedRequestId: nativeSyncActiveSettingId
      });
      if (!seeded) return false;
      await setBackgroundTagSyncProgress(api, 'writing-sync-data');
      if (!(await publishNativeSyncSeed(api, seeded, nativeSyncActiveSettingId))) return false;
      await setBackgroundTagSyncStatus(api, '');
    } else {
      await setBackgroundTagSyncProgress(api, 'checking-remote-data');
      const result = await hydrateNativeSyncResult(api);
      if (result.retry && !result.hasPublishedData && !result.hasPayloadErrors) {
        // 已持久化的记录保留原 revision 重发，避免无谓压过可能迟到的远端数据。
        const republished = state.seeded && await republishNativeSyncState(api, state);
        if (!republished) {
          const hasLocalTags = await hasLocalNativeMetadataAssignments(api, tree);
          if (hasLocalTags) {
            // 用户明确开启同步且所有设备目录都还没有完整提交时，本机已有标签必须
            // 立即成为首个种子；仅安排最终重试会让数据长期停留在本机 storage，
            // Chrome 书签目录始终只剩 BMN1|D| 设备层。
            await setBackgroundTagSyncProgress(api, 'preparing-local-data');
            // 当前目录没有可读提交时先写入低优先级本机种子；若另一个设备的完整
            // 目录稍后同步到本机，其正常 revision 会覆盖这份候选数据。
            const seeded = await seedNativeSyncFromLocal(api, state, tree, true, {
              lowPriority: true,
              requireCurrentSetting: true,
              seedRequestId: nativeSyncActiveSettingId
            });
            if (!seeded) return false;
            await setBackgroundTagSyncProgress(api, 'writing-sync-data');
            if (!(await publishNativeSyncSeed(api, seeded, nativeSyncActiveSettingId))) return false;
            const recovered = await hydrateNativeSyncResult(api, true);
            if (recovered.retry) scheduleNativeHydration(api, 1);
            return { changed: true, retry: false };
          }
          // 空 presence 不含标签修订号；本机没有标签时上线不会覆盖远端数据。
          await publishNativeSyncPresence(api);
          const recovered = await hydrateNativeSyncResult(api, true);
          if (recovered.retry) scheduleNativeHydration(api, 1);
          return { changed: true, retry: false };
        }
        const recovered = await hydrateNativeSyncResult(api, true);
        if (recovered.retry) {
          scheduleNativeHydration(api, 1);
          return { changed: false, retry: true };
        }
      } else if (result.retry) {
        scheduleNativeHydration(api, 1);
        // 已有完整提交时可以完成用户的开关请求，空设备目录继续由水合任务等待。
        return { changed: false, retry: !result.ready };
      }
    }
    return true;
  } finally {
    nativeSyncActiveSettingId = previousSettingId;
  }
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
  const stored = await api.storage.local.get(HIDDEN_KEY);
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  updateNativeRecordsForUrls(records, state, bookmarks, after, affectedKeys, hiddenIds);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: currentUrls,
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
  });
  await publishNativeSync(api, new Set([...affectedKeys].map(nativeBucketForUrl)), false);
}

async function recordNativeHiddenChanges(api, change) {
  if (nativeSyncApplying) return;
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return;
  const before = new Set(Array.isArray(change && change.oldValue) ? change.oldValue.map(String) : []);
  const after = new Set(Array.isArray(change && change.newValue) ? change.newValue.map(String) : []);
  const ids = new Set([...before, ...after]);
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
  if (!affectedKeys.size) return;
  const stored = await api.storage.local.get(TAGS_KEY);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const records = await loadNativeSyncRecords(api);
  updateNativeRecordsForUrls(records, state, bookmarks, tags, affectedKeys, after);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: currentUrls,
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
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
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
  });
  await publishNativeSync(api, new Set(), true);
}

function nativeConfigWriteRequest(value) {
  if (!value || typeof value !== 'object' || !value.id || !Array.isArray(value.fixedTags)) return null;
  const config = nativeConfigValues(value.fixedTags, value.tagRules);
  return { id: String(value.id), ...config };
}

async function runPendingNativeConfigWrite(api, expectedId = '') {
  const stored = await api.storage.local.get(NATIVE_SYNC_CONFIG_REQUEST_KEY);
  const request = nativeConfigWriteRequest(stored[NATIVE_SYNC_CONFIG_REQUEST_KEY]);
  if (!request || (expectedId && request.id !== expectedId)) return false;
  // 用户配置与远端水合都在 nativeQueue 中写入。配置保存必须在当前水合之后
  // 再落盘，并立即发布新 revision，避免后续水合把旧远端配置反向覆盖回来。
  // storage.onChanged 同样会监听这次写入；预先忽略它，下面显式发布一次即可。
  ignoreNativeConfigChange({
    fixedTags: request.fixedTags,
    tagRules: request.tagRules
  });
  await api.storage.local.set({
    [FIXED_TAGS_KEY]: request.fixedTags,
    [TAG_RULES_KEY]: request.tagRules
  });
  await recordNativeConfigChange(api);
  const current = await api.storage.local.get(NATIVE_SYNC_CONFIG_REQUEST_KEY);
  const currentRequest = nativeConfigWriteRequest(current[NATIVE_SYNC_CONFIG_REQUEST_KEY]);
  if (currentRequest && currentRequest.id === request.id &&
    api.storage.local && typeof api.storage.local.remove === 'function') {
    await api.storage.local.remove(NATIVE_SYNC_CONFIG_REQUEST_KEY);
  }
  return true;
}

async function recordNativeBookmarkRemoval(api, node) {
  if (!node || nativeSyncApplying) return;
  const state = await loadNativeSyncState(api);
  if (!state.enabled) return;
  const removedBookmarks = collectNativeUserBookmarks([node], []);
  if (!removedBookmarks.length) return;
  const tree = await api.bookmarks.getTree();
  const bookmarks = collectNativeUserBookmarks(tree, []);
  const stored = await api.storage.local.get([TAGS_KEY, HIDDEN_KEY, NATIVE_SYNC_URLS_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
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
  updateNativeRecordsForUrls(records, state, bookmarks, tags, affectedKeys, hiddenIds);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
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
  const stored = await api.storage.local.get([TAGS_KEY, HIDDEN_KEY]);
  const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
  const hiddenIds = new Set(Array.isArray(stored[HIDDEN_KEY]) ? stored[HIDDEN_KEY].map(String) : []);
  const records = await loadNativeSyncRecords(api);
  const affectedKeys = new Set([oldKey, newKey]);
  updateNativeRecordsForUrls(records, state, bookmarks, tags, affectedKeys, hiddenIds);
  await api.storage.local.set({
    [NATIVE_SYNC_RECORDS_KEY]: records,
    [NATIVE_SYNC_URLS_KEY]: nativeBookmarkUrlMap(bookmarks),
    [NATIVE_SYNC_STATE_KEY]: nativeSyncStateValue(state)
  });
  await publishNativeSync(api, new Set([...affectedKeys].map(nativeBucketForUrl)), false);
  return true;
}

function runScheduledNativeHydration(api, retryAttempt) {
  return nativeQueue(async () => {
    const recoverIncomplete = retryAttempt === NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length;
    const result = await hydrateNativeSyncResult(api, recoverIncomplete);
    await flushDeferredNativeSyncAutoTags(result);
    return result;
  })
    .then(result => {
      if (result.retry && retryAttempt < NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length) {
        scheduleNativeHydration(api, retryAttempt + 1);
      }
      return result;
    })
    .catch(async error => {
      await setBackgroundTagSyncStatus(api, error && error.message || error);
      console.warn('[书签管家] 原生标签同步读取失败', error);
      if (retryAttempt < NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length) {
        scheduleNativeHydration(api, retryAttempt + 1);
      }
    });
}

function scheduleNativeHydration(api = chrome, retryAttempt = 0) {
  if (nativeSyncTimer) clearTimeout(nativeSyncTimer);
  if (retryAttempt > 1 && api.alarms && typeof api.alarms.clear === 'function') {
    try {
      const cleared = api.alarms.clear(nativeHydrationAlarmName(retryAttempt - 1));
      if (cleared && typeof cleared.catch === 'function') cleared.catch(() => {});
    } catch (e) { /* 旧 alarm 即使保留也不影响当前内存重试 */ }
  }
  const delay = retryAttempt
    ? NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS[retryAttempt - 1]
    : NATIVE_SYNC_DELAY_MS;
  // Chrome 会把很短的 alarm 延迟限制到约 30 秒。当前 Worker 仍存活时先用计时器，
  // 同时保留 alarm 作为 Worker 被回收后的兜底，避免空同步目录被无谓地等待数分钟。
  if (retryAttempt > 0 &&
    api.alarms && typeof api.alarms.create === 'function') {
    try {
      const scheduled = api.alarms.create(nativeHydrationAlarmName(retryAttempt), { when: Date.now() + delay });
      if (scheduled && typeof scheduled.catch === 'function') scheduled.catch(() => {});
    } catch (e) { /* 当前 Worker 的计时器仍会完成本次重试 */ }
  }
  nativeSyncTimer = setTimeout(() => {
    nativeSyncTimer = null;
    runScheduledNativeHydration(api, retryAttempt);
  }, delay);
}


async function setBackgroundTagSyncStatus(api, lastError, errorKind = 'sync') {
  try {
    if (!(await canUpdateNativeSyncStatus(api))) return false;
    const at = Date.now();
    const status = lastError
      ? { lastError: String(lastError), at, errorKind }
      : {
        lastError: '', at, lastSuccessAt: at,
        phase: 'complete', step: 5, totalSteps: 5, directoryReady: true
      };
    if (nativeSyncActiveSettingId) status.requestId = nativeSyncActiveSettingId;
    await api.storage.local.set({ [SYNC_STATUS_KEY]: status });
    return true;
  } catch (e) { /* 保留原始同步错误 */ }
  return false;
}

function nativeSyncProgressDetails(phase) {
  const steps = {
    queued: [1, '请求已保存，正在启动同步服务'],
    'reading-bookmarks': [2, '正在读取本机书签'],
    'creating-directory': [3, '正在创建同步目录'],
    'checking-remote-data': [3, '同步目录已发现，正在读取已有数据'],
    'preparing-local-data': [4, '同步目录已创建，正在整理标签数据'],
    'writing-sync-data': [4, '正在写入同步数据']
  };
  const current = steps[phase];
  return current ? { step: current[0], detail: current[1] } : null;
}

async function setBackgroundTagSyncProgress(api, phase) {
  // 普通的后台水合不应把已完成的用户设置重新标为 pending。
  if (!nativeSyncActiveSettingId) return false;
  const progress = nativeSyncProgressDetails(phase);
  if (!progress || !(await canUpdateNativeSyncStatus(api))) return false;
  try {
    await api.storage.local.set({
      [SYNC_STATUS_KEY]: {
        lastError: '', at: Date.now(), pending: true, target: true,
        requestId: nativeSyncActiveSettingId,
        phase, step: progress.step, totalSteps: 5, detail: progress.detail
      }
    });
    return true;
  } catch (e) { return false; }
}

async function setBackgroundTagSyncDisabledStatus(api) {
  try {
    if (!(await canUpdateNativeSyncStatus(api))) return false;
    const status = { lastError: '', at: Date.now(), disabled: true };
    if (nativeSyncActiveSettingId) status.requestId = nativeSyncActiveSettingId;
    await api.storage.local.set({ [SYNC_STATUS_KEY]: status });
    return true;
  } catch (e) { /* 关闭同步不应因状态提示写入失败而中断 */ }
  return false;
}

async function setBackgroundTagSyncWaitingStatus(api, deviceIds) {
  try {
    if (!(await canUpdateNativeSyncStatus(api))) return false;
    const at = Date.now();
    const status = {
      lastError: '', at,
      waitingForData: true,
      waitingDeviceCount: Array.isArray(deviceIds) ? deviceIds.length : 0,
      phase: 'waiting-for-data', step: 4, totalSteps: 5,
      directoryReady: false
    };
    if (nativeSyncActiveSettingId) status.requestId = nativeSyncActiveSettingId;
    await api.storage.local.set({ [SYNC_STATUS_KEY]: status });
    return true;
  } catch (e) { /* 等待状态写入失败不应中断后续水合 */ }
  return false;
}

function nativeSyncPendingSettingId(status) {
  if (!status || status.pending !== true) return '';
  if (status.requestId) return String(status.requestId);
  // 升级前已落盘的 pending 没有请求 ID，使用原有字段生成稳定兼容标识。
  return 'legacy-' + String(status.at || '') + '-' + (status.target === false ? 'off' : 'on');
}

function nativeSyncRequestedSetting(stored) {
  const request = stored && stored[NATIVE_SYNC_REQUEST_KEY];
  if (request && typeof request === 'object' && request.id && typeof request.target === 'boolean') {
    return { id: String(request.id), target: request.target };
  }
  const status = stored && stored[SYNC_STATUS_KEY];
  const id = nativeSyncPendingSettingId(status);
  return id ? { id, target: stored[NATIVE_SYNC_ENABLED_KEY] === true } : null;
}

async function completeNativeSyncSetting(api, settingId) {
  if (!settingId) return false;
  const stored = await api.storage.local.get([
    NATIVE_SYNC_REQUEST_KEY, NATIVE_SYNC_ENABLED_KEY, SYNC_STATUS_KEY
  ]);
  const current = nativeSyncRequestedSetting(stored);
  if (!current || current.id !== settingId) {
    await clearNativeSyncSettingAlarm(api, settingId);
    return false;
  }
  await api.storage.local.set({ [NATIVE_SYNC_COMPLETED_REQUEST_KEY]: settingId });
  // 请求 ID 是 alarm 名的一部分，旧任务完成不会误清新请求的恢复闹钟。
  await clearNativeSyncSettingAlarm(api, settingId, true);
  return true;
}

async function isCurrentNativeSyncSetting(api) {
  if (!nativeSyncActiveSettingId) return true;
  const stored = await api.storage.local.get([
    NATIVE_SYNC_REQUEST_KEY, NATIVE_SYNC_COMPLETED_REQUEST_KEY,
    NATIVE_SYNC_ENABLED_KEY, SYNC_STATUS_KEY
  ]);
  const current = nativeSyncRequestedSetting(stored);
  return !!current && current.id === nativeSyncActiveSettingId &&
    stored[NATIVE_SYNC_COMPLETED_REQUEST_KEY] !== current.id;
}

async function canUpdateNativeSyncStatus(api) {
  const stored = await api.storage.local.get([
    NATIVE_SYNC_REQUEST_KEY, NATIVE_SYNC_COMPLETED_REQUEST_KEY,
    NATIVE_SYNC_ENABLED_KEY, SYNC_STATUS_KEY
  ]);
  const current = nativeSyncRequestedSetting(stored);
  if (!current || stored[NATIVE_SYNC_COMPLETED_REQUEST_KEY] === current.id) return true;
  return !!nativeSyncActiveSettingId && current.id === nativeSyncActiveSettingId;
}

async function runPendingNativeSyncSetting(api, alarmSettingId = '') {
  const stored = await api.storage.local.get([
    NATIVE_SYNC_REQUEST_KEY, NATIVE_SYNC_COMPLETED_REQUEST_KEY,
    NATIVE_SYNC_ENABLED_KEY, SYNC_STATUS_KEY
  ]);
  const current = nativeSyncRequestedSetting(stored);
  if (!current || stored[NATIVE_SYNC_COMPLETED_REQUEST_KEY] === current.id) {
    if (alarmSettingId) await clearNativeSyncSettingAlarm(api, alarmSettingId);
    return false;
  }
  if (alarmSettingId && alarmSettingId !== current.id) {
    await clearNativeSyncSettingAlarm(api, alarmSettingId);
  }
  let completed = false;
  try {
    const result = await setNativeSyncEnabled(api, current.target, current.id);
    if (result && result.retry) {
      scheduleNativeSyncSettingRetry(api, current.id);
      return result;
    }
    completed = true;
    return result;
  } catch (error) {
    const previousSettingId = nativeSyncActiveSettingId;
    nativeSyncActiveSettingId = current.id;
    try {
      await setBackgroundTagSyncStatus(api, error && error.message || error);
    } finally {
      nativeSyncActiveSettingId = previousSettingId;
    }
    scheduleNativeSyncSettingRetry(api, current.id);
    throw error;
  } finally {
    if (completed) await completeNativeSyncSetting(api, current.id);
  }
}

function resumePendingNativeSyncSetting(api = chrome) {
  if (!api.storage || !api.storage.local) return;
  api.storage.local.get([
    NATIVE_SYNC_REQUEST_KEY, NATIVE_SYNC_COMPLETED_REQUEST_KEY,
    NATIVE_SYNC_ENABLED_KEY, SYNC_STATUS_KEY
  ])
    .then(stored => {
      const current = nativeSyncRequestedSetting(stored);
      if (!current || stored[NATIVE_SYNC_COMPLETED_REQUEST_KEY] === current.id) {
        clearStaleNativeSyncSettingAlarms(api).catch(() => {});
        return false;
      }
      scheduleNativeSyncSettingRetry(api, current.id);
      clearStaleNativeSyncSettingAlarms(api, current.id).catch(() => {});
      // 闹钟与启动恢复可能同时排队；实际执行前再次读取 pending，确保只执行一次。
      return nativeQueue(() => runPendingNativeSyncSetting(api));
    })
    .catch(error => {
      setBackgroundTagSyncStatus(api, error && error.message || error)
        .catch(statusError => console.warn('[书签管家] 原生标签同步错误状态写入失败', statusError));
      console.warn('[书签管家] 恢复原生标签同步设置失败', error);
    });
}

async function clearBackgroundTransportSyncError(api, expected) {
  if (!expected || !CLOSED_NATIVE_SYNC_CHANNEL.test(String(expected.lastError || ''))) return false;
  const stored = await api.storage.local.get(SYNC_STATUS_KEY);
  const current = stored[SYNC_STATUS_KEY];
  const explicitTransport = expected.errorKind === 'transport' && current && current.errorKind === 'transport';
  const legacyTransport = expected.errorKind === 'legacy-transport' && current && current.errorKind == null &&
    LEGACY_CLOSED_NATIVE_SYNC_CHANNEL.test(String(expected.lastError));
  if ((!explicitTransport && !legacyTransport) || current.lastError !== expected.lastError ||
    current.at !== expected.at) return false;
  const { errorKind: _errorKind, ...status } = current;
  await api.storage.local.set({
    [SYNC_STATUS_KEY]: { ...status, lastError: '', at: Date.now() }
  });
  return true;
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[NATIVE_SYNC_CONFIG_REQUEST_KEY]) {
      const request = nativeConfigWriteRequest(changes[NATIVE_SYNC_CONFIG_REQUEST_KEY].newValue);
      if (request) {
        nativeQueue(() => runPendingNativeConfigWrite(chrome, request.id))
          .catch(error => console.warn('[书签管家] 标签配置保存失败', error));
      }
    }
    // 设置页只写入持久化请求，避免等待 MV3 消息通道；storage 事件会唤醒后台立即执行。
    if (changes[NATIVE_SYNC_REQUEST_KEY]) {
      const request = changes[NATIVE_SYNC_REQUEST_KEY].newValue;
      if (request && request.id) {
        const requestId = String(request.id);
        scheduleNativeSyncSettingRetry(chrome, requestId);
        clearStaleNativeSyncSettingAlarms(chrome, requestId).catch(() => {});
      } else {
        clearStaleNativeSyncSettingAlarms(chrome).catch(() => {});
      }
      nativeQueue(() => runPendingNativeSyncSetting(chrome))
        .catch(error => {
          setBackgroundTagSyncStatus(chrome, error && error.message || error)
            .catch(statusError => console.warn('[书签管家] 原生标签同步错误状态写入失败', statusError));
          console.warn('[书签管家] 原生标签同步设置失败', error);
        });
    }
    if (changes[TAGS_KEY] && !consumeIgnoredNativeTagChange(changes[TAGS_KEY].newValue)) {
      nativeQueue(() => recordNativeTagChanges(chrome, changes[TAGS_KEY]))
        .catch(async error => {
          await setBackgroundTagSyncStatus(chrome, error && error.message || error);
          console.warn('[书签管家] 原生标签同步写入失败', error);
        });
    }
    if (changes[HIDDEN_KEY]) {
      nativeQueue(() => recordNativeHiddenChanges(chrome, changes[HIDDEN_KEY]))
        .catch(async error => {
          await setBackgroundTagSyncStatus(chrome, error && error.message || error);
          console.warn('[书签管家] 原生隐藏状态同步写入失败', error);
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

// 插件内 ➕ 新增保存后的按需补齐：与 ⭐ 收藏共用同一套默认规则，
// 只在本地建议没有给出标签时调用，避免重复请求 AI。
async function autoTagBookmarkOnDemand(bookmarkId, allowAi) {
  const id = String(bookmarkId || '');
  if (!id) return { tags: [] };
  const nodes = await chrome.bookmarks.get(id);
  const bookmark = nodes && nodes[0];
  if (!bookmark || !bookmark.url) return { tags: [] };
  const result = await autoTagBrowserBookmarks([[id, bookmark, allowAi !== false]]);
  const tags = (result && result.tags && result.tags[id]) || [];
  return { tags };
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
    if (action === NATIVE_SYNC_WAKE_ACTION) {
      // 只确认后台已被唤醒，实际书签读写留在队列中异步进行，避免重现 MV3 消息通道超时。
      nativeQueue(() => runPendingNativeSyncSetting(chrome))
        .catch(error => console.warn('[书签管家] 原生标签同步唤醒失败', error));
      sendResponse({ ok: true, accepted: true });
      return;
    }
    let task;
    if (action === 'setEnabled') task = nativeQueue(() => setNativeSyncEnabled(chrome, !!message.enabled));
    else if (action === 'hydrate') {
      task = nativeQueue(async () => {
        await runPendingNativeConfigWrite(chrome);
        return hydrateNativeSyncResult(chrome, false, message.configSnapshot);
      });
    }
    else if (action === 'saveConfig') {
      task = nativeQueue(() => runPendingNativeConfigWrite(chrome, message.id));
    }
    else if (action === 'publish') task = nativeQueue(() => publishNativeSync(chrome, null, !!message.includeConfig));
    else if (action === 'clearTransportError') {
      task = nativeQueue(() => clearBackgroundTransportSyncError(chrome, message.status));
    }
    else if (action === 'migrateUrl') {
      task = nativeQueue(() => recordNativeBookmarkUrlMigration(chrome, message.id, message.oldUrl, message.newUrl));
    }
    else task = nativeQueue(() => hydrateNativeSyncResult(chrome));
    task.then(result => {
      const changed = result && typeof result === 'object' ? result.changed : result;
      sendResponse({ ok: true, changed: !!changed });
      if (result && typeof result === 'object' && result.retry) {
        try { scheduleNativeHydration(chrome, 1); }
        catch (scheduleError) { console.warn('[书签管家] 原生标签同步重试调度失败', scheduleError); }
      }
    })
      .catch(error => {
        // 必须先关闭消息请求；诊断写入或重试调度失败不能让调用方永远等待响应。
        sendResponse({ ok: false, error: error.message || String(error) });
        if (action === 'hydrate' || (action === 'setEnabled' && message.enabled)) {
          try { scheduleNativeHydration(chrome, 1); }
          catch (scheduleError) { console.warn('[书签管家] 原生标签同步重试调度失败', scheduleError); }
        }
        setBackgroundTagSyncStatus(chrome, error && error.message || error)
          .catch(statusError => console.warn('[书签管家] 原生标签同步错误状态写入失败', statusError));
      });
    return true;
  }
  if (message.type === TAG_MUTATION_MESSAGE) {
    commitTagChanges(message.changes, message.mode)
      .then(result => sendResponse({ ok: true, changed: result.changed }))
      .catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if (message.type === AUTO_TAG_MESSAGE) {
    autoTagBookmarkOnDemand(message.bookmarkId, message.allowAi)
      .then(result => sendResponse({ ok: true, tags: result.tags }))
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
        nativeSyncReady = hydration.ready && !hydration.awaitingDeviceData;
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
  if (isNativeSyncSettingAlarm(alarm.name)) {
    nativeQueue(() => runPendingNativeSyncSetting(chrome, nativeSyncSettingAlarmId(alarm.name)))
      .catch(error => {
        setBackgroundTagSyncStatus(chrome, error && error.message || error)
          .catch(statusError => console.warn('[书签管家] 原生标签同步错误状态写入失败', statusError));
        console.warn('[书签管家] 原生标签同步设置失败', error);
      });
    return;
  }
  const hydrationRetryAttempt = nativeHydrationAlarmAttempt(alarm.name);
  if (hydrationRetryAttempt) {
    runScheduledNativeHydration(chrome, hydrationRetryAttempt);
    return;
  }
  if (alarm.name !== 'bm-trash-purge') return;
  purgeExpiredTrash()
    .then(n => { if (n) console.log('[书签管家] 回收站已自动清理 ' + n + ' 条过期项'); })
    .catch(err => console.warn('[书签管家] 回收站定时清理失败', err));
});

// 设置页先持久化意图，再由闹钟触发实际书签写入。若扩展重载丢失闹钟，
// 任意一次 Service Worker 启动都从 pending 状态补跑，避免留下空设备目录。
resumePendingNativeSyncSetting();

// 保留极简后台：书签读写都在侧边栏内通过 chrome.bookmarks API 完成。
chrome.runtime.onStartup.addListener(() => {
  console.log('[书签管家] 浏览器启动');
});
