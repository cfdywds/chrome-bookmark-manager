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
const SYNC_ENABLED_KEY = 'bmSyncEnabled';
const SYNC_TAG_PREFIX = 'bmSyncTag_p';
const SYNC_TAG_CNT = 'bmSyncTag_cnt';
const SYNC_STATUS_KEY = 'bmTagSyncStatus';
const SYNC_CHUNK_CHARS = 2500;
const SYNC_TAG_DELAY_MS = 1500;
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
let tagSyncTimer = null;
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
    const path = url.pathname.replace(/\/+$/, '');
    const hashRoute = /^#!?\//.test(url.hash) ? url.hash.toLowerCase() : '';
    return (host + path + url.search + hashRoute).toLowerCase();
  } catch (e) {
    return String(rawUrl || '').trim().toLowerCase();
  }
}

function collectSyncBookmarks(nodes, out) {
  (nodes || []).forEach(node => {
    if (node && node.url) out.push(node);
    if (node && node.children) collectSyncBookmarks(node.children, out);
  });
  return out;
}

function projectTagsForBackgroundSync(tags, tree) {
  const out = {};
  collectSyncBookmarks(tree, []).forEach(bookmark => {
    const key = syncUrlKey(bookmark.url);
    const values = tags && tags[bookmark.id];
    if (!key || !Array.isArray(values)) return;
    const clean = values.filter(tag => tag && tag !== FALLBACK_TAG);
    if (!clean.length) return;
    out[key] = [...new Set([...(out[key] || []), ...clean])].slice(0, 6);
  });
  return out;
}

function serializeBackgroundSyncTags(tags) {
  const json = JSON.stringify({ version: 2, tags: tags || {} });
  const out = {};
  let count = 0;
  for (let index = 0; index < json.length; index += SYNC_CHUNK_CHARS) {
    out[SYNC_TAG_PREFIX + count] = json.slice(index, index + SYNC_CHUNK_CHARS);
    count++;
  }
  out[SYNC_TAG_CNT] = count;
  return out;
}

async function isBackgroundTagSyncEnabled(api) {
  const synced = await api.storage.sync.get(SYNC_ENABLED_KEY);
  if (synced[SYNC_ENABLED_KEY]) return true;
  const local = await api.storage.local.get(SYNC_ENABLED_KEY);
  if (!local[SYNC_ENABLED_KEY]) return false;
  await api.storage.sync.set({ [SYNC_ENABLED_KEY]: true });
  return true;
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

async function pushBackgroundTagsToCloud(api) {
  try {
    if (!await isBackgroundTagSyncEnabled(api)) return false;
    const [stored, tree] = await Promise.all([
      api.storage.local.get(TAGS_KEY),
      api.bookmarks.getTree()
    ]);
    const tags = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? stored[TAGS_KEY] : {};
    await api.storage.sync.set(serializeBackgroundSyncTags(projectTagsForBackgroundSync(tags, tree)));
    await setBackgroundTagSyncStatus(api, '');
    return true;
  } catch (e) {
    await setBackgroundTagSyncStatus(api, (e && e.message) || e);
    throw e;
  }
}

function scheduleBackgroundTagSync() {
  if (tagSyncTimer) clearTimeout(tagSyncTimer);
  const api = chrome;
  tagSyncTimer = setTimeout(() => {
    tagSyncTimer = null;
    pushBackgroundTagsToCloud(api).catch(error => console.warn('[书签管家] 标签云同步失败', error));
  }, SYNC_TAG_DELAY_MS);
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[TAGS_KEY]) scheduleBackgroundTagSync();
  });
}

function poolTag(pool, name) {
  const normalized = String(name || '').trim().toLowerCase();
  return pool.find(tag => String(tag).toLowerCase() === normalized) || '';
}

function backgroundFixedTagPool(storedTags) {
  let pool = [];
  if (!Array.isArray(storedTags) || !storedTags.length) {
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
  if (!bookmark || !bookmark.url) return;
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
    // 5. 浏览器已完成创建：后台批量写默认标签，不唤起或预填插件界面。
    autoTagTask = queueBrowserBookmarkAutoTag(id, bookmark, fromNativeImport, !fromNativeImport);
  } finally {
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

// 用户在浏览器原生管理器编辑/删除书签时，popup 打开时检测 + 提示重新扫描
chrome.bookmarks.onChanged.addListener(() => { /* popup 内 refresh() 会感知 */ });
chrome.bookmarks.onRemoved.addListener(() => { /* 同上 */ });
chrome.bookmarks.onMoved.addListener(() => { /* 同上 */ });

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
