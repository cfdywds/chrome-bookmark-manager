// ===== 书签管家 · 交互逻辑 v2（全面改版） =====
'use strict';

let DATA = null;
let currentTab = 'overview';
let overviewDetail = ''; // clean | trash；由概览待办项进入的工具视图
let SEARCH = ''; // 全局搜索词
let SEARCH_SCOPE = 'all'; // 搜索范围：all | title | tag | url（由搜索框右侧 chips 切换）
let searchTimer = null;
let TAG_FILTER = ''; // 标签筛选：当前选中的标签（'' = 全部）
let tabRenderToken = 0;
let listRenderLimits = Object.create(null);
let refreshInFlight = null;
let refreshQueued = false;
let tagRenderToken = 0;
let trashRestoreInProgress = false;
let activeProgressCancel = null;
let FOLDER_NAV = { folderId: '' }; // 「组织」页文件夹视图当前浏览的文件夹 id（空=书签栏根）
let ORG_VIEW = (function () {
  try { return sessionStorage.getItem('bm-org-view') === 'folders' ? 'folders' : 'tags'; } catch (e) { return 'tags'; }
})(); // 「组织」页视图：tags | folders（sessionStorage 持久）
let editingFolder = null; // 就地编辑状态：{mode:'new'|'rename', id?, parentId?, tempId?}
let FOLDER_SORT = (function () { try { return sessionStorage.getItem('bm-folder-sort') || 'manual'; } catch (e) { return 'manual'; } })(); // manual | name | added
let FOLDER_SEARCH = ''; // 文件夹视图内搜索（仅过滤当前层书签）
let highlightFolderId = ''; // 操作后高亮定位的 id
let crumbExpanded = false; // 面包屑是否展开（收缩态点 … 后置 true）

const FIRST_GROUP_COUNT = 24;
const FIRST_LIST_COUNT = 80;
const FIRST_GROUP_ITEM_COUNT = 20;
const FIRST_TAG_PREVIEW_COUNT = 12;
const FIRST_TAG_FILTER_COUNT = 40;
const FIRST_TAG_GROUP_COUNT = 2;
const DELETE_CONCURRENCY = 8;
const TAG_CLEAR_BATCH_SIZE = 400;
const DELETE_PROGRESS_INTERVAL_MS = 80;
const TRASH_DELETE_HEARTBEAT_INTERVAL_MS = 5000;
const SELF_CREATION_MESSAGE = 'bmSelfCreatingBookmark';
const AUTO_TAG_MESSAGE = 'bmAutoTagBookmark';
const SEARCH_SCOPE_VALUES = ['all', 'title', 'tag', 'url']; // 搜索范围取值（与 #searchScope chips 的 data-scope 一致）
const SEARCH_SCOPE_LABELS = { all: '全部', title: '标题', tag: '标签', url: '网址' };
// 反馈分级：ok | info | warn | danger（info 用于一次性引导等中性提示）
const TOAST_LEVELS = { ok: 'ok', info: 'info', warn: 'warn', danger: 'danger' };
// 「组织」页一次性拖拽引导标记（chrome.storage.local 键），失败静默
const ORGANIZE_TIP_KEY = 'bmOrganizeTipShown';
const ORGANIZE_TIP_TEXT = '拖动书签行左侧把手可排序，拖到分组标题上可移动分组';

// ---- LLM 设置：服务商预设统一来自 lib.js（DRY，与 options.js 共享同一份配置）----
const PROVIDERS = BM.PROVIDERS;
let SETTINGS = { provider: 'deepseek', baseUrl: '', apiKey: '', model: '' };
let settingsReady = Promise.resolve();
let tagConfigurationReady = Promise.resolve();
let tagConfigurationSyncFailed = false;

// ---- SVG 图标助手（配合 popup.html 的 <symbol> sprite，替代 emoji）----
const ICON = name =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="icons/sprite.svg#i-${name}"/></svg>`;
const ICON_SM = name =>
  `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="icons/sprite.svg#i-${name}"/></svg>`;
// 文件夹行图标（带 f-icon 类，便于 CSS 着色 / 空文件夹弱化）
const FOLDER_ICON_SM = ICON_SM('folder').replace('ico ico-sm', 'ico ico-sm f-icon');

// ---- 统一方案引擎：删除整理操作走「预览 → 确认 → 执行」----
let planMode = false;
let PLAN = null; // { type:'delete', groups:[...] }
let EDITING = null; // 编辑模式：正在编辑的书签项（null = 新增模式）

const $ = sel => document.querySelector(sel);
const content = () => $('#content');

function getItemById(id) {
  if (!DATA) return null;
  if (DATA.itemById) return DATA.itemById.get(id) || null;
  return DATA.items.find(item => item.id === id) || null;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 搜索命中高亮：把文本中所有匹配 q 的片段包 <mark>
function highlightHtml(text, q) {
  const s = String(text == null ? '' : text);
  const low = s.toLowerCase();
  const ql = String(q).toLowerCase();
  if (!ql || !low.includes(ql)) return escapeHtml(s);
  let out = '',
    i = 0;
  while (i < s.length) {
    const j = low.indexOf(ql, i);
    if (j < 0) {
      out += escapeHtml(s.slice(i));
      break;
    }
    out += escapeHtml(s.slice(i, j)) + '<mark>' + escapeHtml(s.slice(j, j + ql.length)) + '</mark>';
    i = j + ql.length;
  }
  return out;
}

// ---------- 反馈组件：Toast / 进度条 ----------
// type: 'ok'（默认）| 'info' | 'warn' | 'danger'；未知值一律回落到 'ok'
function toast(msg, type, action) {
  // 渲染统一交给共享原语 js/ui.js（与 options 同一实现）；UI 缺失时退回下方本地实现
  if (window.UI && typeof window.UI.toast === 'function') {
    window.UI.toast(msg, type, action);
    return;
  }
  const box = $('#toasts');
  const el = document.createElement('div');
  // 与 UI.normalizeLevel 保持一致（true → danger），避免兜底路径语义分叉
  const level = type === true ? 'danger' : TOAST_LEVELS[type] || 'ok';
  el.className = 'toast ' + level;
  el.setAttribute('role', level === 'danger' || level === 'warn' ? 'alert' : 'status');
  el.setAttribute('aria-live', level === 'danger' || level === 'warn' ? 'assertive' : 'polite');
  const txt = document.createElement('span');
  txt.textContent = msg;
  el.appendChild(txt);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      action.onClick && action.onClick();
    });
    el.appendChild(btn);
  }
  box.appendChild(el);
  setTimeout(
    () => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 320);
    },
    action ? 10000 : 2600
  ); // 可撤销操作给足 10s 窗口
}

function showPersistentError(title, detail, action) {
  $('#operationNoticeTitle').textContent = title;
  $('#operationNoticeDetail').textContent = detail;
  $('#operationNoticeTitle').id = 'operationNoticeTitle';
  const actionButton = $('#operationNoticeAction');
  if (actionButton) {
    if (action) {
      actionButton.textContent = action.label;
      actionButton.onclick = action.onClick;
      actionButton.classList.remove('hidden');
    } else {
      actionButton.onclick = null;
      actionButton.classList.add('hidden');
    }
  }
  $('#operationNotice').classList.remove('hidden');
  $('#app').classList.add('has-operation-notice');
}

function clearPersistentError() {
  const actionButton = $('#operationNoticeAction');
  if (actionButton) {
    actionButton.onclick = null;
    actionButton.classList.add('hidden');
  }
  $('#operationNotice').classList.add('hidden');
  $('#app').classList.remove('has-operation-notice');
}

// 与标签页的“未打标”口径一致：没有有效标签，或仅有“其他”，都应继续交给 AI 打标。
function isAiTagPending(item) {
  return !(item.tags || []).some(tag => tag && tag !== BM.FALLBACK_TAG);
}

function getAiTagTargets(force) {
  const items = (DATA && DATA.items) || [];
  if (force) return items.slice();
  // 常规打标始终排除隐藏书签；全量重打才包含隐藏书签。
  const scope = items.filter(item => !item.hidden);
  return scope.filter(isAiTagPending);
}

function getCustomRuleCount() {
  const rules = BM.getTagRules ? BM.getTagRules() || {} : {};
  return Object.keys(rules.domain || {}).length + Object.keys(rules.keyword || {}).length;
}

// 同址书签统一处理：标题不同仍可命中不同规则，但最终标签保持一致。
function collectCustomRuleApplications(mode) {
  const tagsById = BM.getTags() || {};
  const groups = new Map();
  ((DATA && DATA.items) || []).forEach(item => {
    const key = item.key || BM.urlKey(item.url || '') || 'bookmark:' + item.id;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  });

  const changes = {};
  let matched = 0;
  groups.forEach(items => {
    const ruleTags = BM.unionTagLists(
      items.map(item => {
        const result = BM.matchCustomTagRules({
          host: item.host,
          url: item.url,
          title: item.title
        });
        return [...(result.domain || []), ...(result.keyword || [])];
      })
    );
    if (!ruleTags.length) return;
    matched += items.length;

    const current = BM.unionTagLists(items.map(item => tagsById[item.id] || item.tags || []));
    const hasMeaningfulTag = current.some(tag => tag && tag !== BM.FALLBACK_TAG);
    if (mode === 'untagged' && hasMeaningfulTag) return;
    const next = mode === 'append' ? BM.unionTagLists([current, ruleTags]) : ruleTags;
    items.forEach(item => {
      const existing = tagsById[item.id] || item.tags || [];
      if (existing.length !== next.length || existing.some((tag, index) => tag !== next[index])) {
        changes[item.id] = next;
      }
    });
  });
  return { matched, changes, changed: Object.keys(changes).length };
}

async function applyCustomRules(trigger) {
  const originalText = trigger ? trigger.textContent : '';
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = '读取规则…';
  }
  try {
    await Promise.all([BM.loadTags(), BM.loadFixedTags(), BM.loadTagRules()]);
    if (!getCustomRuleCount()) {
      toast(
        '还没有自定义规则：到「设置 → 标签体系」添加一条（如 github=代码），就能一键批量应用',
        'warn'
      );
      return;
    }

    const previews = {
      append: collectCustomRuleApplications('append'),
      replace: collectCustomRuleApplications('replace'),
      untagged: collectCustomRuleApplications('untagged')
    };
    const matched = previews.append.matched;
    if (!matched) {
      toast('当前规则没有匹配到任何书签——检查关键字是否出现在网址、域名或标题里', 'warn');
      return;
    }
    if (trigger) trigger.textContent = '选择策略…';
    const choice = await confirmDialog({
      title: '应用自定义规则',
      message:
        `命中 <b>${matched}</b> 个书签；全程在本地处理，不调用 AI。<br>` +
        `仅未标：${previews.untagged.changed} 项；追加：${previews.append.changed} 项；覆盖：${previews.replace.changed} 项。`,
      confirmText: '追加',
      thirdText: '覆盖',
      fourthText: '仅未标',
      danger: false
    });
    const mode =
      choice === true
        ? 'append'
        : choice === 'third'
          ? 'replace'
          : choice === 'fourth'
            ? 'untagged'
            : '';
    if (!mode) return;

    const result = collectCustomRuleApplications(mode);
    if (!result.changed) {
      toast('命中的书签都已是目标状态，无需更改 ✓', 'ok');
      return;
    }
    const saved = await BM.setTagsBatch(result.changes);
    if (!saved) throw new Error('标签保存失败');
    const modeLabel = mode === 'append' ? '追加' : mode === 'replace' ? '覆盖' : '补全未标';
    toast(`已按自定义规则${modeLabel} ${result.changed} 个书签`, 'ok');
    refresh();
  } catch (e) {
    toast('应用规则失败：' + (e.message || e), 'danger');
    try {
      BM.logError('apply-custom-rules', e);
    } catch (e2) {
      /* ignore */
    }
  } finally {
    if (trigger && document.contains(trigger)) {
      trigger.disabled = false;
      trigger.textContent = originalText;
    }
  }
}

// 跳到设置页的自定义规则界面（设置页「标签体系」分组，锚点 #opt-tags）。
// 扩展没申请 tabs 权限，所以用 runtime.getContexts 找已打开的设置页：找到就激活它并只改 hash
// （fragment 变化不重载文档，设置页里没保存的编辑不会丢），没找到才新开一个标签页。
async function openCustomRuleSettings() {
  const base = chrome.runtime.getURL('options.html');
  const target = base + '#opt-tags';
  try {
    if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
      const opened = contexts.find(ctx => (ctx.documentUrl || '').split('#')[0] === base);
      if (opened && opened.tabId != null) {
        await chrome.tabs.update(opened.tabId, { active: true, url: target });
        return;
      }
    }
  } catch (e) {
    /* 查询失败就退回新开标签页 */
  }
  try {
    await chrome.tabs.create({ url: target, active: true });
  } catch (e) {
    try {
      chrome.runtime.openOptionsPage();
    } catch (e2) {
      toast('打开设置页失败，请从扩展菜单进入选项页', 'danger');
    }
  }
}

// 自定义确认弹层（替代原生 confirm，视觉统一、可定制文案）
function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const wrap = $('#confirmWrap');
    if (!wrap) {
      resolve(false);
      return;
    }
    const restoreFocusTo = document.activeElement;
    $('#confirmTitle').textContent = opts.title || '确认操作？';
    $('#confirmMsg').innerHTML = opts.message || '';
    const yes = $('#confirmYes');
    yes.textContent = opts.confirmText || '确认';
    yes.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
    const third = $('#confirmThird');
    if (opts.thirdText) {
      third.textContent = opts.thirdText;
      third.classList.remove('hidden');
    } else {
      third.classList.add('hidden');
    }
    const fourth = $('#confirmFourth');
    if (opts.fourthText) {
      fourth.textContent = opts.fourthText;
      fourth.classList.remove('hidden');
    } else {
      fourth.classList.add('hidden');
    }
    const no = $('#confirmNo');
    // 弹层内 Tab 循环 / Esc 取消统一走共享 UI 原语；Esc 优先在 wrap 内处理（stopPropagation 防止连带触发页面级 Esc）。
    let releaseTrap = null;
    let settled = false;
    const onWrapClick = e => {
      if (e.target === wrap) done(false);
    };
    const done = v => {
      if (settled) return;
      settled = true;
      wrap.classList.add('hidden');
      yes.onclick = no.onclick = third.onclick = fourth.onclick = null;
      wrap.removeEventListener('click', onWrapClick);
      wrap.removeEventListener('keydown', onKey);
      // release() 负责归还焦点给触发元素
      if (typeof releaseTrap === 'function') releaseTrap();
      else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
      resolve(v);
    };
    // Enter 仅在焦点不在按钮上时视为确认；焦点在「取消」等按钮时应由按钮自身的点击语义生效。
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
        return;
      }
      if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) {
        done(true);
      }
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    if (opts.thirdText) third.onclick = () => done('third');
    if (opts.fourthText) fourth.onclick = () => done('fourth');
    wrap.addEventListener('click', onWrapClick);
    wrap.addEventListener('keydown', onKey);
    wrap.classList.remove('hidden');
    if (window.UI)
      releaseTrap = window.UI.focusTrap(wrap, {
        onEscape: () => done(false),
        autofocus: false,
        restoreFocusTo
      });
    yes.focus();
  });
}

// 输入弹层：resolve 输入字符串（取消/为空 → null）
function promptDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const wrap = $('#promptWrap');
    if (!wrap) {
      resolve(null);
      return;
    }
    const restoreFocusTo = document.activeElement;
    $('#promptTitle').textContent = opts.title || '输入';
    $('#promptMsg').textContent = opts.message || '';
    const input = $('#promptInput');
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '输入内容…';
    const yes = $('#promptYes');
    const no = $('#promptNo');
    let releaseTrap = null;
    let settled = false;
    const onWrapClick = e => {
      if (e.target === wrap) done(null);
    };
    const done = v => {
      if (settled) return;
      settled = true;
      wrap.classList.add('hidden');
      yes.onclick = no.onclick = null;
      wrap.removeEventListener('click', onWrapClick);
      wrap.removeEventListener('keydown', onKey);
      if (typeof releaseTrap === 'function') releaseTrap();
      else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
        return;
      }
      if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) {
        done(input.value.trim() || null);
      }
    };
    yes.onclick = () => done(input.value.trim() || null);
    no.onclick = () => done(null);
    wrap.addEventListener('click', onWrapClick);
    wrap.addEventListener('keydown', onKey);
    wrap.classList.remove('hidden');
    if (window.UI)
      releaseTrap = window.UI.focusTrap(wrap, {
        onEscape: () => done(null),
        autofocus: false,
        restoreFocusTo
      });
    input.focus();
    input.select();
  });
}

function startProgress(label, opts) {
  opts = opts || {};
  const w = $('#progressWrap');
  w.classList.remove('hidden');
  $('#progressBar').style.width = '0%';
  $('#progressLabel').textContent = label || '处理中…';
  const cancel = $('#progressCancel');
  activeProgressCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;
  if (activeProgressCancel) {
    cancel.textContent = opts.cancelText || '终止';
    cancel.disabled = false;
    cancel.classList.remove('hidden');
    cancel.onclick = () => {
      if (!activeProgressCancel) return;
      activeProgressCancel();
      cancel.disabled = true;
      cancel.textContent = '终止中…';
    };
  } else {
    cancel.onclick = null;
    cancel.classList.add('hidden');
  }
}
function updateProgress(pct, label) {
  $('#progressBar').style.width = pct + '%';
  const bar = $('#progressBar').parentElement;
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  if (label) $('#progressLabel').textContent = label;
}
function endProgress() {
  $('#progressWrap').classList.add('hidden');
  const cancel = $('#progressCancel');
  cancel.onclick = null;
  cancel.disabled = false;
  cancel.classList.add('hidden');
  activeProgressCancel = null;
}

// 删除（可选进度 + 返回实际成功删除的 ID）
async function removeForIds(ids, label, opts) {
  opts = opts || {};
  const targets = [...new Set((ids || []).filter(Boolean))];
  if (!targets.length) return { count: 0, removedIds: [] };
  if (label) startProgress(label);
  let nextIndex = 0;
  let completed = 0;
  let lastProgressAt = 0;
  const removedIds = [];
  const total = targets.length;
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(Number(opts.concurrency) || DELETE_CONCURRENCY), total)
  );
  const shouldClearTags = opts.clearTags !== false;

  const reportProgress = force => {
    if (!label) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < DELETE_PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    updateProgress(Math.round((completed / total) * 100), label + ' ' + completed + '/' + total);
  };
  const worker = async () => {
    while (nextIndex < total) {
      const id = targets[nextIndex++];
      try {
        await chrome.bookmarks.remove(id);
        removedIds.push(id);
      } catch (e) {
        console.warn('[书签管家] 删除失败', id, e);
      } finally {
        completed++;
        reportProgress(completed === total);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // 只清理已实际删除的书签；分批写入避免逐条序列化整张标签映射。
    if (shouldClearTags) {
      for (let start = 0; start < removedIds.length; start += TAG_CLEAR_BATCH_SIZE) {
        const changes = Object.fromEntries(
          removedIds.slice(start, start + TAG_CLEAR_BATCH_SIZE).map(id => [id, null])
        );
        try {
          if (label) updateProgress(100, label + ' 正在清理标签…');
          await BM.setTagsBatch(changes);
        } catch (e) {
          console.warn('[书签管家] 批量清理标签失败', e);
        }
      }
    }
    return { count: removedIds.length, removedIds };
  } finally {
    if (label) endProgress();
  }
}

// 仅用于去重后：移除因本次删掉最后一条书签而变空的父目录及其空祖先。
// Chrome 根节点、书签栏、其他书签等系统容器始终保留。
async function pruneDuplicateEmptyFolders(parentIds) {
  const requested = new Set((parentIds || []).filter(Boolean));
  if (!requested.size) return 0;

  const tree = await chrome.bookmarks.getTree();
  const nodesById = new Map();
  const protectedIds = new Set();
  const stack = [];
  (tree || []).forEach(root => {
    if (root && root.id) protectedIds.add(root.id);
    ((root && root.children) || []).forEach(child => {
      if (child && child.id) protectedIds.add(child.id);
    });
    if (root) stack.push({ node: root, depth: 0 });
  });

  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node || !node.id) continue;
    nodesById.set(node.id, { ...node, depth });
    (node.children || []).forEach(child => stack.push({ node: child, depth: depth + 1 }));
  }

  // 只检查实际受影响父目录的祖先链，避免顺带清理无关的历史空目录。
  const candidates = new Set();
  requested.forEach(parentId => {
    let node = nodesById.get(parentId);
    while (node && !protectedIds.has(node.id)) {
      if (node.url) break;
      candidates.add(node.id);
      node = nodesById.get(node.parentId);
    }
  });

  let removed = 0;
  const removedIds = new Set();
  const orderedCandidates = [...candidates].sort(
    (left, right) => nodesById.get(right).depth - nodesById.get(left).depth
  );
  for (const candidateId of orderedCandidates) {
    if (removedIds.has(candidateId)) continue;
    try {
      // 只尝试候选链中的一个目录。仍有任意子项（包括历史空目录）时，
      // Chrome 会拒绝删除，从而不会扩大本次去重的清理范围。
      await chrome.bookmarks.remove(candidateId);
      removedIds.add(candidateId);
      removed++;
    } catch (e) {
      // 目录被浏览器或用户并发修改时保留，避免误删。
    }
  }
  return removed;
}

// 软删除（书签级）：先把书签信息备份进回收站，再物理删除 → 30 天内可恢复
// 返回 { n, items }：n=删除数，items=入站的书签信息（供「撤销」恢复）
async function softDelete(ids, label, opts) {
  opts = opts || {};
  if (trashRestoreInProgress) {
    toast('回收站恢复中，请稍候', 'warn');
    return { n: 0, items: [] };
  }
  if (!ids || !ids.length) return { n: 0, items: [] };
  const items = ids
    .map(id => {
      const it = getItemById(id);
      return it
        ? { id: it.id, title: it.title, url: it.url, parentId: it.parentId, path: it.path }
        : null;
    })
    .filter(Boolean);
  try {
    const added = await BM.addToTrash(items, { deletionPending: true });
    if (added !== items.length) throw new Error('未能完整写入回收站');
  } catch (e) {
    console.warn('[书签管家] 回收站备份失败', e);
    toast('移入回收站失败，书签未删除', 'danger');
    return { n: 0, items: [] };
  }
  const heartbeatIds = items.map(item => item.id);
  const heartbeat = setInterval(() => {
    BM.touchTrashDelete(heartbeatIds).catch(() => {});
  }, TRASH_DELETE_HEARTBEAT_INTERVAL_MS);
  try {
    const removal = await removeForIds(ids, label);
    const removedSet = new Set(removal.removedIds);
    const removedItems = items.filter(item => removedSet.has(item.id));
    const failedItems = items.filter(item => !removedSet.has(item.id));
    // 全部失败时必须出声：否则调用方只会看到「没有删除成功」，界面像是什么都没发生。
    if (items.length && !removedItems.length) {
      toast('删除失败：书签未能从浏览器移除，请重试', 'danger');
    }
    try {
      await BM.completeTrashDelete(
        removal.removedIds,
        failedItems.map(item => item.id)
      );
    } catch (e) {
      console.warn('[书签管家] 删除结果同步到回收站失败', e);
    }
    let prunedFolders = 0;
    if (opts.pruneEmptyFolders) {
      try {
        prunedFolders = await pruneDuplicateEmptyFolders(removedItems.map(item => item.parentId));
      } catch (e) {
        console.warn('[书签管家] 清理去重后空文件夹失败', e);
      }
    }
    return { n: removal.count, items: removedItems, prunedFolders };
  } finally {
    clearInterval(heartbeat);
  }
}

// 撤销删除：把刚删除的书签按原位置恢复（等价于回收站恢复）
async function undoDelete(items) {
  try {
    const result = await BM.restoreTrashItems(items);
    if (result.restored) toast('已撤销删除 ' + result.restored + ' 项 ✓', 'ok');
    if (result.failed.length) {
      // 带上后台给出的具体原因（如「书签删除仍在进行」），避免只提示「没能恢复」
      const reason = (result.failed[0] && result.failed[0].error) || '记录无法恢复';
      toast('撤销失败：' + reason + '，可到「概览 → 回收站」重试', 'warn');
    } else if (!result.restored) {
      // 记录已过期 / 已在回收站恢复：必须给出反馈，不能让「撤销」点了没有任何反应
      toast('没有可撤销的删除记录（可能已过期，或已在回收站中恢复）', 'warn');
    }
  } catch (e) {
    console.warn('[书签管家] 撤销失败', e);
    toast('撤销失败：' + (e.message || e), 'danger');
  }
  refresh();
}

// ---------- 渲染辅助 ----------
function openBookmarkUrl(rawUrl, active) {
  try {
    chrome.tabs.create({ url: BM.normalizeHttpUrl(rawUrl).href, active: !!active });
  } catch (e) {
    toast('这个链接不是普通网页（http/https），无法打开', 'warn');
  }
}

function itemRow(it, opts) {
  opts = opts || {};
  const q = opts.highlight || '';
  const cat = `<span class="tag cat">${escapeHtml(it.category)}</span>`;
  // 多标签 chips（点切换筛选）：过滤掉 #其他 兜底（数据层保留但 UI 不显示，归并到"收敛"流程）
  const tags = (it.tags || [])
    .filter(t => t !== BM.FALLBACK_TAG)
    .map(
      t =>
        `<button class="tag-chip" data-action="filter-tag" data-tag="${escapeHtml(t)}" data-tip="按标签筛选" aria-label="按标签 #${escapeHtml(t)} 筛选">#${escapeHtml(t)}</button>`
    )
    .join('');
  const deadDot = opts.dead
    ? `<span class="dead-dot ${it.dead || 'unknown'}" id="dot-${it.id}"></span>`
    : '';
  const titleHtml = q ? highlightHtml(it.title, q) : escapeHtml(it.title);
  const urlHtml = q ? highlightHtml(it.url, q) : escapeHtml(it.url);
  const hiddenCls = it.hidden ? ' row-hidden' : '';
  const searchCls = opts.search ? ' search-result-row' : '';
  const eyeTip = it.hidden ? '取消隐藏' : '隐藏此书签（从日常视图排除）';
  const eyeBtn = `<button class="row-eye" data-action="toggle-hidden" data-id="${it.id}" data-tip="${eyeTip}" aria-label="${eyeTip}">${it.hidden ? ICON_SM('eye-off') : ICON_SM('eye')}</button>`;
  const aiTip = (it.tags || []).some(t => t && t !== BM.FALLBACK_TAG)
    ? 'AI 重新打标（覆盖标签）'
    : 'AI 打标';
  const editTip = '编辑书签';
  return `<div class="row clickable draggable${hiddenCls}${searchCls}" data-id="${it.id}" id="row-${it.id}" tabindex="0" role="option" aria-selected="false" aria-label="${escapeHtml(it.title)}">
    <button class="drag-handle" type="button" draggable="true" data-action="drag-handle" data-id="${it.id}" data-tip="按住拖拽排序，或拖到分组标题上移动分组" aria-label="拖动 ${escapeHtml(it.title)}">${ICON_SM('drag')}</button>
    <label class="checkbox-slot"><input type="checkbox" class="checkbox sel" data-id="${it.id}" aria-label="选择 ${escapeHtml(it.title)}"></label>
    <div class="meta">
      <div class="title">${deadDot}${it.hidden ? '<span class="tag warn">已隐藏</span> ' : ''}${titleHtml}</div>
      <div class="url">${urlHtml}</div>
      <div class="loc"><span>${ICON_SM('folder')} ${escapeHtml(it.path.join(' / '))}</span> ${cat} ${tags}</div>
    </div>
    ${eyeBtn}
    <button class="row-ai" data-action="ai-tag-single" data-id="${it.id}" data-tip="${aiTip}" aria-label="AI 打标 ${escapeHtml(it.title)}">${ICON_SM('sparkles')}</button>
    <button class="row-edit" data-action="edit-item" data-id="${it.id}" data-tip="${editTip}" aria-label="编辑 ${escapeHtml(it.title)}">${ICON_SM('edit')}</button>
  </div>`;
}

function groupWrap(groupKey, icon, name, badgeCls, badgeText, actions, body) {
  return `<div class="group" data-group="${groupKey}">
    <div class="group-head" role="button" tabindex="0" aria-expanded="true">
      <div class="g-title">
        <span>${icon}</span>
        <span class="g-name" data-tip="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="badge ${badgeCls || ''}">${badgeText}</span>
      </div>
      <div class="actions">${actions}</div>
    </div>
    <div class="group-body">${body}</div>
  </div>`;
}

function emptyState(icon, title, desc, action) {
  const actionHtml =
    action && action.label
      ? `<button class="btn primary empty-action" type="button" data-action="${escapeHtml(
          action.action || ''
        )}">${escapeHtml(action.label)}</button>`
      : '';
  return `<div class="empty-state">
    <span class="empty-illustration">${icon}</span>
    <div class="title">${escapeHtml(title)}</div>
    <div class="desc">${escapeHtml(desc || '')}</div>
    ${actionHtml}
  </div>`;
}

function helpDot(text) {
  const tip = String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `<button class="help-dot" type="button" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip || '说明')}">?</button>`;
}

// 页面说明按需展开，避免占用书签列表空间。
function pageHint(_icon, text) {
  return `<div class="page-help">${helpDot(text)}</div>`;
}

// 大列表按需展开，避免切换页签时一次创建大量书签行和 favicon 请求。
function takeForRender(items, key, initial, step) {
  const limit = Math.max(initial, listRenderLimits[key] || initial);
  const count = Math.min(items.length, limit);
  return {
    items: items.slice(0, count),
    more:
      count < items.length
        ? `<button class="more-items" data-action="show-more" data-list="${escapeHtml(key)}" data-step="${step}">加载更多（已显示 ${count}/${items.length}）</button>`
        : ''
  };
}

function renderItemRows(items, key, initial, step, opts) {
  const page = takeForRender(items, key, initial, step);
  return page.items.map(it => itemRow(it, opts)).join('') + page.more;
}

// ---------- 总览：搜索 + 标签云 + 清理提醒 ----------
function renderOverview() {
  const d = DATA;
  const trashN = (d.trash || []).length;
  const stats = d.tagStats || {};
  const entries = Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const tagCount = Object.keys(stats).length;
  // 待办入口卡片（有待办项优先；无待办也保留卡片位置，避免首屏跳动）
  const acts = [
    {
      ico: ICON_SM('repeat'),
      name: '重复书签',
      n: d.exactDuplicates.length,
      jump: 'clean',
      sub: 'repeat',
      cls: 'danger',
      done: '无重复'
    },
    {
      ico: ICON_SM('folder'),
      name: '空文件夹',
      n: d.emptyFolders.length,
      jump: 'clean',
      sub: 'empty',
      cls: 'warn',
      done: '无空文件夹'
    },
    {
      ico: ICON_SM('archive'),
      name: '回收站',
      n: trashN,
      jump: 'trash',
      cls: '',
      done: '空'
    }
  ].sort((a, b) => (b.n > 0) - (a.n > 0));

  const entryCard = a => {
    const done = a.n === 0;
    const attrs = done ? '' : ` data-jump="${a.jump}"${a.sub ? ` data-sub="${a.sub}"` : ''}`;
    // 计数为 0 时没有动作，不能渲染成可聚焦的伪按钮（会误导键盘与读屏用户）
    const a11y = done ? ' aria-disabled="true"' : ' role="button" tabindex="0"';
    return `<div class="entry-card${done ? ' done' : ''}"${attrs}${a11y} aria-label="${a.name}：${done ? a.done : a.n}">
      <span class="entry-icon ${a.cls}">${a.ico}</span>
      <span class="entry-title">${a.name}</span>
      <span class="entry-count">${done ? a.done : a.n}</span>
    </div>`;
  };

  const tagChip = (t, n) => {
    return `<button class="tag-cloud" data-action="filter-tag" data-tag="${escapeHtml(t)}" aria-pressed="false">#${escapeHtml(t)}<span class="cnt">${n}</span></button>`;
  };

  content().innerHTML = `
    <div class="kpi">
      <div class="card big"><b>${d.total}</b><span>书签总数</span></div>
      <div class="card" data-jump="tags"><b>${tagCount}</b><span>标签</span></div>
      <div class="card" data-jump="clean"><b>${d.exactDuplicates.length + d.emptyFolders.length}</b><span>待清理</span></div>
      <div class="card" data-jump="trash"><b>${trashN}</b><span>回收站</span></div>
    </div>
    <div class="search-hero">
      <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="icons/sprite.svg#i-search"/></svg>
      <input id="heroSearch" type="text" placeholder="搜索标题、网址、域名、标签" autocomplete="off" spellcheck="false" />
    </div>
    <div class="overview-entries" role="group" aria-label="快捷入口">
      ${acts.map(entryCard).join('')}
    </div>
    ${
      tagCount
        ? `
    <div class="tag-cloud-card">
      <div class="cloud-head">${ICON_SM('tag')} 热门标签 <button class="btn small ghost" data-action="filter-tag" data-tag="" data-tip="查看全部标签" aria-label="查看全部标签">更多</button></div>
      <div class="tag-cloud-wrap">${entries.map(([t, n]) => tagChip(t, n)).join('')}</div>
    </div>`
        : `
    <div class="empty-state"><span class="emoji">${ICON('tag')}</span><div class="title">还没有标签</div></div>`
    }`;
  // 首页大搜索框联动顶部搜索
  const hero = $('#heroSearch');
  if (hero)
    hero.addEventListener('input', () => {
      const q = hero.value.trim();
      if (!q) {
        clearSearch();
        return;
      }
      $('#searchInput').value = q;
      SEARCH = q.toLowerCase();
      $('#searchClear').classList.remove('hidden');
      syncSearchScopeVisibility();
      renderSearch();
    });
  hero &&
    hero.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.preventDefault();
    });
}

// ---------- 隐藏书签：仅列出从日常视图排除的书签 ----------
function renderHidden() {
  const items = (DATA.items || []).filter(item => item.hidden);
  if (!items.length) {
    content().innerHTML = emptyState(ICON('eye-off'), '没有隐藏的书签', '隐藏的书签会显示在这里');
    return;
  }
  content().innerHTML = `
    <div class="section-toolbar">
      <span class="sec-title">${ICON_SM('eye-off')} 已隐藏 <b>${items.length}</b> 个书签</span>
    </div>
    ${renderItemRows(items, 'hidden-items', FIRST_LIST_COUNT, FIRST_LIST_COUNT)}`;
}

// ---------- 文件夹页：浏览 Chrome 原生书签文件夹树 ----------
// 与「标签页」按标签分组不同，这里直接以 Chrome 真实文件夹结构组织，
// 拖拽排序 / 跨文件夹移动在此页与视觉 1:1 对应（不再脱节）。
function currentFolder() {
  const ft = DATA && DATA.folderTree;
  if (!ft || !ft.roots.length) return null;
  if (FOLDER_NAV.folderId && ft.folderById.has(FOLDER_NAV.folderId)) {
    return ft.folderById.get(FOLDER_NAV.folderId);
  }
  const root = ft.roots[0];
  FOLDER_NAV.folderId = root.id;
  return root;
}

// 从根到当前节点的链路（用于面包屑逐级跳转）
function folderChain(node) {
  const ft = DATA.folderTree;
  const chain = [];
  let n = node;
  while (n) {
    chain.unshift(n);
    n = n.parentId ? ft.folderById.get(n.parentId) : null;
  }
  return chain;
}

function renderBreadcrumb(cur) {
  const chain = folderChain(cur);
  let html = '<div class="breadcrumb">';
  const showAll = chain.length <= 4 || crumbExpanded;
  let crumbs;
  if (showAll) {
    crumbs = chain.map((node, i) => crumbHtml(node, i, chain.length)).join('');
  } else {
    // 路径过长：首 + … + 末，点 … 展开中间祖先
    crumbs = crumbHtml(chain[0], 0, chain.length) +
      '<button class="crumb crumb-more" data-action="crumb-expand" data-tip="展开中间路径" aria-label="展开中间路径">…</button>' +
      crumbHtml(chain[chain.length - 1], chain.length - 1, chain.length);
  }
  html += crumbs;
  html += `<span class="crumb-stats"><b>${cur.childFolders.length}</b> 夹 · <b>${cur.bookmarkIds.length}</b> 签</span>`;
  if (chain.length > 1)
    html += `<button class="crumb crumb-back" data-action="folder-up" data-tip="返回上层" aria-label="返回上层">⬑</button>`;
  html += '</div>';
  return html;
}

function crumbHtml(node, i, len) {
  const last = i === len - 1;
  const sep = i > 0 ? '<span class="crumb-sep">/</span>' : '';
  if (last)
    return sep + `<span class="crumb crumb-current">${ICON_SM('folder')} ${escapeHtml(node.title)}</span>`;
  const label = (i === 0 ? ICON_SM('home') : '') + escapeHtml(node.title);
  return sep + `<button class="crumb" data-action="folder-goto" data-id="${node.id}">${label}</button>`;
}

function folderRow(f) {
  if (editingFolder && editingFolder.mode === 'rename' && editingFolder.id === f.id) {
    return folderRowEdit(f, 'rename');
  }
  const empty = f.directCount === 0;
  const cls = `row folder-row clickable draggable${empty ? ' f-empty' : ''}`;
  // 把手与书签行统一：类名 .drag-handle、位置在行首（复选框区之后）
  return `<div class="${cls}" data-id="${f.id}" data-type="folder" id="row-${f.id}" tabindex="0" role="option" aria-selected="false" aria-label="文件夹 ${escapeHtml(f.title)}">
    <label class="checkbox-slot"><input type="checkbox" class="checkbox sel" data-id="${f.id}" data-type="folder" aria-label="选择 ${escapeHtml(f.title)}"></label>
    <button class="drag-handle" type="button" draggable="true" data-action="drag-handle" data-id="${f.id}" data-type="folder" data-tip="拖动排序 / 移动" aria-label="拖动 ${escapeHtml(f.title)}">${ICON_SM('drag')}</button>
    ${FOLDER_ICON_SM}
    <span class="f-name">${escapeHtml(f.title)}</span>
    <span class="f-count">${f.directCount} 项</span>
    <button class="f-menu" data-action="folder-menu" data-id="${f.id}" data-tip="文件夹操作" aria-label="操作 ${escapeHtml(f.title)}">⋮</button>
  </div>`;
}

// 就地编辑行（新建 / 重命名）：f-name 转为 input，回车保存、Esc 取消、失焦保存
function folderRowEdit(f, mode) {
  const id = f ? f.id : (editingFolder.tempId || 'new');
  const name = f ? f.title : '';
  const isNew = mode === 'new' && !f;
  const empty = isNew || (f && f.directCount === 0);
  const cls = `row folder-row editing${empty ? ' f-empty' : ''}`;
  const count = isNew ? '新建' : (f ? f.directCount + ' 项' : '');
  // drag-slot：编辑态没有把手，用等宽占位让 f-icon / 输入框与其它行对齐
  return `<div class="${cls}" data-edit-mode="${mode}" data-edit-id="${id}">
    <label class="checkbox-slot"></label>
    <span class="drag-slot" aria-hidden="true"></span>
    ${FOLDER_ICON_SM}
    <input class="f-name-input" id="fEditInput" type="text" data-edit-mode="${mode}" data-edit-id="${id}" value="${escapeHtml(name)}" placeholder="${mode === 'new' ? '文件夹名称' : '输入新名称'}" autocomplete="off" spellcheck="false">
    <span class="f-count">${count}</span>
    <span class="f-edit-hint">↵保存 · Esc取消</span>
  </div>`;
}

// ---------- 组织页：标签视图 + 文件夹视图双视图统一入口 ----------
function renderOrganize() {
  // 首次进入「组织」页：一次性拖拽引导（chrome.storage.local 标记位，失败静默）
  maybeShowOrganizeTip();
  const view = ORG_VIEW === 'folders' ? 'folders' : 'tags';
  content().innerHTML = orgBarHtml(view) + orgHintHtml(view) + '<div id="orgBody"></div>';
  const body = $('#orgBody');
  if (!body) return;
  if (view === 'folders') renderFolders(body);
  else renderTags(body);
}

// 「组织」页副标题（P2-1）：一句话说明这一页能做什么，降低理解成本
function orgHintHtml(view) {
  return view === 'folders'
    ? '<p class="org-hint">浏览 Chrome 真实文件夹结构；新建 / 重命名 / 删除文件夹，拖行首把手排序或跨层移动</p>'
    : '<p class="org-hint">按标签浏览与筛选（一个书签可以有多个标签），点 #标签 快速过滤</p>';
}

function orgBarHtml(view) {
  const tagsOn = view !== 'folders';
  let tools = '';
  if (view === 'folders') {
    const cur = currentFolder();
    const sortLabel = FOLDER_SORT === 'name' ? '名称' : FOLDER_SORT === 'added' ? '时间' : '手动';
    tools = `<input id="folderSearch" class="org-search" type="text" value="${escapeHtml(FOLDER_SEARCH)}" placeholder="搜索当前层的文件夹或书签…" autocomplete="off" spellcheck="false">`
      + `<button class="org-btn" data-action="folder-sort" data-tip="切换排序" aria-label="切换排序，当前 ${sortLabel}">排序:${sortLabel}</button>`
      + `<button class="org-btn" data-action="open-tree" data-tip="目录树（浏览 / 跨层移动）" aria-label="打开目录树">${ICON_SM('folder')}目录树</button>`
      + (cur ? `<button class="org-btn primary" data-action="new-folder" data-id="${cur.id}" data-tip="新建子文件夹" aria-label="新建子文件夹">${ICON_SM('plus')}新建</button>` : '');
  } else {
    tools = `<button class="org-btn" data-action="open-tree" data-tip="目录树（浏览 / 跨层移动）" aria-label="打开目录树">${ICON_SM('folder')}目录树</button>`;
  }
  return `<div class="org-bar">
    <div class="org-seg" role="tablist" aria-label="组织视图">
      <button class="org-tab${tagsOn ? ' active' : ''}" role="tab" aria-selected="${tagsOn ? 'true' : 'false'}" data-action="org-view" data-view="tags">${ICON_SM('tag')} 标签</button>
      <button class="org-tab${!tagsOn ? ' active' : ''}" role="tab" aria-selected="${!tagsOn ? 'true' : 'false'}" data-action="org-view" data-view="folders">${ICON_SM('folder')} 文件夹</button>
    </div>
    <div class="org-tools">${tools}</div>
  </div>`;
}

function renderFolders(container) {
  const c = container || content();
  const cur = currentFolder();
  if (!cur) {
    c.innerHTML = emptyState(ICON('folder'), '没有可显示的文件夹', '请确认书签栏可访问');
    return;
  }
  let folders = sortFolders(cur.childFolders.slice(), FOLDER_SORT);
  let bookmarks = sortBookmarks(cur.bookmarkIds.map(id => getItemById(id)).filter(Boolean), FOLDER_SORT);
  if (FOLDER_SEARCH) {
    const q = FOLDER_SEARCH.toLowerCase();
    // 搜索同时过滤子文件夹（按名称）与书签（按标题/URL/host/标签），
    // 否则只搜书签时，输文件夹名会"看起来无效"。
    folders = folders.filter(f => (f.title || '').toLowerCase().includes(q));
    bookmarks = bookmarks.filter(it => {
      const hay = ((it.title || '') + ' ' + (it.url || '') + ' ' + (it.host || '') + ' ' + (it.tags || []).join(' ')).toLowerCase();
      return hay.includes(q);
    });
  }
  let html = renderBreadcrumb(cur);
  if (editingFolder && editingFolder.mode === 'new' && editingFolder.parentId === cur.id)
    html += folderRowEdit(null, 'new');
  if (folders.length) html += folders.map(folderRow).join('');
  if (folders.length && bookmarks.length) html += '<div class="folder-list-sep"></div><div class="folder-list-sep-label">书签</div>';
  if (bookmarks.length) {
    html += renderItemRows(bookmarks, 'folder-items-' + cur.id, FIRST_LIST_COUNT, FIRST_LIST_COUNT);
  } else if (FOLDER_SEARCH && folders.length) {
    // 搜索激活、文件夹有匹配但书签无匹配：书签区给弱提示，避免无声消失
    html += emptyState(ICON('search'), '没有匹配的书签', '换个关键词试试');
  }
  if (!folders.length && !bookmarks.length && !editingFolder)
    html += FOLDER_SEARCH
      ? emptyState(ICON('search'), '没有匹配的结果', '换个关键词试试')
      : emptyState(ICON('folder'), '这是一个空文件夹', '可新建子文件夹，或把书签拖到这里');
  c.innerHTML = html;
  highlightAfterRender();
}
function sortFolders(folders, sort) {
  if (sort === 'name') return [...folders].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  return folders; // manual / added：文件夹无 dateAdded，保持原序
}
function sortBookmarks(items, sort) {
  if (sort === 'name') return [...items].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  if (sort === 'added') return [...items].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  return items;
}
function highlightAfterRender() {
  if (!highlightFolderId) return;
  const el = document.querySelector(`#orgBody [data-id="${highlightFolderId}"]`);
  if (el) {
    el.classList.add('flash');
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    setTimeout(() => el.classList.remove('flash'), 1300);
  }
  highlightFolderId = '';
}

function enterFolder(id) {
  FOLDER_NAV.folderId = id;
  crumbExpanded = false;
  render('organize');
}

function folderUp() {
  const cur = currentFolder();
  if (!cur || !cur.parentId) return;
  const parent = DATA.folderTree.folderById.get(cur.parentId);
  if (parent) enterFolder(parent.id);
}

// ---------- 目录树覆盖层（浏览 / 跨层移动 / 移动到选择器） ----------
let treePickerIds = []; // move 模式下待移动的书签 id

function ensureTreeOverlay() {
  let ov = $('#treeOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'treeOverlay';
  ov.className = 'tree-overlay hidden';
  ov.innerHTML = `
    <div class="tree-panel" role="dialog" aria-modal="true" aria-label="目录树">
      <div class="tree-head">
        <input id="treeSearch" type="text" placeholder="搜索文件夹…" autocomplete="off" spellcheck="false">
        <span class="tree-mode" id="treeMode">目录树</span>
        <button class="icon-btn" id="treeClose" data-tip="关闭" aria-label="关闭">✕</button>
      </div>
      <div class="tree-body" id="treeBody" data-mode="navigate"></div>
    </div>`;
  document.body.appendChild(ov);
  $('#treeClose')?.addEventListener('click', closeTreeOverlay);
  $('#treeSearch')?.addEventListener('input', e => filterTree(e.target.value));
  $('#treeBody')?.addEventListener('click', onTreeBodyClick);
  ov.addEventListener('click', e => { if (e.target === ov) closeTreeOverlay(); });
  return ov;
}

function openFolderTree() {
  if (!DATA || !DATA.folderTree) return;
  ensureTreeOverlay();
  $('#treeMode').textContent = '目录树';
  $('#treeBody').dataset.mode = 'navigate';
  $('#treeSearch').value = '';
  renderFolderTree();
  $('#treeOverlay').classList.remove('hidden');
  // 弹层焦点陷阱：Esc 关闭（与抽屉 / 弹层一致）
  if (window.UI && typeof UI.focusTrap === 'function')
    UI.focusTrap($('#treeOverlay').querySelector('.tree-panel'), {
      onEscape: () => closeTreeOverlay(),
      initialFocus: $('#treeSearch')
    });
  setTimeout(() => $('#treeSearch').focus(), 0);
}

function openMoveToPicker(ids) {
  if (!ids || !ids.length) { toast('没有选中的书签', 'warn'); return; }
  if (!DATA || !DATA.folderTree) return;
  ensureTreeOverlay();
  treePickerIds = ids.slice();
  $('#treeMode').textContent = '移动到…（点选目标文件夹）';
  $('#treeBody').dataset.mode = 'move';
  $('#treeSearch').value = '';
  renderFolderTree();
  $('#treeOverlay').classList.remove('hidden');
  if (window.UI && typeof UI.focusTrap === 'function')
    UI.focusTrap($('#treeOverlay').querySelector('.tree-panel'), {
      onEscape: () => closeTreeOverlay(),
      initialFocus: $('#treeSearch')
    });
  setTimeout(() => $('#treeSearch').focus(), 0);
}

function closeTreeOverlay() {
  const ov = $('#treeOverlay');
  if (ov) {
    ov.classList.add('hidden');
    const panel = ov.querySelector('.tree-panel');
    if (panel && window.UI && typeof UI.releaseTrap === 'function') UI.releaseTrap(panel);
  }
  treePickerIds = [];
}

function renderFolderTree() {
  const body = $('#treeBody');
  if (!body) return;
  const ft = DATA.folderTree;
  body.innerHTML = ft.roots.map(r => folderTreeNodeHtml(r, 0, 1)).join('');
}

function folderTreeNodeHtml(node, depth, expandDepth) {
  const hasKids = node.childFolders.length > 0;
  const expanded = depth < expandDepth;
  const kidsHtml = hasKids
    ? `<div class="ft-children${expanded ? '' : ' hidden'}">${node.childFolders.map(c => folderTreeNodeHtml(c, depth + 1, expandDepth)).join('')}</div>`
    : '';
  return `<div class="ft-node">
    <div class="ft-row" data-id="${node.id}" tabindex="0">
      <button class="ft-toggle" data-id="${node.id}" tabindex="-1" aria-label="展开折叠">${hasKids ? (expanded ? '▾' : '▸') : '•'}</button>
      ${FOLDER_ICON_SM}
      <span class="ft-name" data-id="${node.id}">${escapeHtml(node.title)}</span>
      <span class="ft-count">${node.totalCount}</span>
    </div>
    ${kidsHtml}
  </div>`;
}

function onTreeBodyClick(e) {
  const toggle = e.target.closest('.ft-toggle');
  if (toggle) {
    const node = toggle.closest('.ft-node');
    const kids = node ? node.querySelector(':scope > .ft-children') : null;
    if (kids) {
      const hidden = kids.classList.toggle('hidden');
      toggle.textContent = hidden ? '▸' : '▾';
    }
    return;
  }
  const row = e.target.closest('.ft-row');
  if (row && row.dataset.id) {
    const id = row.dataset.id;
    const mode = $('#treeBody').dataset.mode;
    if (mode === 'move') {
      movePickedBookmarks(id);
    } else {
      // 从树导航进入文件夹 → 切文件夹视图
      ORG_VIEW = 'folders';
      try { sessionStorage.setItem('bm-org-view', 'folders'); } catch (e) { /* ignore */ }
      enterFolder(id);
      closeTreeOverlay();
    }
  }
}

// 搜索过滤：匹配文件夹名 + 其所有祖先链显示并展开
function filterTree(query) {
  const body = $('#treeBody');
  if (!body) return;
  const q = String(query || '').trim().toLowerCase();
  const nodes = body.querySelectorAll('.ft-node');
  if (!q) {
    nodes.forEach(n => n.classList.remove('hidden'));
    return;
  }
  nodes.forEach(n => n.classList.add('hidden'));
  body.querySelectorAll('.ft-row').forEach(row => {
    const name = (row.querySelector('.ft-name').textContent || '').toLowerCase();
    if (name.includes(q)) {
      let n = row.closest('.ft-node');
      while (n) {
        n.classList.remove('hidden');
        const kids = n.querySelector(':scope > .ft-children');
        if (kids) {
          kids.classList.remove('hidden');
          const t = n.querySelector(':scope > .ft-row .ft-toggle');
          if (t) t.textContent = '▾';
        }
        const parent = n.parentElement;
        n = parent ? parent.closest('.ft-node') : null;
      }
    }
  });
}

async function movePickedBookmarks(targetId) {
  const ids = treePickerIds.slice();
  const n = ids.length;
  closeTreeOverlay();
  if (!n || !targetId) return;
  try {
    for (const id of ids) {
      await chrome.bookmarks.move(id, { parentId: targetId });
    }
    toast('已移动 ' + n + ' 个书签 ✓', 'ok');
    refresh();
  } catch (e) {
    toast('移动失败：' + (e.message || e), 'danger');
  }
}

function renderExact(container) {
  const c = container || content();
  const sameUrlGroups = getSameUrlGroups();
  if (!DATA.exactDuplicates.length) {
    c.innerHTML =
      emptyState(ICON('repeat'), '重复书签已清理干净', '没有发现 URL 完全相同的书签') +
      (sameUrlGroups.length
        ? `
      <div class="section-toolbar" style="margin-top:14px;">
        <span class="sec-title">发现 <b>${sameUrlGroups.length}</b> 组归一化同址书签，可统一历史标签</span>
        <button class="btn small" data-action="unify-exact-tags">${ICON_SM('tag')} 统一同址标签</button>
      </div>`
        : '');
    return;
  }
  const total = DATA.exactDuplicates.reduce((s, g) => s + g.items.length - 1, 0);
  let html = `
    <div class="section-toolbar">
      <span class="sec-title">共 <b>${DATA.exactDuplicates.length}</b> 组完全相同 · 可一键清理 <b>${total}</b> 个多余项</span>
      <button class="btn small primary" data-action="bulk-exact">${ICON_SM('sparkles')} 一键去重</button>
      <button class="btn small" data-action="unify-exact-tags">${ICON_SM('tag')} 统一同址标签</button>
    </div>`;
  const groups = takeForRender(
    DATA.exactDuplicates,
    'exact-groups',
    FIRST_GROUP_COUNT,
    FIRST_GROUP_COUNT
  );
  groups.items.forEach((g, groupIndex) => {
    const head = g.items[0].domain || g.items[0].host || '链接';
    html += groupWrap(
      'exact-' + groupIndex,
      ICON('repeat'),
      head,
      '',
      g.items.length + ' 个相同',
      `
      <button class="btn small" data-action="keepfirst" data-idx="${groupIndex}">保留首个</button>
      <button class="btn small ghost" data-action="selall" data-group="exact-${groupIndex}">全选</button>
    `,
      renderItemRows(
        g.items,
        'exact-items-' + groupIndex,
        FIRST_GROUP_ITEM_COUNT,
        FIRST_GROUP_ITEM_COUNT
      )
    );
  });
  html += groups.more;
  c.innerHTML = html;
}

function buildTagViewFallback(items) {
  const tagItemsByName = new Map();
  const visibleTagItemsByName = new Map();
  const visibleItems = [];
  const taggedItems = [];
  const visibleTaggedItems = [];
  let hiddenItemCount = 0;
  let taggedItemCount = 0;
  let visibleTaggedItemCount = 0;
  let otherTaggedItemCount = 0;
  let visibleOtherTaggedItemCount = 0;
  let fallbackTaggedItemCount = 0;
  let visibleFallbackTaggedItemCount = 0;
  const allTagStats = {};
  for (const item of items) {
    const tags = item.tags || [];
    const hasUsableTag = tags.some(tag => tag !== BM.FALLBACK_TAG);
    const onlyFallbackTag = tags.length > 0 && !hasUsableTag;
    const hasFallbackTag = tags.includes(BM.FALLBACK_TAG);
    if (tags.length) taggedItems.push(item);
    if (hasUsableTag) taggedItemCount++;
    if (onlyFallbackTag) otherTaggedItemCount++;
    if (hasFallbackTag) fallbackTaggedItemCount++;
    for (const tag of tags) {
      const tagItems = tagItemsByName.get(tag);
      if (tagItems) tagItems.push(item);
      else tagItemsByName.set(tag, [item]);
      if (tag !== BM.FALLBACK_TAG) allTagStats[tag] = (allTagStats[tag] || 0) + 1;
    }
    if (item.hidden) {
      hiddenItemCount++;
      continue;
    }
    visibleItems.push(item);
    if (tags.length) visibleTaggedItems.push(item);
    if (hasUsableTag) visibleTaggedItemCount++;
    if (onlyFallbackTag) visibleOtherTaggedItemCount++;
    if (hasFallbackTag) visibleFallbackTaggedItemCount++;
    for (const tag of tags) {
      const tagItems = visibleTagItemsByName.get(tag);
      if (tagItems) tagItems.push(item);
      else visibleTagItemsByName.set(tag, [item]);
    }
  }
  return {
    tagItemsByName,
    visibleTagItemsByName,
    allTagStats,
    visibleItems,
    taggedItems,
    visibleTaggedItems,
    hiddenItemCount,
    taggedItemCount,
    visibleTaggedItemCount,
    otherTaggedItemCount,
    visibleOtherTaggedItemCount,
    fallbackTaggedItemCount,
    visibleFallbackTaggedItemCount
  };
}

function tagGroupHtml(entry, index, itemsByTag) {
  const [tag, count] = entry;
  const items = itemsByTag.get(tag) || [];
  return groupWrap(
    'tag-' + index,
    ICON('tag'),
    '#' + tag,
    'tag-badge',
    count + ' 个',
    `
    <button class="btn small ghost" data-action="filter-tag" data-tag="${escapeHtml(tag)}">只看此标签</button>
  `,
    renderItemRows(items, 'tag-preview-' + tag, FIRST_TAG_PREVIEW_COUNT, FIRST_TAG_PREVIEW_COUNT)
  );
}

function appendTagGroups(entries, itemsByTag, startIndex, more, token) {
  let index = startIndex;
  const appendNext = () => {
    if (token !== tagRenderToken || currentTab !== 'organize' || ORG_VIEW !== 'tags') return;
    const target = $('#tagGroups');
    if (!target) return;
    const entry = entries[index++];
    if (entry) {
      target.insertAdjacentHTML('beforeend', tagGroupHtml(entry, index - 1, itemsByTag));
      applyCollapsed();
    }
    if (index < entries.length) {
      requestAnimationFrame(appendNext);
      return;
    }
    const status = $('#tagGroupsStatus');
    if (status) status.remove();
    const moreTarget = $('#tagGroupsMore');
    if (moreTarget) moreTarget.innerHTML = more;
  };
  requestAnimationFrame(appendNext);
}

function renderTags(container) {
  const c = container || content();
  const tagView = DATA.tagView || (DATA.tagView = buildTagViewFallback(DATA.items || []));
  const stats = DATA.tagStats || {};
  const itemsByTag = tagView.visibleTagItemsByName;
  const taggedItems = tagView.visibleTaggedItems;
  const totalVisible = tagView.visibleItems.length;
  const taggedCount = tagView.visibleTaggedItemCount;
  const otherCount = tagView.visibleOtherTaggedItemCount;
  const fallbackCount = tagView.visibleFallbackTaggedItemCount;
  const hiddenFallbackCount = tagView.fallbackTaggedItemCount - fallbackCount;
  const hiddenCount = tagView.hiddenItemCount;
  // 固定标签池：标签条只显示池内标签（含「其他」）；池外标签统计为「散落标签」
  const pool = BM.getFixedTags() || [];
  const poolSet = new Set(pool);
  const entriesAll = Object.entries(stats).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')
  );
  const entries = entriesAll.filter(([t]) => poolSet.has(t));
  const looseCount = entriesAll.reduce((s, [t, n]) => s + (poolSet.has(t) ? 0 : n), 0);
  const untaggedCount = getAiTagTargets(false).length;
  const customRuleCount = getCustomRuleCount();
  if (!entries.length && !looseCount) {
    c.innerHTML =
      emptyState(
        ICON('tag'),
        '还没有标签',
        '给书签打标签后即可按标签快速浏览（一个书签可多个标签）'
      ) +
      `
      <div class="section-toolbar" style="margin-top:14px;">
        <span class="sec-title">${untaggedCount} 个书签未打标 ${helpDot('可在新增或编辑书签时填写标签，或使用 AI 批量打标。')}</span>
        ${hiddenCount ? `<button class="btn small ghost" data-jump="hidden">${ICON_SM('eye-off')} 隐藏（${hiddenCount}）</button>` : ''}
        ${customRuleCount ? `<button class="btn small ghost" data-action="apply-custom-rules">${ICON_SM('sparkles')} 应用规则</button>` : ''}
        <button class="btn small ghost" data-action="edit-custom-rules" data-tip="到设置页「标签体系 → 自定义规则」编辑规则" aria-label="打开设置页编辑自定义规则">${ICON_SM('gear')} 自定义规则</button>
        <button class="btn small primary" data-action="ai-tag-all">${ICON_SM('sparkles')} AI 批量打标</button>
      </div>`;
    return;
  }
  const total = totalVisible;
  const pct = total ? (taggedCount === total ? 100 : Math.floor((taggedCount / total) * 100)) : 0;
  // 数据摘要卡：3 个数字 + 进度条 + 散落警告
  const looseKinds = entriesAll.length - entries.length; // 池外标签种类数
  const summaryHtml = `<div class="tag-summary">
    <div class="tag-summary-row">
      <span class="big">${taggedCount}</span><span>/ ${total} 已打标</span><span class="pct">${pct}%</span>
      <span class="sep">|</span><span><b>${entries.length}</b> 个标签</span>${helpDot('标签后的数字表示书签数量。')}
      ${looseKinds ? `<span class="sep">|</span><span><span class="dot" style="background:var(--warn)"></span><b>${looseKinds}</b> 个散落标签</span>` : ''}
      <span style="margin-left:auto; display:flex; gap:6px;">
        <button class="btn small ghost" data-jump="hidden" data-tip="查看隐藏书签" aria-label="查看隐藏书签（${hiddenCount}）">${ICON_SM('eye-off')} 隐藏（${hiddenCount}）</button>
        <button class="btn small primary" data-action="ai-tag-all" ${untaggedCount ? '' : 'disabled'}>${ICON_SM('sparkles')} 打标未标（${untaggedCount}）</button>
        <button class="btn small ghost" data-action="ai-tag-all-force">${ICON_SM('refresh')} 全量重打</button>
      </span>
    </div>
    <div class="tag-summary-bar"><div class="tag-summary-bar-fill" style="width:${pct}%"></div></div>
    ${
      customRuleCount
        ? `<div class="tag-summary-tip">
      <span>已配置 <b>${customRuleCount}</b> 条自定义规则，可批量应用到已有书签，不调用 AI。</span>
      <span class="tag-tip-actions">
        <button class="btn small ghost" data-action="edit-custom-rules" data-tip="到设置页「标签体系 → 自定义规则」编辑规则" aria-label="打开设置页编辑自定义规则">${ICON_SM('gear')} 自定义规则</button>
        <button class="btn small primary" data-action="apply-custom-rules">${ICON_SM('sparkles')} 应用规则</button>
      </span>
    </div>`
        : ''
    }
    ${
      looseCount
        ? `<div class="tag-summary-tip">
      <span><span class="dot" style="background:var(--warn)"></span><b>${looseCount}</b> 个书签有散落标签（不在固定池内），池外会归到「其他」</span>
      <button class="btn small primary" data-action="migrate-tags">${ICON_SM('tag')} 立即收敛</button>
    </div>`
        : ''
    }
    ${
      fallbackCount || hiddenFallbackCount
        ? `<div class="tag-summary-tip">
      <span><span class="dot" style="background:var(--muted)"></span>${
        hiddenFallbackCount
          ? `<b>${fallbackCount}</b> 个当前可见书签含「#其他」兜底标签，另有 <b>${hiddenFallbackCount}</b> 个隐藏书签`
          : `<b>${fallbackCount}</b> 个书签含「#其他」兜底标签`
      }${otherCount ? `；其中 <b>${otherCount}</b> 个仍未打标` : ''}</span>
      <button class="btn small primary" data-action="migrate-tags">${ICON_SM('tag')} 去收敛</button>
    </div>`
        : ''
    }
  </div>`;

  // 标签数量直接显示为数字，避免以字号或长度条重复表达同一信息。
  const chip = (t, n) => {
    const active = TAG_FILTER === t ? ' active' : '';
    return `<button class="tag-cloud${active}" data-action="filter-tag" data-tag="${escapeHtml(t)}" aria-pressed="${active ? 'true' : 'false'}">
      <span>${t ? '#' + escapeHtml(t) : '全部'}</span><span class="cnt">${n}</span>
    </button>`;
  };

  let html =
    summaryHtml +
    `
    <div class="tag-cloud-card">
      <div class="cloud-head">
        <span style="display:inline-flex;align-items:center;gap:6px;">${ICON_SM('tag')} 标签云</span>
        <span style="margin-left:auto;display:flex;gap:6px;">
          <button class="btn small ghost" data-action="create-tag">${ICON_SM('plus')} 新建标签</button>
          <button class="btn small ghost" data-action="manage-tags">${ICON_SM('tag')} 管理标签</button>
        </span>
      </div>
      <div class="tag-cloud-wrap">
        <button class="tag-cloud${!TAG_FILTER ? ' active' : ''}" data-action="filter-tag" data-tag="">
          <span>全部</span><span class="cnt">${taggedCount}</span>
        </button>
        ${entries.map(([t, n]) => chip(t, n)).join('')}
      </div>
    </div>`;
  // 分组：标签索引已在上方单次扫描中建立，避免每个标签再遍历全部书签。
  const filtered = TAG_FILTER ? itemsByTag.get(TAG_FILTER) || [] : taggedItems;
  if (TAG_FILTER) {
    const items = filtered;
    html += `<div class="section-toolbar"><span class="sec-title">标签 <b>#${escapeHtml(TAG_FILTER)}</b> · ${items.length} 个书签</span>
      <button class="btn small ghost" data-action="clear-tag-filter">清除筛选</button></div>`;
    if (!items.length) html += emptyState(ICON('tag'), '该标签下没有书签', '');
    else
      html += renderItemRows(
        items,
        'tag-filter-' + TAG_FILTER,
        FIRST_TAG_FILTER_COUNT,
        FIRST_LIST_COUNT
      );
  } else {
    // 全部标签：按标签分组展示
    html += `<div class="section-toolbar"><span class="sec-title"><b>${entries.length}</b> 个标签 · ${taggedCount}/${total} 个书签已打标</span>
      <button class="btn small ghost" data-action="clear-tag-filter" style="${TAG_FILTER ? '' : 'display:none'}">清除筛选</button></div>`;
    const tagGroups = takeForRender(entries, 'tag-groups', FIRST_GROUP_COUNT, FIRST_GROUP_COUNT);
    const initialGroups = tagGroups.items.slice(0, FIRST_TAG_GROUP_COUNT);
    html += `<div id="tagGroups">${initialGroups.map((entry, index) => tagGroupHtml(entry, index, itemsByTag)).join('')}</div>`;
    if (initialGroups.length < tagGroups.items.length) {
      html += '<div id="tagGroupsStatus" class="progressive-load">正在补齐其余标签…</div>';
    }
    html += `<div id="tagGroupsMore">${initialGroups.length === tagGroups.items.length ? tagGroups.more : ''}</div>`;
  }
  c.innerHTML = html;
  if (!TAG_FILTER) {
    const tagGroups = takeForRender(entries, 'tag-groups', FIRST_GROUP_COUNT, FIRST_GROUP_COUNT);
    if (FIRST_TAG_GROUP_COUNT < tagGroups.items.length) {
      appendTagGroups(
        tagGroups.items,
        itemsByTag,
        FIRST_TAG_GROUP_COUNT,
        tagGroups.more,
        ++tagRenderToken
      );
    } else {
      tagRenderToken++;
    }
  } else {
    tagRenderToken++;
  }
}

// ---------- 清理 tab：重复 / 空夹（子区块切换） ----------
let cleanSub = 'repeat'; // repeat | empty

function cleanNav(label, key, icon, n) {
  const active = cleanSub === key ? ' active' : '';
  return `<button class="subtab${active}" data-action="clean-sub" data-sub="${key}" aria-pressed="${cleanSub === key ? 'true' : 'false'}">${icon} ${label} <span class="cnt">${n}</span></button>`;
}

function renderClean() {
  const d = DATA;
  let html =
    overviewDetailHeader('清理书签') +
    pageHint(
      ICON('sparkles'),
      '<b>本页能做什么：</b>一次性处理完全重复的书签和空文件夹。每个区块可一键批量操作。'
    ) +
    `
    <div class="subtab-bar">
      ${cleanNav('重复书签', 'repeat', ICON_SM('repeat'), d.exactDuplicates.length)}
      ${cleanNav('空文件夹', 'empty', ICON_SM('trash'), d.emptyFolders.length)}
    </div>
    <div id="cleanBody"></div>`;
  content().innerHTML = html;
  renderCleanBody();
}

function renderCleanBody() {
  const body = $('#cleanBody');
  if (!body) return;
  if (cleanSub === 'empty') renderEmpty(body);
  else renderExact(body);
}

// ---------- 回收站工具视图 ----------
function renderTrashView() {
  // 回收站不再挂问号说明：每条记录的「N 天后永久删除」已表达同样的规则
  content().innerHTML = overviewDetailHeader('回收站') + '<div id="trashBody"></div>';
  renderTrash($('#trashBody'));
}

function overviewDetailHeader(title) {
  return `<div class="section-toolbar"><button class="btn small ghost" data-action="overview-back">返回概览</button><span class="sec-title">${title}</span></div>`;
}

function renderEmpty(container) {
  const c = container || content();
  if (!DATA.emptyFolders.length) {
    c.innerHTML = emptyState(ICON('trash'), '没有空文件夹', '书签结构很整洁，无需清理');
    return;
  }
  let html = `
    <div class="section-toolbar">
      <span class="sec-title">共 <b>${DATA.emptyFolders.length}</b> 个空文件夹</span>
      <button class="btn small danger" data-action="bulk-empty">${ICON_SM('trash')} 一键清空</button>
    </div>`;
  const folders = takeForRender(
    DATA.emptyFolders,
    'empty-folders',
    FIRST_LIST_COUNT,
    FIRST_LIST_COUNT
  );
  folders.items.forEach(f => {
    html += `<div class="row" data-id="${f.id}">
      <label class="checkbox-slot"><input type="checkbox" class="checkbox sel" data-id="${f.id}" data-type="folder"></label>
      <div class="meta">
        <div class="title">${ICON_SM('folder')} ${escapeHtml(f.title)}</div>
        <div class="loc"><span>${escapeHtml(f.path.join(' / '))}</span></div>
      </div>
      <button class="btn small danger" data-action="delfolder" data-id="${f.id}" data-title="${escapeHtml(f.title)}">删除</button>
    </div>`;
  });
  html += folders.more;
  c.innerHTML = html;
}

// ---------- 回收站 ----------
function renderTrash(container) {
  const c = container || content();
  const list = DATA.trash || [];
  if (!list.length) {
    c.innerHTML = emptyState(
      ICON('archive'),
      '回收站是空的',
      '在「书签管家」中删除的书签会先进回收站，30 天内可恢复'
    );
    return;
  }
  const ttl = BM.TRASH_TTL_DAYS || 30;
  let html = `
    <div class="section-toolbar trash-toolbar">
      <span class="sec-title">共 <b>${list.length}</b> 项待恢复${list.length >= (BM.TRASH_MAX || 1000) ? `（已达上限，最早的记录会被新删除项挤出）` : ''}</span>
      <div class="toolbar-actions">
        <button class="btn small primary" data-action="trash-restore-all">${ICON_SM('undo')}一键恢复</button>
      </div>
    </div>`;
  const now = Date.now();
  const page = takeForRender(list, 'trash-items', FIRST_LIST_COUNT, FIRST_LIST_COUNT);
  page.items.forEach(t => {
    const remain = Math.max(0, Math.ceil((t.deletedAt + ttl * 86400000 - now) / 86400000));
    const pathText = t.path && t.path.length ? t.path.join(' / ') : '书签栏';
    html += `<div class="row trash-row" data-id="${t.id}">
      <div class="meta">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="url">${escapeHtml(t.url)}</div>
        <div class="loc"><span>${ICON_SM('folder')} ${escapeHtml(pathText)}</span><span class="tag warn">${remain} 天后永久删除</span></div>
      </div>
      <div class="trash-actions">
        <button class="btn small" data-action="trash-restore" data-id="${t.id}">${ICON_SM('undo')} 恢复</button>
        <button class="btn small danger" data-action="trash-discard" data-id="${t.id}">永久删除</button>
      </div>
    </div>`;
  });
  html += page.more;
  c.innerHTML = html;
}

// 恢复回收站中的书签（重建到原文件夹，原文件夹已删则回退书签栏）
async function doRestoreTrash(id) {
  if (trashRestoreInProgress) return;
  const t = (DATA.trash || []).find(x => x.id === id);
  if (!t) {
    toast('这条回收站记录已不存在，重新扫描后再试', 'warn');
    return;
  }
  trashRestoreInProgress = true;
  try {
    const r = await BM.restoreTrashItem(t);
    toast('已恢复' + (r.fallback ? '（原文件夹已删除，已放回书签栏）' : '到原位置') + ' ✓', 'ok');
    refresh();
  } catch (e) {
    toast('恢复失败：' + (e.message || e), 'danger');
  } finally {
    trashRestoreInProgress = false;
  }
}

async function doRestoreAllTrash() {
  if (trashRestoreInProgress) return;
  const items = (DATA.trash || []).slice();
  if (!items.length) {
    toast('回收站是空的', 'warn');
    return;
  }
  trashRestoreInProgress = true;
  let progressStarted = false;
  try {
    const ok = await confirmDialog({
      title: '恢复回收站全部 ' + items.length + ' 项？',
      message: '书签会优先恢复到原文件夹；原文件夹已删除的书签将放回<b>书签栏</b>。',
      confirmText: '恢复全部 ' + items.length + ' 项',
      danger: false
    });
    if (!ok) return;
    startProgress('正在恢复书签，请稍候…');
    progressStarted = true;
    const result = await BM.restoreTrashItems(items, {
      onProgress: progress =>
        updateProgress(
          Math.round((progress.done / progress.total) * 100),
          '正在恢复 ' + progress.done + '/' + progress.total
        )
    });
    if (result.persistenceError) {
      toast('恢复状态写入失败，已创建书签会在重试时自动核对', 'danger');
      await refresh();
      return;
    }
    const failed = result.failed.length;
    if (result.restored) {
      let message = '已恢复 ' + result.restored + ' 项';
      if (result.fallback) message += '（' + result.fallback + ' 项已放回书签栏）';
      if (failed) message += '，' + failed + ' 项失败';
      toast(message + ' ✓', failed ? 'warn' : 'ok');
    } else {
      toast(failed ? '恢复失败：' + failed + ' 项无法恢复' : '没有可恢复的记录', 'warn');
    }
    await refresh();
  } catch (e) {
    toast('恢复失败：' + (e.message || e), 'danger');
  } finally {
    if (progressStarted) endProgress();
    trashRestoreInProgress = false;
  }
}

// ---------- 全局搜索 ----------
function clearSearch(renderPage) {
  SEARCH = '';
  const searchInput = $('#searchInput');
  if (searchInput) searchInput.value = '';
  const searchClear = $('#searchClear');
  if (searchClear) searchClear.classList.add('hidden');
  const searchScope = $('#searchScope');
  if (searchScope) searchScope.classList.add('hidden');
  if (renderPage !== false) render(currentTab);
}

function openTagFilter(tag) {
  TAG_FILTER = tag || '';
  clearSearch(false);
  ORG_VIEW = 'tags';
  try { sessionStorage.setItem('bm-org-view', 'tags'); } catch (e) { /* ignore */ }
  switchTab('organize');
}

// ---------- 搜索范围（#searchScope chips） ----------
// 按范围取该 item 的可匹配字段文本：all = 标题 + 网址 + 域名 + 标签（现状）；title / tag / url 各自收窄。
// 调用形态：
//   applySearchScope(item, scope)              → 返回匹配字段文本（供调用方自行判断）
//   applySearchScope(item, terms, scope)       → terms 为数组时返回 AND 匹配结果（布尔）
function applySearchScope(item, terms, scope) {
  const it = item || {};
  if (typeof terms === 'string' && scope === undefined) {
    scope = terms;
    terms = null;
  }
  const asScope = SEARCH_SCOPE_VALUES.includes(scope) ? scope : 'all';
  const title = String(it.title || '').toLowerCase();
  const url = String(it.url || '').toLowerCase();
  const host = String(it.host || '').toLowerCase();
  const tagList = (it.tags || []).map(t => String(t).toLowerCase());
  let hay;
  if (asScope === 'title') hay = title;
  else if (asScope === 'tag') hay = tagList.join(' ');
  else if (asScope === 'url') hay = url + ' ' + host;
  else hay = title + ' ' + url + ' ' + host + ' ' + tagList.join(' ');
  if (!terms) return hay;
  const list = Array.isArray(terms) ? terms : [terms];
  return list.every(t => hay.includes(String(t).toLowerCase()));
}

// 切换搜索范围：同步 chip 的 aria-pressed / .active，并立即重渲染结果
function setSearchScope(scope) {
  SEARCH_SCOPE = SEARCH_SCOPE_VALUES.includes(scope) ? scope : 'all';
  document.querySelectorAll('#searchScope .scope-chip').forEach(chip => {
    const on = chip.dataset.scope === SEARCH_SCOPE;
    chip.classList.toggle('active', on);
    if (chip.setAttribute) chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (SEARCH) renderSearch();
}

// 输入框有内容时才显示范围 chips，清空时收起（顶部搜索与概览大搜索框共用）
function syncSearchScopeVisibility() {
  const box = $('#searchScope');
  if (!box) return;
  const input = $('#searchInput');
  const hasText = !!String((input && input.value) || '').trim();
  box.classList.toggle('hidden', !hasText);
}

function renderSearch() {
  const q = SEARCH;
  const hiddenScope = currentTab === 'hidden';
  const sourceItems = hiddenScope ? DATA.items.filter(it => it.hidden) : DATA.items;
  // 与标签页搜索口径一致：支持 #标签 前缀、空格多词 AND；范围 chips 决定匹配哪些字段。
  const trimmed = String(q || '').trim();
  let tagTerm = '';
  let textTerms = [];
  if (trimmed.startsWith('#')) {
    const sp = trimmed.split(/\s+/);
    tagTerm = (sp[0] || '').slice(1).toLowerCase();
    textTerms = sp
      .slice(1)
      .map(t => t.toLowerCase())
      .filter(Boolean);
  } else {
    textTerms = trimmed.split(/\s+/).filter(Boolean);
  }
  const hasTerm = Boolean(tagTerm || textTerms.length);
  // 范围过滤：按 scope 决定匹配字段（#标签 语法优先）。
  // 本函数会被单测单独 eval，故对模块级状态与助手做 typeof 兜底。
  const scope = typeof SEARCH_SCOPE === 'string' ? SEARCH_SCOPE : 'all';
  const inScope = (it, terms) =>
    typeof applySearchScope === 'function'
      ? applySearchScope(it, terms, scope)
      : terms.every(t => String(it.title || '').toLowerCase().includes(t));
  const hits = hasTerm
    ? sourceItems.filter(it => {
        // #标签 语法优先级最高：先按语法筛选，再按当前范围收窄
        if (tagTerm) {
          const tagList = (it.tags || []).map(t => String(t).toLowerCase());
          if (!tagList.includes(tagTerm)) return false;
        }
        if (!textTerms.length) return true;
        return inScope(it, textTerms);
      })
    : [];
  const scopeLabel = scope === 'all' ? '' : SEARCH_SCOPE_LABELS[scope] || scope;
  content().innerHTML = `
    <section class="search-results">
      <header class="search-results-head">
        <div class="search-query">
          <span class="search-query-icon">${ICON('search')}</span>
          <div class="search-query-copy">
            <span>${hiddenScope ? '隐藏书签搜索' : '搜索结果'}${scopeLabel ? ' · ' + scopeLabel : ''}</span>
            <b data-tip="${escapeHtml(q)}">${escapeHtml(q)}</b>
          </div>
        </div>
        <div class="search-result-actions">
          <span class="search-result-count"><b>${hits.length}</b> 个匹配</span>
          <button class="search-result-clear" data-action="clear-search" data-tip="清除搜索" aria-label="清除搜索">${ICON_SM('x')}</button>
        </div>
      </header>
      <div class="search-results-list${hits.length === 1 ? ' single' : ''}" role="listbox" aria-label="搜索结果">
        ${hits.length ? renderItemRows(hits, 'search-' + currentTab + '-' + q, FIRST_LIST_COUNT, FIRST_LIST_COUNT, { highlight: q, search: true }) : emptyState(ICON('search'), hiddenScope ? '没有匹配的隐藏书签' : '没有匹配结果', '换个关键词，或检查是否有拼写错误', { label: '清空搜索', action: 'clear-search' })}
      </div>
    </section>`;
  updateBulk();
}

// ---------- 错误 / 权限诊断 ----------
function showError(err) {
  const msg = (err && (err.message || String(err))) || '未知错误';
  const isNoBookmarks = !chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function';
  content().innerHTML = `
    <div class="error-card">
      <span class="err-icon">${isNoBookmarks ? ICON('lock') : ICON('alert')}</span>
      <div class="err-title">${isNoBookmarks ? '无法访问书签 API' : '读取书签失败'}</div>
      <div class="err-msg">${escapeHtml(msg)}</div>
      <div class="err-steps">
        <b>排查步骤：</b><br>
        1. 打开 <b>chrome://extensions</b>，确认「书签管家」已<b>启用</b><br>
        2. 点击「<b>重新加载</b>」按钮刷新扩展<br>
        3. 如仍失败，请重新执行「加载已解压的扩展程序」<br>
        4. 确保浏览器支持 Manifest V3（Chrome 88+ / Edge 88+）
      </div>
      <div class="err-actions">
        <button class="btn ghost" id="errOpenExt">打开扩展管理</button>
        <button class="btn primary" id="errRetry">重新扫描</button>
      </div>
    </div>`;
  document.getElementById('errOpenExt').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });
  document.getElementById('errRetry').addEventListener('click', () => refresh(true));
}

// 扫描看门狗：扩展被重载、context 失效或 Profile 切换时，chrome.bookmarks.getTree()
// 可能永不 settle。没有超时的话内容区会永久停在加载态（用户看到的就是「白屏」）。
const SCAN_TIMEOUT_MS = 20000;
function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), SCAN_TIMEOUT_MS);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ---------- 数据加载 ----------
async function runRefresh() {
  tabRenderToken++;
  listRenderLimits = Object.create(null);
  try {
    // 只有首屏才铺整页加载态：删除、后台回写等后续刷新保留已有内容，
    // 避免整块清空重建造成的闪白、滚动位置与选中态丢失（删除时体感最明显）。
    if (!DATA) content().innerHTML = '<div class="loading">正在扫描书签…</div>';
    if (!chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function') {
      throw new Error('chrome.bookmarks API 不可用，请确认扩展已正确加载并启用');
    }
    DATA = await withTimeout(BMAnalyzer.analyze(), '扫描书签超时，请点击「重新扫描」重试');
    // storage 版本迁移钩子（预留 schema 变更）
    try {
      await BM.migrateStorage();
    } catch (e) {
      console.warn('[书签管家] storage 迁移失败', e);
    }
    // 先清理超过 30 天的过期项，再读入回收站（惰性清理，与后台 alarm 双保险）
    try {
      await BM.purgeExpiredTrash();
    } catch (e) {
      console.warn('[书签管家] 回收站清理失败', e);
    }
    // 回收站读不到（后台忙 / 超时）不该拖垮主列表：退化为空列表继续渲染
    try {
      DATA.trash = await withTimeout(BM.getTrash(), '读取回收站超时');
    } catch (e) {
      console.warn('[书签管家] 读取回收站失败', e);
      if (!Array.isArray(DATA.trash)) DATA.trash = [];
    }
    render(currentTab);
    updateBulk();
  } catch (e) {
    console.error('[书签管家] 扫描失败:', e);
    // 已有内容时不要用错误卡覆盖整页，只提示失败；首屏无数据才铺错误卡
    if (DATA) toast('扫描失败：' + (e.message || e), 'danger', { timeout: 4000 });
    else showError(e);
  }
}

// 同步通知、手动重扫和操作完成可能在短时间内同时触发；合并为当前扫描和最多一次补扫。
async function refresh(force) {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    do {
      refreshQueued = false;
      await runRefresh(force);
    } while (refreshQueued);
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// 一次操作往往会同时触发多条刷新来源（操作收尾、storage 回写、云端标签水合并发）。
// 用一个很短的合并窗口把它们并成一轮扫描，避免同一动作重复跑整轮 analyze + render
// —— 删除单条书签原本会连跑两轮全量扫描，卡顿与闪白都来自这里。
// 另外给相邻两轮扫描留出最小间隔：批量新增书签、原生同步回写会连续触发大量 storage
// 变更，没有这个下限就会被拖成几十上百轮全量扫描（实测种入 1500 条曾触发 245 轮）。
const REFRESH_COALESCE_MS = 120;
const REFRESH_MIN_INTERVAL_MS = 800;
let refreshCoalesceTimer = null;
let lastRefreshStartedAt = 0;
function scheduleRefresh(force) {
  clearTimeout(refreshCoalesceTimer);
  const wait = Math.max(
    REFRESH_COALESCE_MS,
    REFRESH_MIN_INTERVAL_MS - (Date.now() - lastRefreshStartedAt)
  );
  refreshCoalesceTimer = setTimeout(() => {
    refreshCoalesceTimer = null;
    lastRefreshStartedAt = Date.now();
    refresh(force);
  }, wait);
}

// ---------- 统一方案引擎 ----------
function findPlanItem(id) {
  for (const g of PLAN.groups) {
    const it = g.items.find(x => x.id === id);
    if (it) return it;
  }
  return null;
}

function buildDeletePlan(kind) {
  let groups = [];
  if (kind === 'exact') {
    groups = DATA.exactDuplicates.map(g => ({
      label: g.items[0].domain || g.items[0].host || '链接',
      keep: g.items[0],
      items: g.items
        .slice(1)
        .map(it => ({ id: it.id, title: it.title, url: it.url, host: it.host, included: true }))
    }));
  }
  groups = groups.filter(g => g.items.length);
  if (!groups.length) {
    toast('当前没有可一键清理的重复书签', 'warn');
    return;
  }
  PLAN = { type: 'delete', groups, prefix: '' };
  planMode = true;
  render(currentTab);
}

// 删除预览：每组保留 1 个，其余勾选删除（回收站可恢复）
function renderPlan() {
  if (!PLAN) return;
  const totalItems = PLAN.groups.reduce((s, g) => s + g.items.length, 0);
  const totalAct = PLAN.groups.reduce((s, g) => s + g.items.filter(i => i.included).length, 0);

  let html = `
    <div class="plan-bar">
      <button class="btn small ghost" data-action="plan-back">← 返回</button>
      <span class="plan-tag">${ICON_SM('trash')} 删除预览</span>
      <span class="plan-count">将删除 <b>${totalAct}</b> 个（共 ${totalItems}）</span>
      <button class="btn small danger" data-action="plan-apply">${ICON_SM('check')} 确认删除</button>
    </div>
    ${pageHint(ICON('trash'), '每组仅保留 1 个，其余将删除。可取消勾选不想删的项；删除后 30 天内可在回收站恢复。')}`;

  PLAN.groups.forEach((g, idx) => {
    const body = `
      <div class="plan-keep">
        <span class="k-label">保留</span>
        <span class="k-title">${escapeHtml(g.keep.title)}</span>
      </div>
      ${g.items
        .map(
          i => `
        <div class="row plan-item plan-del clickable" data-id="${i.id}">
          <input type="checkbox" class="plan-inc sel" data-id="${i.id}" ${i.included ? 'checked' : ''}>
          <div class="meta">
            <div class="title">${escapeHtml(i.title)}</div>
            <div class="url">${escapeHtml(i.url)}</div>
          </div>
          <span class="d-label">删除</span>
        </div>`
        )
        .join('')}`;
    const n = g.items.filter(i => i.included).length;
    html += groupWrap(
      'plan-' + idx,
      ICON('trash'),
      g.label,
      n ? 'danger' : '',
      n + ' 待删',
      `
      <label class="plan-grp-toggle">
        <input type="checkbox" class="sel plan-grp" data-idx="${idx}" ${n ? 'checked' : ''}> 整组</label>
    `,
      body
    );
  });
  content().innerHTML = html;
}

// 方案预览局部更新：只刷新计数与徽标，不整页重渲染（防滚动跳动）
function updatePlanSummary() {
  if (!PLAN) return;
  const totalItems = PLAN.groups.reduce((s, g) => s + g.items.length, 0);
  const totalAct = PLAN.groups.reduce((s, g) => s + g.items.filter(i => i.included).length, 0);
  const countEl = document.querySelector('.plan-count');
  if (countEl) countEl.innerHTML = `将删除 <b>${totalAct}</b> 个（共 ${totalItems}）`;
  document.querySelectorAll('#content .group[data-group^="plan-"]').forEach(g => {
    const idx = +String(g.dataset.group).replace('plan-', '');
    const grp = PLAN.groups[idx];
    if (!grp) return;
    const n = grp.items.filter(i => i.included).length;
    const badge = g.querySelector('.badge');
    if (badge) {
      badge.textContent = n + ' 待删';
      badge.className = 'badge' + (n ? ' danger' : '');
    }
    const grpChk = g.querySelector('.plan-grp');
    if (grpChk) grpChk.checked = n > 0;
  });
}

async function applyPlan() {
  if (!PLAN) return;
  try {
    const ids = [];
    PLAN.groups.forEach(g =>
      g.items.forEach(i => {
        if (i.included) ids.push(i.id);
      })
    );
    if (!ids.length) {
      toast('还没有勾选要删除的项', 'warn');
      return;
    }
    const ok = await confirmDialog({
      title: '删除选中的 ' + ids.length + ' 个书签？',
      message:
        '每组将保留 1 个。删除后 30 天内可在「回收站」恢复；本次产生的空文件夹将同步清理（文件夹不可恢复）。',
      confirmText: '移入回收站'
    });
    if (!ok) return;
    const r = await softDelete(ids, '删除中', { pruneEmptyFolders: true });
    toast(
      '已删除 ' +
        r.n +
        ' 个重复书签' +
        (r.prunedFolders ? '，清理 ' + r.prunedFolders + ' 个空文件夹' : ''),
      'ok',
      { label: '撤销', onClick: () => undoDelete(r.items) }
    );
    planMode = false;
    PLAN = null;
    scheduleRefresh();
  } catch (e) {
    endProgress();
    toast('操作失败：' + (e.message || e), 'danger');
  }
}

async function bulkCleanEmpty() {
  const ids = DATA.emptyFolders.map(f => f.id);
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: '清空 ' + ids.length + ' 个空文件夹？',
    message: '空文件夹删除后不可恢复（回收站仅保护书签）。',
    confirmText: '直接删除'
  });
  if (!ok) return;
  // emptyFolders 已按子目录优先收集，必须串行删除才能继续清掉随后变空的父目录。
  const removal = await removeForIds(ids, '清理中', { concurrency: 1, clearTags: false });
  toast('已清理 ' + removal.count + ' 个空文件夹 ✓', 'ok');
  scheduleRefresh();
}

// 统一同址（urlKey 相同）书签的标签：对每一组，取全体标签的并集写回每个书签。
// 用于修复历史遗留的同址不同标（例如 AI 分批打标 / 手动编辑造成的不一致）。
async function unifyExactTags() {
  try {
    await BM.loadTags();
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const currentMap = BM.getTags() || {};
  const groups = getSameUrlGroups();
  if (!groups.length) {
    toast('当前没有同址（网址相同）的多个书签，无需统一', 'ok');
    return;
  }
  // 找出确实存在不一致的组（任一组的标签集合彼此不同）。
  const tagSig = tags => [...(tags || [])].sort().join('\u0000');
  const diverged = groups.filter(items => {
    const sigs = new Set(items.map(it => tagSig(currentMap[it.id] || [])));
    return sigs.size > 1;
  });
  if (!diverged.length) {
    toast('同址书签的标签已一致 ✓', 'ok');
    return;
  }
  const total = diverged.reduce((s, items) => s + items.length, 0);
  const ok = await confirmDialog({
    title: `统一 ${diverged.length} 组同址书签的标签？`,
    message: `将对 <b>${total}</b> 个书签（${diverged.length} 组相同网址）取标签并集，使同址书签标签一致。<br>单书签最多保留 ${BM.MAX_TAGS_PER_BOOKMARK || 6} 个标签，已有标签优先。`,
    confirmText: '统一标签'
  });
  if (!ok) return;
  const changes = {};
  let saved = false;
  try {
    diverged.forEach(items => {
      const union = BM.unionTagLists(items.map(it => currentMap[it.id] || []));
      items.forEach(it => {
        changes[it.id] = union.length ? union : null;
      });
    });
    saved = await BM.setTagsBatch(changes);
  } catch (e) {
    saved = false;
  }
  if (!saved) {
    toast('统一标签保存失败，请重试', 'danger');
    return;
  }
  toast(`已统一 ${diverged.length} 组同址书签的标签 ✓`, 'ok');
  refresh();
}

// ---------- 批量移动：选中项 → 分类文件夹 ----------
// 在书签栏根目录下查找或创建同名文件夹，返回其 id
async function ensureFolder(title) {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0].children && tree[0].children[0];
  if (!bar) throw new Error('未找到书签栏根目录');
  let folder = (await chrome.bookmarks.search({ title })).find(
    f => f.parentId === bar.id && !f.url
  );
  if (!folder) folder = await chrome.bookmarks.create({ parentId: bar.id, title });
  return folder.id;
}

// ---------- 文件夹页操作：新建 / 重命名 / 删除 + ⋮菜单 ----------
// 递归收集某文件夹下所有书签 id（含子孙），用于非空文件夹删除时入回收站
function collectFolderBookmarkIds(node) {
  const ids = [];
  (function walk(n) {
    if (!n) return;
    for (const id of n.bookmarkIds) ids.push(id);
    for (const sub of n.childFolders) walk(sub);
  })(node);
  return ids;
}

async function createFolder(parentId) {
  const pid = parentId || FOLDER_NAV.folderId;
  if (!pid) {
    toast('未确定目标文件夹', 'warn');
    return;
  }
  editingFolder = { mode: 'new', parentId: pid, tempId: 'new-' + Date.now() };
  render('organize');
  setTimeout(() => { const inp = $('#fEditInput'); if (inp) inp.focus(); }, 0);
}

async function renameFolder(id) {
  const node = DATA && DATA.folderTree && DATA.folderTree.folderById.get(id);
  if (!node) return;
  if (node.isSystemRoot) {
    toast('系统文件夹不可重命名', 'warn');
    return;
  }
  editingFolder = { mode: 'rename', id };
  render('organize');
  setTimeout(() => { const inp = $('#fEditInput'); if (inp) { inp.focus(); inp.select(); } }, 0);
}

// 就地编辑提交 / 取消（由 input 的 Enter / Esc / 失焦触发）
async function submitFolderEdit(mode, id, value) {
  const ed = editingFolder;
  const name = (value || '').trim();
  editingFolder = null;
  if (!name) { render('organize'); return; }
  try {
    if (mode === 'new') {
      const pid = ed && ed.parentId ? ed.parentId : FOLDER_NAV.folderId;
      const node = await chrome.bookmarks.create({ parentId: pid, title: name });
      if (node && node.id) highlightFolderId = String(node.id);
      toast('已新建文件夹「' + name + '」 ✓', 'ok');
    } else if (mode === 'rename' && id) {
      await chrome.bookmarks.update(id, { title: name });
      highlightFolderId = id;
      toast('已重命名 ✓', 'ok');
    }
    refresh();
  } catch (e) {
    toast('操作失败：' + (e.message || e), 'danger');
    render('organize');
  }
}
function cancelFolderEdit() {
  editingFolder = null;
  render('organize');
}

async function deleteFolder(id) {
  const node = DATA && DATA.folderTree && DATA.folderTree.folderById.get(id);
  if (!node) return;
  if (node.isSystemRoot) {
    toast('系统文件夹不可删除', 'warn');
    return;
  }
  // 空文件夹：直接删除（不可恢复，与「清理→空文件夹」一致）
  if (node.directCount === 0) {
    const ok = await confirmDialog({
      title: '删除空文件夹？',
      message: '「' + escapeHtml(node.title) + '」是空文件夹，删除后不可恢复。',
      confirmText: '直接删除'
    });
    if (!ok) return;
    try {
      await chrome.bookmarks.remove(id);
      toast('已删除空文件夹 ✓', 'ok');
      if (FOLDER_NAV.folderId === id) FOLDER_NAV.folderId = node.parentId || '';
      refresh();
    } catch (e) {
      toast('删除失败：' + (e.message || e), 'danger');
    }
    return;
  }
  // 非空文件夹：书签进回收站（可恢复），文件夹结构 removeTree（不可恢复）
  const ok = await confirmDialog({
    title: '删除文件夹「' + node.title + '」？',
    message:
      '该文件夹含 <b>' +
      node.directCount +
      '</b> 个直属子项（共 ' +
      node.totalCount +
      ' 个书签）。书签将进入回收站（30 天可恢复），文件夹结构不可恢复。',
    confirmText: '直接删除'
  });
  if (!ok) return;
  try {
    const ids = collectFolderBookmarkIds(node);
    if (ids.length) {
      await softDelete(ids, '删除文件夹', { pruneEmptyFolders: false });
    }
    // 书签已删后文件夹为空结构，removeTree 干净删除（若仍有残留书签会一并物理删除）
    await chrome.bookmarks.removeTree(id);
    // 文件夹结构不可恢复，但其中的书签还在回收站：明确告知恢复入口，避免用户以为彻底丢了
    toast(
      '已删除文件夹 ✓' + (ids.length ? `（${ids.length} 个书签已进回收站，可恢复）` : ''),
      'ok'
    );
    if (FOLDER_NAV.folderId === id) FOLDER_NAV.folderId = node.parentId || '';
    refresh();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'danger');
    try {
      BM.logError('deleteFolder', e);
    } catch (e2) {
      /* ignore */
    }
  }
}

function closeFolderMenu() {
  const old = $('#folderMenuPop');
  if (!old) return;
  if (old._onAway) document.removeEventListener('mousedown', old._onAway);
  if (old._onKey) document.removeEventListener('keydown', old._onKey);
  old.remove();
}

function openFolderMenu(btn, id) {
  closeFolderMenu();
  const node = DATA && DATA.folderTree && DATA.folderTree.folderById.get(id);
  if (!node) return;
  const sys = node.isSystemRoot;
  const pop = document.createElement('div');
  pop.className = 'f-menu-pop';
  pop.id = 'folderMenuPop';
  pop.innerHTML = `
    <button class="f-menu-item" data-action="folder-rename" data-id="${id}" ${sys ? 'disabled' : ''}>${ICON_SM('edit')} 重命名</button>
    <button class="f-menu-item" data-action="new-folder" data-id="${id}">${ICON_SM('plus')} 新建子文件夹</button>
    <div class="f-menu-sep"></div>
    <button class="f-menu-item danger" data-action="folder-delete" data-id="${id}" ${sys ? 'disabled' : ''}>${ICON_SM('trash')} 删除</button>`;
  document.body.appendChild(pop);
  // 定位到 ⋮ 按钮下方，靠右对齐；溢出视口则翻转 / 收紧
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let top = r.bottom + 4;
  if (top + pop.offsetHeight > vh - 8) top = Math.max(8, r.top - pop.offsetHeight - 4);
  let left = r.right - pop.offsetWidth;
  left = Math.max(8, Math.min(left, vw - pop.offsetWidth - 8));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  // 菜单项点击（菜单在 #content 之外，不经过内容区事件委托）
  pop.addEventListener('click', e => {
    const item = e.target.closest('button.f-menu-item');
    if (!item || item.disabled) return;
    const action = item.dataset.action;
    const fid = item.dataset.id;
    closeFolderMenu();
    if (action === 'folder-rename') renameFolder(fid);
    else if (action === 'new-folder') createFolder(fid);
    else if (action === 'folder-delete') deleteFolder(fid);
  });
  // 点外部 / Esc 关闭
  const onAway = e => {
    if (!pop.contains(e.target)) closeFolderMenu();
  };
  const onKey = e => {
    if (e.key === 'Escape') closeFolderMenu();
  };
  pop._onAway = onAway;
  pop._onKey = onKey;
  setTimeout(() => {
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
  }, 0);
}

// 书签右键菜单：打开 / 后台打开 / 编辑 / 复制链接 / AI打标 / 删除
function openBookmarkMenu(anchor, id) {
  closeFolderMenu();
  const it = getItemById(id);
  if (!it || !it.url) return;
  const pop = document.createElement('div');
  pop.className = 'f-menu-pop';
  pop.id = 'folderMenuPop';
  pop.innerHTML = `
    <button class="f-menu-item" data-bm-action="open">${ICON_SM('globe')} 打开</button>
    <button class="f-menu-item" data-bm-action="open-bg">${ICON_SM('arrow-r')} 后台打开</button>
    <div class="f-menu-sep"></div>
    <button class="f-menu-item" data-bm-action="edit">${ICON_SM('edit')} 编辑</button>
    <button class="f-menu-item" data-bm-action="copy">${ICON_SM('link')} 复制链接</button>
    <button class="f-menu-item" data-bm-action="move">${ICON_SM('folder')} 移动到…</button>
    <button class="f-menu-item" data-bm-action="ai">${ICON_SM('sparkles')} AI 打标</button>
    <div class="f-menu-sep"></div>
    <button class="f-menu-item danger" data-bm-action="delete">${ICON_SM('trash')} 删除</button>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let top = r.bottom + 4;
  if (top + pop.offsetHeight > vh - 8) top = Math.max(8, r.top - pop.offsetHeight - 4);
  let left = r.right - pop.offsetWidth;
  left = Math.max(8, Math.min(left, vw - pop.offsetWidth - 8));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  pop.addEventListener('click', e => {
    const item = e.target.closest('button.f-menu-item');
    if (!item) return;
    const a = item.dataset.bmAction;
    closeFolderMenu();
    if (a === 'open') openBookmarkUrl(it.url, true);
    else if (a === 'open-bg') openBookmarkUrl(it.url, false);
    else if (a === 'edit') openAddDrawer(it);
    else if (a === 'copy') copyBookmarkUrl(it.url);
    else if (a === 'move') openMoveToPicker([id]);
    else if (a === 'ai') aiTagSingle(id);
    else if (a === 'delete') softDeleteBookmark(id);
  });
  const onAway = e => { if (!pop.contains(e.target)) closeFolderMenu(); };
  const onKey = e => { if (e.key === 'Escape') closeFolderMenu(); };
  pop._onAway = onAway;
  pop._onKey = onKey;
  setTimeout(() => {
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function copyBookmarkUrl(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => toast('已复制链接 ✓', 'ok'),
      () => fallbackCopy(url)
    );
  } else fallbackCopy(url);
}
function fallbackCopy(url) {
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制链接 ✓', 'ok');
  } catch (e) {
    toast('复制失败', 'danger');
  }
}

async function softDeleteBookmark(id) {
  const it = getItemById(id);
  const name = it && it.title ? '「' + escapeHtml(it.title) + '」' : '该书签';
  const ok = await confirmDialog({
    title: '删除书签？',
    message: name + '删除后 30 天内可在回收站恢复。',
    confirmText: '移入回收站'
  });
  if (!ok) return;
  try {
    const r = await softDelete([id], '删除书签', { pruneEmptyFolders: false });
    // 单条删除同样给出「撤销」入口（与批量删除、重复项清理保持一致）
    if (r.n) {
      toast('已删除书签 ✓', 'ok', { label: '撤销', onClick: () => undoDelete(r.items) });
    }
    // 走合并调度：标签回写触发的 storage 刷新会并进同一轮扫描
    scheduleRefresh();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'danger');
  }
}

// ---------- 选择 / 批量栏 ----------
function getSelectedIds() {
  return [...document.querySelectorAll('#content .sel:checked')].map(c => c.dataset.id);
}

function updateBulk() {
  // 悬浮 pill 批量栏出现时，让 #app 让出底部空间（#toasts 随之上移）
  const app = document.getElementById ? document.getElementById('app') : null;
  if (planMode) {
    $('#bulkBar').classList.add('hidden');
    if (app) app.classList.toggle('has-bulk', false);
    return;
  }
  const checked = getSelectedIds();
  const bar = $('#bulkBar');
  if (checked.length) {
    $('#bulkCount').innerHTML = '已选 <b>' + checked.length + '</b> 项';
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
  if (app) app.classList.toggle('has-bulk', checked.length > 0);
}

// ---------- 标签切换与渲染分发 ----------
function switchTab(tab) {
  const changed = currentTab !== tab;
  planMode = false;
  PLAN = null;
  currentTab = tab;
  overviewDetail = '';
  document.querySelectorAll('.tab').forEach(x => {
    const on = x.dataset.tab === tab;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (!DATA) return;
  const token = ++tabRenderToken;
  if (!changed) {
    render(tab);
    return;
  }
  // 保留当前内容直到下一帧的轻量首屏就绪，避免切换时闪现整页加载态。
  requestAnimationFrame(() => {
    if (token === tabRenderToken) render(tab);
  });
}

function render(tab) {
  currentTab = tab;
  // 数据尚未就绪时保留现有内容（骨架/加载态），不要用空数据渲染出 TypeError
  if (!DATA) return;
  if (SEARCH) {
    renderSearch();
    return;
  }
  if (planMode) {
    renderPlan();
    return;
  }
  if (tab === 'overview' && overviewDetail === 'clean') renderClean();
  else if (tab === 'overview' && overviewDetail === 'trash') renderTrashView();
  else if (tab === 'overview') renderOverview();
  else if (tab === 'hidden') renderHidden();
  // 兼容历史页签 id（tags → organize），避免旧 data-tab / data-jump 值渲染空白
  else if (tab === 'organize' || tab === 'tags') renderOrganize();
  applyCollapsed(); // 恢复折叠状态（sessionStorage 记忆）
  updateBulk();
}

function openOverviewDetail(detail, sub) {
  tabRenderToken++;
  overviewDetail = detail;
  if (detail === 'clean') cleanSub = sub || 'repeat';
  planMode = false;
  PLAN = null;
  currentTab = 'overview';
  document.querySelectorAll('.tab').forEach(x => {
    const on = x.dataset.tab === 'overview';
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (DATA) render('overview');
}

// 折叠状态记忆：渲染后按 sessionStorage 恢复各分组折叠状态
function applyCollapsed() {
  try {
    document.querySelectorAll('#content .group').forEach(g => {
      const key = 'bm-fold-' + g.dataset.group;
      const body = g.querySelector('.group-body');
      const head = g.querySelector('.group-head');
      if (sessionStorage.getItem(key) === '1') {
        if (body) body.style.display = 'none';
        if (head) head.setAttribute('aria-expanded', 'false');
      } else if (head) {
        head.setAttribute('aria-expanded', 'true');
      }
    });
  } catch (e) {
    /* ignore */
  }
}

// ---------- 键盘导航（j/k 移动高亮行，Enter 打开） ----------
let kbRow = null;
function kbRows() {
  return [...document.querySelectorAll('#content .row.clickable')];
}
// 高亮行的可选祖先容器（屏幕阅读器用 aria-activedescendant 感知当前项）
function kbListFor(row) {
  if (!row) return content();
  return row.closest('.group-body') || row.closest('.search-results-list') || content();
}
function kbHighlight(row) {
  kbRow = row;
  const rows = kbRows();
  rows.forEach(r => {
    const on = r === row;
    r.classList.toggle('kb-focus', on);
    // kb-active：css/popup.css 用它让键盘高亮行的拖拽把手保持可见
    r.classList.toggle('kb-active', on);
    if (r.setAttribute) r.setAttribute('aria-selected', on ? 'true' : 'false');
    // 稳定 id：供 aria-activedescendant 引用
    if (r.dataset && r.dataset.id && !r.id) r.id = 'row-' + r.dataset.id;
  });
  const list = kbListFor(row);
  if (list && list.setAttribute) {
    // #content 本身是 role="tabpanel"，不能在运行时改写成 listbox；
    // 只有真正的列表容器（分组体 / 搜索结果列表 / #orgBody）才能当 listbox。
    if (list === content()) {
      // 隐藏视图的行直接挂在 #content 下：不写 listbox 语义，只清掉可能残留的
      // aria-activedescendant；行自身带 role="option" + tabindex，仍可逐项读出。
      if (list.removeAttribute) list.removeAttribute('aria-activedescendant');
    } else {
      list.setAttribute('role', 'listbox');
      // aria-activedescendant 必须挂在拥有焦点的元素上：让列表容器可被脚本聚焦，
      // 并在焦点还在列表之外（如 body）时把焦点交给它，读屏才会播报高亮行。
      list.setAttribute('tabindex', '-1');
      if (row && row.id) list.setAttribute('aria-activedescendant', row.id);
      else if (list.removeAttribute) list.removeAttribute('aria-activedescendant');
      const trapOpen = window.UI && typeof UI.hasOpenTrap === 'function' && UI.hasOpenTrap();
      if (!trapOpen && typeof list.focus === 'function' && !list.contains(document.activeElement)) {
        try {
          list.focus({ preventScroll: true });
        } catch (e) {
          /* 老实现无 options 参数时忽略 */
        }
      }
    }
  }
  if (row) row.scrollIntoView({ block: 'nearest' });
}
function kbMove(dir) {
  const rows = kbRows();
  if (!rows.length) return;
  const idx = kbRow ? rows.indexOf(kbRow) : -1;
  const next = Math.max(0, Math.min(rows.length - 1, idx + dir));
  kbHighlight(rows[next]);
}
// background 为 true 时后台打开（不切换当前标签页），默认前台打开
function kbOpen(row, background) {
  if (row.dataset.type === 'folder') {
    enterFolder(row.dataset.id);
    return;
  }
  const it = getItemById(row.dataset.id);
  if (it && it.url) openBookmarkUrl(it.url, !background);
}
// Ctrl/⌘ + ↑/↓：在所在文件夹内上下移动当前高亮书签（键盘替代拖拽）
async function kbMoveBookmark(dir) {
  if (!kbRow || !kbRow.dataset.id) return;
  const id = kbRow.dataset.id;
  try {
    const it = getItemById(id);
    if (!it) return;
    const children = await chrome.bookmarks.getChildren(it.parentId);
    const index = children.findIndex(c => String(c.id) === String(id));
    if (index < 0) return;
    const next = index + dir;
    if (next < 0 || next >= children.length) return;
    await chrome.bookmarks.move(id, { parentId: it.parentId, index: next });
    toast('已移动书签 ✓', 'ok');
    refresh();
  } catch (e) {
    toast('移动失败：' + (e.message || e), 'danger');
  }
}

// ---------- 拖拽排序 / 跨组移动（HTML5 drag & drop） ----------
let dragState = null; // { id, fromParent }

// ---------- FLIP 落位动画（投放后 200ms，仅改 transform，动画结束移除类）----------
const FLIP_DURATION_MS = 200;
function flipKey(el) {
  if (el.classList.contains('group-head')) {
    const group = el.closest('.group');
    return 'head:' + ((group && group.dataset.group) || '');
  }
  return 'row:' + ((el.dataset && el.dataset.id) || '');
}
// 记录可投放元素的当前位置（首）
function flipSnapshot() {
  const map = new Map();
  document.querySelectorAll('#content .row.clickable.draggable, #content .group-head').forEach(el => {
    const rect = el.getBoundingClientRect();
    map.set(flipKey(el), { top: rect.top, left: rect.left });
  });
  return map;
}
// 与投放后的位置比较，对发生位移的元素播放 transform 过渡（末）
function playFlip(before) {
  if (!before || !before.size || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    document.querySelectorAll('#content .row.clickable.draggable, #content .group-head').forEach(el => {
      const prev = before.get(flipKey(el));
      if (!prev) return;
      const rect = el.getBoundingClientRect();
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      requestAnimationFrame(() => {
        el.classList.add('flip-in');
        el.style.transition = 'transform ' + FLIP_DURATION_MS + 'ms ease';
        el.style.transform = '';
        setTimeout(() => {
          el.classList.remove('flip-in');
          el.style.transition = '';
        }, FLIP_DURATION_MS + 40);
      });
    });
  });
}

function bindDrag() {
  const contentEl = content();
  contentEl.addEventListener('dragstart', e => {
    // 拖拽把手：书签行与文件夹行统一为 .drag-handle（行首）
    const handle = e.target.closest('.drag-handle');
    const row = handle ? handle.closest('.row.clickable.draggable') : null;
    if (!row || !row.dataset.id) return;
    const id = row.dataset.id;
    if (row.dataset.type === 'folder') {
      const node = DATA.folderTree && DATA.folderTree.folderById.get(id);
      if (!node) return;
      dragState = { id, type: 'folder', fromParent: node.parentId };
    } else {
      const it = getItemById(id);
      if (!it) return;
      dragState = { id, type: 'bookmark', fromParent: it.parentId };
    }
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch (err) {
      /* ignore */
    }
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  contentEl.addEventListener('dragend', () => {
    clearDragHints();
    dragState = null;
    // 拖拽取消（未投放）时清掉行内残留的拖拽态
    contentEl.querySelectorAll('.row.dragging').forEach(row => row.classList.remove('dragging'));
  });
  contentEl.addEventListener('dragover', e => {
    const row = e.target.closest('.row.clickable.draggable');
    const head = e.target.closest('.group-head');
    if (!row && !head) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDragHints();
    if (row) {
      const rect = row.getBoundingClientRect();
      const isFolderRow = row.dataset.type === 'folder';
      row.classList.add('drop-target');
      // 拖文件夹到文件夹行 = 排序（前后指示）；拖书签到文件夹行 = 移入（drop-inside）
      if (isFolderRow && dragState && dragState.type === 'folder') {
        row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
      } else if (isFolderRow) {
        row.classList.add('drop-inside');
      } else {
        row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
      }
    } else if (head) {
      head.classList.add('drop-target');
      head.closest('.group').classList.add('drag-target');
    }
  });
  contentEl.addEventListener('drop', async e => {
    e.preventDefault();
    // 同步快照：浏览器在 drop 事件派发结束后立即触发 dragend（不会等待 async 处理器完成），
    // dragend 会把 dragState 置空；若在 await 之后再读 dragState 会拿到 null，
    // 导致 "Cannot read properties of null (reading 'fromParent')"。
    const drag = dragState;
    if (!drag) return;
    // FLIP：记录投放前的位置（首），重扫后再比对末位置播放落位动画
    const flipBefore = flipSnapshot();
    const row = e.target.closest('.row.clickable.draggable');
    const head = e.target.closest('.group-head');
    try {
      // 标签视图：拖书签 = 加标签 / 继承标签（不动物理位置）
      if (currentTab === 'organize' && ORG_VIEW === 'tags' && drag.type === 'bookmark') {
        if (head) await dropOntoGroup(head, drag);
        else if (row && row.dataset.id !== drag.id) await dropInheritTags(row, drag);
      } else if (row && row.dataset.id !== drag.id) {
        const isFolderRow = row.dataset.type === 'folder';
        if (isFolderRow && drag.type === 'folder') await dropFolderOntoTarget(row.dataset.id, drag);
        else if (isFolderRow) await dropBookmarkIntoFolder(row.dataset.id, drag);
        else if (drag.type === 'folder') await dropFolderOntoTarget(row.dataset.id, drag);
        else await dropOntoRow(row, drag);
      } else if (head) {
        await dropOntoGroup(head, drag);
      }
    } catch (err) {
      toast('移动失败：' + (err.message || err), 'danger');
      try {
        BM.logError('drag', err);
      } catch (e2) {
        /* ignore */
      }
    } finally {
      dragState = null;
      clearDragHints();
      // 重扫完成后播放落位动画（失败静默）
      refresh()
        .then(() => playFlip(flipBefore))
        .catch(() => {});
    }
  });
}

function clearDragHints() {
  document
    .querySelectorAll(
      '#content .drop-before, #content .drop-after, #content .drop-inside, #content .drop-target, #content .group.drag-target'
    )
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-target', 'drag-target'));
}

// 拖到书签行：排序 / 插入到目标行所在文件夹的对应位置
// drag 为 drop 入口处的同步快照（dragend 会清空 dragState，不能直接读）
async function dropOntoRow(row, drag) {
  if (!drag) return;
  const targetIt = getItemById(row.dataset.id);
  if (!targetIt) return;
  const children = await chrome.bookmarks.getChildren(targetIt.parentId);
  let index = children.findIndex(c => c.id === targetIt.id);
  if (dsFromSameParent(drag.fromParent, targetIt.parentId)) {
    const fromIndex = children.findIndex(c => c.id === drag.id);
    if (fromIndex >= 0 && fromIndex < index) index -= 1;
  }
  await chrome.bookmarks.move(drag.id, {
    parentId: targetIt.parentId,
    index: index < 0 ? 0 : index
  });
  toast('已移动书签 ✓', 'ok');
}
const dsFromSameParent = (a, b) => String(a) === String(b);

// 拖到分组标题：整组移动（exact → 域名文件夹；category → 分类文件夹）
async function dropOntoGroup(head, drag) {
  if (!drag) return;
  const group = head.closest('.group');
  const gkey = group.dataset.group;
  const gnameEl = head.querySelector('.g-name');
  const name = gnameEl ? gnameEl.textContent : '';
  if (!gkey || !name) {
    toast('该分组不支持拖入', 'warn');
    return;
  }
  // 标签视图：拖书签到标签分组 = 加该标签（不动物理位置）
  if (gkey.startsWith('tag-')) {
    const tag = name.replace(/^#/, '').trim();
    if (!tag || tag === BM.FALLBACK_TAG) {
      toast('该标签不支持拖入', 'warn');
      return;
    }
    if (drag.type === 'folder') {
      toast('文件夹不能加标签，请在文件夹视图操作', 'warn');
      return;
    }
    await BM.persistTagChanges({ [drag.id]: [tag] }, 'merge');
    toast('已加标签 #' + tag + ' ✓', 'ok');
    refresh();
    return;
  }
  let folderTitle;
  if (gkey.startsWith('exact-')) folderTitle = name;
  else if (gkey.startsWith('cat-')) folderTitle = '书签管家·' + name;
  else {
    toast('该分组不支持拖入', 'warn');
    return;
  }
  const folderId = await ensureFolder(folderTitle);
  await chrome.bookmarks.move(drag.id, { parentId: folderId });
  toast('已移动到「' + name + '」✓', 'ok');
}

// 文件夹拖到任意行（书签行或文件夹行）：移到目标所在 parentId 的对应位置（排序 / 跨层移动）
async function dropFolderOntoTarget(targetId, drag) {
  let targetParentId, targetNodeId;
  const folderNode = DATA.folderTree && DATA.folderTree.folderById.get(targetId);
  if (folderNode) {
    targetParentId = folderNode.parentId;
    targetNodeId = targetId;
  } else {
    const it = getItemById(targetId);
    if (!it) return;
    targetParentId = it.parentId;
    targetNodeId = targetId;
  }
  // 拖到自身父级 = 原位，无意义；真正的循环（拖进子孙）由 chrome.bookmarks.move 抛错，由 drop 的 catch 捕获
  if (String(drag.id) === String(targetParentId)) {
    toast('不能移动到原位置', 'warn');
    return;
  }
  const children = await chrome.bookmarks.getChildren(targetParentId);
  let index = children.findIndex(c => String(c.id) === String(targetNodeId));
  if (index < 0) index = 0;
  if (String(drag.fromParent) === String(targetParentId)) {
    const fromIndex = children.findIndex(c => String(c.id) === String(drag.id));
    if (fromIndex >= 0 && fromIndex < index) index -= 1;
  }
  if (index < 0) index = 0;
  await chrome.bookmarks.move(drag.id, { parentId: targetParentId, index });
  toast('已移动文件夹 ✓', 'ok');
}

// 书签拖到文件夹行：移入该文件夹
async function dropBookmarkIntoFolder(folderId, drag) {
  const node = DATA.folderTree && DATA.folderTree.folderById.get(folderId);
  if (!node) return;
  if (String(drag.id) === String(folderId)) return;
  await chrome.bookmarks.move(drag.id, { parentId: folderId });
  toast('已移入「' + node.title + '」 ✓', 'ok');
}

// 标签视图：拖书签到另一书签行 = 继承目标行的标签（并集，不动物理位置）
async function dropInheritTags(row, drag) {
  if (!drag) return;
  const targetIt = getItemById(row.dataset.id);
  if (!targetIt) return;
  const targetTags = (targetIt.tags || []).filter(t => t && t !== BM.FALLBACK_TAG);
  if (!targetTags.length) {
    toast('目标书签无可继承的标签', 'warn');
    return;
  }
  await BM.persistTagChanges({ [drag.id]: targetTags }, 'merge');
  toast('已继承 ' + targetTags.length + ' 个标签 ✓', 'ok');
  refresh();
}

// ---------- 快捷键注册表：帮助抽屉据此生成，避免文档与实现漂移 ----------
function registerShortcuts() {
  if (!window.UI || typeof UI.registerShortcut !== 'function') return;
  const R = entry => UI.registerShortcut(entry);
  R({ keys: '/', desc: '聚焦搜索框', group: '键盘快捷键' });
  R({ keys: 'Ctrl / ⌘ + K', desc: '聚焦搜索框', group: '键盘快捷键' });
  R({ keys: 'j / k', desc: '上下移动高亮行', group: '键盘快捷键' });
  R({ keys: 'Enter', desc: '打开高亮书签', group: '键盘快捷键' });
  R({ keys: 'Shift + Enter', desc: '后台打开高亮书签', group: '键盘快捷键' });
  R({ keys: 'Ctrl / ⌘ + ↑ / ↓', desc: '在文件夹内移动书签', group: '键盘快捷键' });
  R({ keys: 'N / F2 / Delete', desc: '组织页：新建 / 重命名 / 删除文件夹', group: '组织页' });
  R({ keys: '?', desc: '打开本指南', group: '键盘快捷键' });
  R({ keys: 'Esc', desc: '关闭抽屉 / 弹层，或退出方案预览', group: '键盘快捷键' });
}

// 「组织」页一次性拖拽引导：仅在从未标记过时提示一次，storage 失败静默
let organizeTipChecked = false;
function maybeShowOrganizeTip() {
  if (organizeTipChecked) return;
  organizeTipChecked = true;
  // 单测会单独 eval 本函数，故对模块级常量做 typeof 兜底
  const key = typeof ORGANIZE_TIP_KEY === 'string' ? ORGANIZE_TIP_KEY : 'bmOrganizeTipShown';
  const text =
    typeof ORGANIZE_TIP_TEXT === 'string'
      ? ORGANIZE_TIP_TEXT
      : '拖动书签行左侧把手可排序，拖到分组标题上可移动分组';
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const store = chrome.storage.local;
    store.get(key, res => {
      try {
        if (res && res[key]) return;
        const ui = (typeof UI !== 'undefined' && UI) || (typeof window !== 'undefined' && window.UI) || null;
        if (ui && typeof ui.toast === 'function') ui.toast(text, 'info');
        else toast(text, 'info');
        store.set({ [key]: true });
      } catch (e) {
        /* ignore */
      }
    });
  } catch (e) {
    /* ignore */
  }
}

// ---------- 打开面板即聚焦搜索框 ----------
// 管理面板的宿主是侧边栏与独立标签页，两者打开后都会把键盘焦点交给文档；但 Chrome 在面板刚
// 加载的一瞬间可能仍把焦点留在浏览器 UI（地址栏 / 工具栏），此时页面的 focus() 会被忽略，
// 所以要按时间窗重试。判据不能只看 activeElement：焦点被浏览器忽略时它一样会指向输入框。
// 用户一旦开始操作页面（点击 / 按键）就立即停止，之后不再抢焦点。
let searchAutofocusStopped = false;
let searchAutofocusTimers = [];

function isEditableElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

function focusSearchOnOpen() {
  if (searchAutofocusStopped) return;
  const input = $('#searchInput');
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch (e) {
    input.focus();
  }
  // 页面持有焦点 + 焦点落在搜索框，才算真正成功
  if (!document.hasFocus() || document.activeElement !== input) return;
  searchAutofocusStopped = true;
  searchAutofocusTimers.forEach(clearTimeout);
  searchAutofocusTimers = [];
  // 框内已有内容时全选，便于直接覆盖输入（与 newtab 的搜索框行为一致）
  if (input.value) {
    try {
      input.select();
    } catch (e) {
      /* 部分环境不支持 select，忽略 */
    }
  }
}

function armSearchAutofocus() {
  searchAutofocusTimers.forEach(clearTimeout);
  searchAutofocusTimers = [0, 60, 150, 300, 600, 1200].map(ms => setTimeout(focusSearchOnOpen, ms));
}

function stopSearchAutofocus() {
  searchAutofocusStopped = true;
  searchAutofocusTimers.forEach(clearTimeout);
  searchAutofocusTimers = [];
}

function setupSearchAutofocus() {
  // 常驻而非 once：重新武装后仍要能被同一次交互立即叫停
  document.addEventListener('pointerdown', stopSearchAutofocus, { capture: true });
  document.addEventListener('keydown', stopSearchAutofocus, { capture: true });
  // 侧边栏关闭后文档可能被复用（不重跑 init），再次可见时重新武装一次；
  // 但焦点已经落在面板内的输入控件上时（用户正在别处编辑）不抢。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (isEditableElement(document.activeElement)) return;
    searchAutofocusStopped = false;
    armSearchAutofocus();
  });
  armSearchAutofocus();
}

// ---------- 初始化 ----------
async function init() {
  // 面板结构被改动导致关键节点缺失时立刻报错：否则事件注册会在中途静默中断，
  // 顶部栏 / 内容区 / 批量栏全部不可用，用户看到的就是「白屏」。
  const REQUIRED_NODES = ['#searchInput', '#searchClear', '#content', '#bulkBar', '#addDrawer'];
  const missingNodes = REQUIRED_NODES.filter(selector => !$(selector));
  if (missingNodes.length) {
    throw new Error('面板结构缺少必要元素：' + missingNodes.join('、') + '，请重新加载扩展');
  }
  // 打开面板即把光标放进搜索框：不等首轮书签分析，用户可以先打字
  setupSearchAutofocus();
  // 设置只影响 AI 操作；与首轮书签分析并行读取，避免首屏多等待一次 storage。
  tagConfigurationReady = BM.initializeSyncedTagConfiguration
    ? BM.initializeSyncedTagConfiguration().catch(() => {
        tagConfigurationSyncFailed = true;
        return false;
      })
    : Promise.resolve(false);
  settingsReady = loadSettings();

  // 标签切换
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // 全局搜索
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  searchInput.addEventListener('input', () => {
    SEARCH = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('hidden', !SEARCH);
    syncSearchScopeVisibility();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!DATA) return; // 首轮扫描未完成时不要用空数据渲染
      if (SEARCH) renderSearch();
      else render(currentTab);
    }, 180);
  });
  searchClear.addEventListener('click', () => {
    clearSearch();
  });

  // 搜索范围 chips：切换 scope（aria-pressed / .active 同步在 setSearchScope 内）
  const searchScope = $('#searchScope');
  if (searchScope) {
    searchScope.addEventListener('click', e => {
      const chip = e.target.closest('.scope-chip');
      if (!chip) return;
      setSearchScope(chip.dataset.scope || 'all');
      searchInput.focus();
    });
  }

  // 文件夹视图内搜索（实时过滤当前层书签，防抖 + 重渲染后恢复焦点/光标）
  let folderSearchTimer = null;
  content().addEventListener('input', e => {
    if (e.target.id === 'folderSearch') {
      FOLDER_SEARCH = e.target.value;
      clearTimeout(folderSearchTimer);
      const pos = e.target.selectionStart || 0;
      folderSearchTimer = setTimeout(() => {
        render('organize');
        const inp = $('#folderSearch');
        if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
      }, 120);
    }
  });

  // 内容区事件委托
  content().addEventListener('click', e => {
    // KPI / 行动清单 / 概览快捷卡片从概览进入工具视图，不增加顶级页签。
    const jmp = e.target.closest('[data-jump]');
    if (jmp) {
      const t = jmp.dataset.jump;
      const sub = jmp.dataset.sub || '';
      if (t === 'clean' || t === 'trash') openOverviewDetail(t, sub);
      // 兼容历史 data-jump="tags"（页签 id 现为 organize），保留旧值不破坏现有断言
      else switchTab(t === 'tags' ? 'organize' : t);
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'clear-search') {
        clearSearch();
      } else if (action === 'selall') {
        const g = btn.dataset.group;
        document.querySelectorAll(`.group[data-group="${g}"] .sel`).forEach(c => {
          c.checked = true;
        });
        updateBulk();
      } else if (action === 'keepfirst') {
        const g = DATA.exactDuplicates[+btn.dataset.idx];
        const ids = g.items.slice(1).map(i => i.id);
        confirmDialog({
          title: '清理这组重复书签？',
          message: `将删除 <b>${ids.length}</b> 个重复项，保留「${escapeHtml(g.items[0].title)}」。删除后 30 天内可在回收站恢复；本次产生的空文件夹将同步清理（文件夹不可恢复）。`,
          confirmText: '移入回收站'
        }).then(ok => {
          if (!ok) return;
          softDelete(ids, '清理重复项', { pruneEmptyFolders: true }).then(r => {
            if (r.n)
              toast(
                '已清理 ' +
                  r.n +
                  ' 个重复项' +
                  (r.prunedFolders ? '，清理 ' + r.prunedFolders + ' 个空文件夹' : ''),
                'ok',
                { label: '撤销', onClick: () => undoDelete(r.items) }
              );
            refresh();
          });
        });
      } else if (action === 'bulk-exact') {
        buildDeletePlan('exact');
      } else if (action === 'unify-exact-tags') {
        unifyExactTags();
      } else if (action === 'bulk-empty') {
        bulkCleanEmpty();
      } else if (action === 'clean-sub') {
        // 清理 tab 子区块切换
        cleanSub = btn.dataset.sub || 'repeat';
        renderClean();
      } else if (action === 'overview-back') {
        overviewDetail = '';
        render('overview');
      } else if (action === 'show-more') {
        const list = btn.dataset.list;
        const step = Math.max(1, Number(btn.dataset.step) || FIRST_LIST_COUNT);
        if (!list) return;
        listRenderLimits[list] = Math.max(listRenderLimits[list] || 0, step) + step;
        render(currentTab);
      } else if (action === 'filter-tag') {
        // 标签筛选：点标签 chips / 书签行内标签 → 设置筛选并跳转标签页
        openTagFilter(btn.dataset.tag);
      } else if (action === 'clear-tag-filter') {
        TAG_FILTER = '';
        render('organize');
      } else if (action === 'ai-tag-single') {
        aiTagSingle(btn.dataset.id);
      } else if (action === 'ai-tag-all') {
        // 运行中点击 = 终止打标；空闲时点击 = 开始批量打标（仅未打标）
        if (aiTagRunning) aiTagCancel = true;
        else aiTagAll(false);
      } else if (action === 'ai-tag-all-force') {
        // 全量重打：覆盖所有书签标签
        if (aiTagRunning) aiTagCancel = true;
        else aiTagAll(true);
      } else if (action === 'apply-custom-rules') {
        applyCustomRules(btn);
      } else if (action === 'edit-custom-rules') {
        openCustomRuleSettings();
      } else if (action === 'migrate-tags') {
        migrateTags();
      } else if (action === 'toggle-hidden') {
        // 切换书签隐藏状态（从日常视图排除/恢复）
        BM.toggleHidden(btn.dataset.id).then(() => {
          const it = getItemById(btn.dataset.id);
          if (it) it.hidden = BM.isHidden(it.id);
          refresh();
        });
      } else if (action === 'create-tag') {
        createTag();
      } else if (action === 'manage-tags') {
        openTagManager();
      } else if (action === 'pick-tag') {
        // 建议标签 chip：追加到标签输入框（去重）
        const t = btn.dataset.tag || '';
        if (!t) return;
        const cur = ($('#addTags').value || '')
          .split(/[,，]/)
          .map(s => s.trim())
          .filter(Boolean);
        if (!cur.includes(t)) {
          cur.push(t);
          $('#addTags').value = cur.join(', ');
        }
        renderTagSuggest();
      } else if (action === 'delfolder') {
        confirmDialog({
          title: '删除空文件夹？',
          message: '「' + escapeHtml(btn.dataset.title || '') + '」是空文件夹，删除后不可恢复。',
          confirmText: '直接删除'
        }).then(ok => {
          if (!ok) return;
          removeForIds([btn.dataset.id], '删除中', { clearTags: false }).then(removal => {
            if (removal.count) toast('已删除空文件夹 ✓', 'ok');
            refresh();
          });
        });
      } else if (action === 'plan-back') {
        planMode = false;
        PLAN = null;
        render(currentTab);
      } else if (action === 'plan-apply') {
        applyPlan();
      } else if (action === 'trash-restore') {
        doRestoreTrash(btn.dataset.id);
      } else if (action === 'trash-restore-all') {
        doRestoreAllTrash();
      } else if (action === 'trash-discard') {
        if (trashRestoreInProgress) {
          toast('回收站恢复中，请稍候', 'warn');
          return;
        }
        confirmDialog({
          title: '永久删除该记录？',
          message: '书签本身早已删除，此操作仅清空回收站记录，<b>不可撤销</b>。',
          confirmText: '直接删除'
        }).then(ok => {
          if (!ok) return;
          BM.discardTrashItem(btn.dataset.id)
            .then(() => {
              toast('已永久删除 ✓', 'ok');
              refresh();
            })
            .catch(e => toast('永久删除失败：' + (e.message || e), 'danger'));
        });
      } else if (action === 'edit-item') {
        const it = getItemById(btn.dataset.id);
        if (it) openAddDrawer(it);
      } else if (action === 'org-view') {
        ORG_VIEW = btn.dataset.view === 'folders' ? 'folders' : 'tags';
        try { sessionStorage.setItem('bm-org-view', ORG_VIEW); } catch (e) { /* ignore */ }
        render('organize');
      } else if (action === 'open-tree') {
        openFolderTree();
      } else if (action === 'folder-sort') {
        const order = ['manual', 'name', 'added'];
        FOLDER_SORT = order[(order.indexOf(FOLDER_SORT) + 1) % order.length];
        try { sessionStorage.setItem('bm-folder-sort', FOLDER_SORT); } catch (e) { /* ignore */ }
        render('organize');
      } else if (action === 'crumb-expand') {
        crumbExpanded = true;
        render('organize');
      } else if (action === 'folder-up') {
        folderUp();
      } else if (action === 'folder-goto') {
        enterFolder(btn.dataset.id);
      } else if (action === 'new-folder') {
        createFolder(btn.dataset.id);
      } else if (action === 'folder-menu') {
        openFolderMenu(btn, btn.dataset.id);
      } else if (action === 'folder-rename') {
        renameFolder(btn.dataset.id);
      } else if (action === 'folder-delete') {
        deleteFolder(btn.dataset.id);
      }
      return;
    }
    // 点击书签行打开链接（排除复选框/勾选区/标签/按钮/链接等控件）
    const row = e.target.closest('.row.clickable');
    if (
      row &&
      !e.target.closest('.checkbox-slot') &&
      !e.target.closest('input') &&
      !e.target.closest('select') &&
      !e.target.closest('button') &&
      !e.target.closest('a')
    ) {
      if (row.dataset.type === 'folder') {
        enterFolder(row.dataset.id);
        return;
      }
      const it = getItemById(row.dataset.id);
      if (it && it.url) {
        openBookmarkUrl(it.url, !(e.ctrlKey || e.metaKey));
        return;
      }
    }
    // 折叠/展开（点击 input/select 时不触发折叠；状态写入 sessionStorage 记忆）
    const head = e.target.closest('.group-head');
    if (
      head &&
      !e.target.closest('button') &&
      !e.target.closest('input') &&
      !e.target.closest('select')
    ) {
      const body = head.parentElement.querySelector('.group-body');
      if (body) {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        head.setAttribute('aria-expanded', body.style.display !== 'none' ? 'true' : 'false');
        try {
          sessionStorage.setItem(
            'bm-fold-' + head.parentElement.dataset.group,
            body.style.display === 'none' ? '1' : '0'
          );
        } catch (err) {
          /* ignore */
        }
      }
    }
  });

  // 复选框 / 下拉变化（含方案控件）
  content().addEventListener('change', e => {
    if (e.target.id === 'planPrefix') {
      PLAN.prefix = e.target.value;
      return;
    }
    if (e.target.classList.contains('plan-inc')) {
      const p = findPlanItem(e.target.dataset.id);
      if (p) {
        p.included = e.target.checked;
        updatePlanSummary();
      }
      return;
    }
    if (e.target.classList.contains('plan-grp')) {
      const g = PLAN.groups[+e.target.dataset.idx];
      if (g) {
        g.items.forEach(i => {
          i.included = e.target.checked;
        });
        // 局部同步整组行的勾选状态，避免整页重渲染跳动
        const wrap = e.target.closest('.group');
        if (wrap)
          wrap.querySelectorAll('.plan-inc').forEach(c => {
            c.checked = e.target.checked;
          });
        updatePlanSummary();
      }
      return;
    }
    if (e.target.classList.contains('plan-target')) {
      const p = findPlanItem(e.target.dataset.id);
      if (p) {
        p.targetCat = e.target.value;
        p.included = !!(p.targetCat && p.targetCat !== '未分类');
        updatePlanSummary();
      }
      return;
    }
    if (e.target.classList.contains('sel')) updateBulk();
  });

  // 批量删除 / 全选 / 反选
  $('#bulkMove')?.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (!ids.length) { toast('没有选中的项', 'warn'); return; }
    openMoveToPicker(ids);
  });
  $('#bulkDelete')?.addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#content .sel:checked')].map(c => c.dataset.id);
    if (!ids.length) return;
    const isMass = ids.length >= 50; // 危险操作二次确认
    confirmDialog({
      title: '删除选中的 ' + ids.length + ' 项？',
      message:
        (isMass
          ? `<div class="confirm-warn">⚠️ 你选择了 <b>${ids.length}</b> 项，属于大范围操作，请再次确认无误。</div>`
          : '') + '删除后 30 天内可在「回收站」恢复，恢复时优先放回原位置。',
      confirmText: isMass ? '移入回收站 ' + ids.length + ' 项' : '移入回收站'
    }).then(ok => {
      if (!ok) return;
      softDelete(ids, '删除中').then(r => {
        if (r.n)
          toast('已删除 ' + r.n + ' 项', 'ok', {
            label: '撤销',
            onClick: () => undoDelete(r.items)
          });
        scheduleRefresh();
      });
    });
  });
  $('#bulkAll')?.addEventListener('click', () => {
    document.querySelectorAll('#content .sel').forEach(c => {
      c.checked = true;
    });
    updateBulk();
  });
  $('#bulkInvert')?.addEventListener('click', () => {
    document.querySelectorAll('#content .sel').forEach(c => {
      c.checked = !c.checked;
    });
    updateBulk();
  });
  $('#bulkClear')?.addEventListener('click', () => {
    document.querySelectorAll('#content .sel:checked').forEach(c => {
      c.checked = false;
    });
    updateBulk();
  });
  // 批量打标签
  $('#bulkTag')?.addEventListener('click', bulkTagSelected);
  // 标签管理弹层
  $('#tagMgrClose')?.addEventListener('click', closeTagManager);
  // 点击遮罩关闭弹层（与确认 / 输入弹层一致）
  $('#tagMgrWrap')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTagManager();
  });
  $('#tagMgrList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-mgr]');
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (btn.dataset.mgr === 'rename') renameTag(tag);
    else if (btn.dataset.mgr === 'remove') removeTagFromPool(tag);
  });

  // 底部按钮
  $('#rescanBtn')?.addEventListener('click', () => refresh(true));

  // ---------- 键盘快捷键：/ 搜索、? 帮助、Esc 关抽屉/退方案、Ctrl+K 搜索、j/k 导航 ----------
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing =
      tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      // 有弹层 / 抽屉打开时，Esc 完全交给 js/ui.js 的陷阱处理；
      // 否则会在关闭弹层的同时连带触发「退出文件夹」等页面级动作
      if (window.UI && typeof UI.hasOpenTrap === 'function' && UI.hasOpenTrap()) return;
      const treeOv = $('#treeOverlay');
      if (treeOv && !treeOv.classList.contains('hidden')) {
        closeTreeOverlay();
        return;
      }
      if ($('#folderMenuPop')) {
        closeFolderMenu();
        return;
      }
      if (!$('#drawerOverlay').classList.contains('hidden')) {
        closeDrawers();
        return;
      }
      if (planMode) {
        planMode = false;
        PLAN = null;
        render(currentTab);
        return;
      }
      if (currentTab === 'organize' && ORG_VIEW === 'folders' && !typing && FOLDER_NAV.folderId) {
        const cur = currentFolder();
        if (cur && cur.parentId && DATA.folderTree && DATA.folderTree.folderById.has(cur.parentId)) {
          folderUp();
          return;
        }
      }
      return;
    }
    // 弹层 / 抽屉打开时页面级快捷键一律让位，键盘完全归弹层陷阱管理
    if (window.UI && typeof UI.hasOpenTrap === 'function' && UI.hasOpenTrap()) return;
    if (typing) return;
    // 组织页快捷键：N 新建文件夹 / F2 重命名 / Delete 删除
    if (currentTab === 'organize') {
      if (ORG_VIEW === 'folders' && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        createFolder(FOLDER_NAV.folderId);
        return;
      }
      if (e.key === 'F2' && kbRow && kbRow.dataset.type === 'folder') {
        e.preventDefault();
        renameFolder(kbRow.dataset.id);
        return;
      }
      if (e.key === 'Delete' && kbRow && kbRow.dataset.id) {
        e.preventDefault();
        if (kbRow.dataset.type === 'folder') deleteFolder(kbRow.dataset.id);
        else softDeleteBookmark(kbRow.dataset.id);
        return;
      }
    }
    if (e.key === '/' || e.code === 'Slash') {
      if (e.target === searchInput) return; // 已在搜索框内输入斜杠
      e.preventDefault();
      searchInput.focus();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      searchInput.focus();
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      openHelp();
      return;
    }
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      kbMove(1);
      return;
    }
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      kbMove(-1);
      return;
    }
    if (e.key === 'Enter' && kbRow && tag !== 'button') {
      // Enter：打开高亮书签；Shift+Enter：后台打开（不切换当前标签页）
      kbOpen(kbRow, e.shiftKey);
    }
  });

  // ---------- 内容区键盘操作：行打开 / 分组折叠 / 移动书签 ----------
  // 右键菜单：folder-row / 书签行
  content().addEventListener('contextmenu', e => {
    const fRow = e.target.closest('.folder-row');
    if (fRow && fRow.dataset.id) {
      e.preventDefault();
      const btn = fRow.querySelector('.f-menu');
      if (btn) openFolderMenu(btn, fRow.dataset.id);
      return;
    }
    const bRow = e.target.closest('.row.clickable[data-id]:not(.folder-row)');
    if (bRow && bRow.dataset.id) {
      e.preventDefault();
      openBookmarkMenu(bRow, bRow.dataset.id);
    }
  });
  // 就地编辑 input 失焦保存
  content().addEventListener('focusout', e => {
    if (e.target.id === 'fEditInput' && editingFolder) {
      submitFolderEdit(e.target.dataset.editMode, e.target.dataset.editId, e.target.value);
    }
  });

  content().addEventListener('keydown', e => {
    // 就地编辑 input：Enter 保存、Esc 取消，屏蔽其他快捷键
    const editInput = e.target.closest ? e.target.closest('#fEditInput') : null;
    if (editInput) {
      if (e.key === 'Enter') { e.preventDefault(); submitFolderEdit(editInput.dataset.editMode, editInput.dataset.editId, editInput.value); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelFolderEdit(); return; }
      return;
    }
    // 概览快捷入口卡片：Enter / 空格 激活（等价点击，走同一 data-jump 分支）
    const entryCard = e.target.closest ? e.target.closest('.entry-card[data-jump]') : null;
    if (entryCard && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      entryCard.click();
      return;
    }
    const row = e.target.closest ? e.target.closest('.row.clickable') : null;
    if (row && e.key === 'Enter') {
      e.preventDefault();
      if (row.dataset.type === 'folder') {
        enterFolder(row.dataset.id);
        return;
      }
      const it = getItemById(row.dataset.id);
      // Enter 前台打开；Shift+Enter 后台打开
      if (it && it.url) openBookmarkUrl(it.url, !e.shiftKey);
      return;
    }
    const head = e.target.closest ? e.target.closest('.group-head') : null;
    if (head && (e.key === 'Enter' || e.key === ' ')) {
      if (e.target === head || e.target.classList.contains('g-title')) {
        e.preventDefault();
        const body = head.parentElement.querySelector('.group-body');
        if (body) {
          body.style.display = body.style.display === 'none' ? '' : 'none';
          head.setAttribute('aria-expanded', body.style.display !== 'none' ? 'true' : 'false');
          try {
            sessionStorage.setItem(
              'bm-fold-' + head.parentElement.dataset.group,
              body.style.display === 'none' ? '1' : '0'
            );
          } catch (err) {
            /* ignore */
          }
        }
      }
      return;
    }
    if (!kbRow) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
      e.preventDefault();
      kbMoveBookmark(1);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
      e.preventDefault();
      kbMoveBookmark(-1);
    }
  });

  // ---------- 抽屉焦点陷阱改由 js/ui.js 的 focusTrap 接管（见 openHelp / openAddDrawer） ----------
  if (window.UI) UI.initTooltip();
  // 版本号：直接读 manifest，保证与实际安装版本一致（与 newtab / options 统一 v1.0.1 格式）
  try {
    const versionEl = $('#popupVersion');
    if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (e) {
    /* noop */
  }
  registerShortcuts();

  // ---------- 拖拽排序 / 跨组移动 ----------
  bindDrag();

  // 点击遮罩关闭抽屉
  $('#drawerOverlay')?.addEventListener('click', closeDrawers);

  // 设置按钮 → 直接打开独立设置页（含 AI 分类 / 标签体系 / 浏览器集成 三大组）
  $('#settingsBtn')?.addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch (e) {
      console.warn('[书签管家] 无法打开设置页', e);
    }
  });

  // 操作指南抽屉
  $('#helpBtn')?.addEventListener('click', openHelp);
  $('#helpClose')?.addEventListener('click', closeDrawers);

  // 新增书签抽屉
  $('#addBtn')?.addEventListener('click', openAddDrawerForCurrentTab);
  $('#addClose')?.addEventListener('click', closeDrawers);
  $('#addSave')?.addEventListener('click', saveAdd);
  $('#addAiTag')?.addEventListener('click', aiTagSuggest);
  $('#addTags')?.addEventListener('input', renderTagSuggest);
  $('#addUrl')?.addEventListener('input', () => {
    clearTimeout(addUrlTimer);
    addUrlTimer = setTimeout(suggestCat, 250);
  });
  $('#addTitle')?.addEventListener('input', () => {
    clearTimeout(addUrlTimer);
    addUrlTimer = setTimeout(suggestCat, 250);
  });

  // 后台为浏览器原生收藏写入标签时，仅刷新当前视图，不打开新增抽屉。
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      // options 页等处修改 LLM 配置时，实时同步到本页（防止用旧内存配置）
      if (area === 'local' && changes.bmSettings) {
        const v = changes.bmSettings.newValue;
        if (v && typeof v === 'object') {
          SETTINGS = Object.assign({ provider: 'deepseek', baseUrl: '', apiKey: '', model: '' }, v);
          const p = PROVIDERS[SETTINGS.provider];
          if (p && !SETTINGS.baseUrl) SETTINGS.baseUrl = p.base;
        }
      }
      if (area === 'local' && changes.bmFixedTags) {
        try {
          BM.invalidateFixedTags();
        } catch (e) {
          /* noop */
        }
        try {
          if (BM.loadFixedTags)
            BM.loadFixedTags()
              .then(() => {
                const manager = $('#tagMgrWrap');
                if (manager && !manager.classList.contains('hidden')) openTagManager();
              })
              .catch(() => {});
        } catch (e) {
          /* noop */
        }
      }
      if (area === 'local' && changes.bmTagRules) {
        try {
          BM.invalidateTagRules();
        } catch (e) {
          /* noop */
        }
        try {
          if (BM.loadTagRules) BM.loadTagRules().catch(() => {});
        } catch (e) {
          /* noop */
        }
      }
      if (area === 'local' && changes.bmTags) {
        try {
          BM.invalidateTags();
        } catch (e) {
          /* noop */
        }
        // 与本页操作收尾的刷新共用合并窗口：同一次删除不再连跑两轮全量扫描
        scheduleRefresh();
      }
      // 后台水合把远端隐藏状态写入 bmHiddenIds 时，刷新当前视图并失效缓存，
      // 否则已打开的侧边栏会一直把已同步隐藏的书签当作可见。
      if (area === 'local' && changes.bmHiddenIds) {
        try {
          BM.invalidateHiddenIds();
        } catch (e) {
          /* noop */
        }
        scheduleRefresh();
      }
    });
  } catch (e) {
    /* 存储事件不可用时忽略 */
  }

  await Promise.all([settingsReady, refresh(true)]);

  // 标签原生同步在首屏之后继续；它不能阻塞本地书签的可用视图。
  try {
    BM.watchTagConfiguration(() => {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      refresh(true);
    });
    void tagConfigurationReady
      .then(async initialChanged => {
        if (tagConfigurationSyncFailed) return;
        // 首次水合可能在 storage 监听注册前完成，需主动重渲染以应用已落盘的云端标签。
        if (initialChanged) {
          BM.invalidateTags();
          await refresh(true);
        }
        const changed = await BM.pullTagsFromCloud();
        if (changed) {
          BM.invalidateTags();
          await refresh(true);
        }
      })
      .catch(() => {});
  } catch (e) {
    /* 无 sync 权限等忽略 */
  }
}

// ---------- 设置：读取（设置 UI 已迁移至独立 options.html 选项页）----------
async function loadSettings() {
  try {
    const [r] = await Promise.all([
      chrome.storage.local.get('bmSettings'),
      BM.loadTagRules ? BM.loadTagRules() : Promise.resolve()
    ]);
    if (r.bmSettings) {
      SETTINGS = Object.assign(
        { provider: 'deepseek', baseUrl: '', apiKey: '', model: '' },
        r.bmSettings
      );
      const p = PROVIDERS[SETTINGS.provider];
      if (p && !SETTINGS.baseUrl) SETTINGS.baseUrl = p.base;
    }
  } catch (e) {
    console.warn('[书签管家] 读取设置失败', e);
  }
}

// 操作指南抽屉
function openHelp() {
  closeDrawers();
  lastFocus = document.activeElement;
  // 快捷键表由 js/ui.js 的注册表生成，避免文档与实现漂移
  if (window.UI && window.UI.shortcutHtml) $('#helpShortcuts').innerHTML = UI.shortcutHtml();
  $('#drawerOverlay').classList.remove('hidden');
  $('#helpDrawer').classList.remove('hidden');
  if (window.UI && typeof UI.focusTrap === 'function')
    UI.focusTrap($('#helpDrawer'), {
      onEscape: () => closeDrawers(),
      initialFocus: $('#helpClose'),
      restoreFocusTo: lastFocus
    });
  const closeBtn = $('#helpClose');
  if (closeBtn) closeBtn.focus();
}

// 抽屉打开前的焦点（关闭后恢复）
let lastFocus = null;

function closeDrawers() {
  $('#drawerOverlay').classList.add('hidden');
  const addDrawer = $('#addDrawer');
  const helpDrawer = $('#helpDrawer');
  if (addDrawer) addDrawer.classList.add('hidden');
  if (helpDrawer) helpDrawer.classList.add('hidden');
  // 释放抽屉焦点陷阱（restore:false：焦点归还由下方 lastFocus 统一处理）
  if (window.UI && typeof UI.releaseTrap === 'function') {
    UI.releaseTrap(addDrawer, { restore: false });
    UI.releaseTrap(helpDrawer, { restore: false });
    if (typeof UI.hideTip === 'function') UI.hideTip();
  }
  // 恢复打开前的焦点（键盘可达性）
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

// ---------- 新增书签抽屉：智能分类推荐 ----------
let addUrlTimer = null;

function setAddMsg(text, cls) {
  const el = $('#addMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

// 打开新增 / 编辑抽屉（传 item 且含 id 才是编辑模式；仅 url/title 视为新增预填）
function openAddDrawer(item) {
  closeDrawers();
  lastFocus = document.activeElement;
  const isEdit = !!(item && item.id);
  EDITING = isEdit ? item : null;
  const tagsInput = $('#addTags');
  if (isEdit) {
    $('#addDrawerTitle').innerHTML = `${ICON_SM('edit')} 编辑书签`;
    $('#addUrl').value = item.url || '';
    $('#addTitle').value = item.title || '';
    tagsInput.value = (item.tags || []).join(', ');
    $('#addSave').textContent = '保存修改';
    setAddMsg('修改保存后立即生效', '');
  } else {
    $('#addDrawerTitle').innerHTML = `${ICON_SM('plus')} 新增书签`;
    $('#addUrl').value = (item && item.url) || '';
    $('#addTitle').value = (item && item.title) || '';
    tagsInput.value = '';
    $('#addSave').textContent = '保存书签';
    setAddMsg(item && item.url ? '' : '');
  }
  // 新增模式（无 id）且有 url：自动套用建议标签，用户可修改
  if (!isEdit && item && item.url) {
    const url = String(item.url || '').trim();
    const title = String(item.title || '').trim();
    if (url) {
      let host = '';
      try {
        host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname;
      } catch (e) {
        /* keep empty */
      }
      const sugg = BM.suggestTags ? BM.suggestTags({ host, url, title }) : [];
      if (sugg.length) {
        tagsInput.value = sugg.join(', ');
        setAddMsg('已自动建议标签：' + sugg.join('、') + '（可直接保存或修改）', '');
      }
    }
  }
  renderTagSuggest();
  $('#drawerOverlay').classList.remove('hidden');
  $('#addDrawer').classList.remove('hidden');
  if (window.UI && typeof UI.focusTrap === 'function')
    UI.focusTrap($('#addDrawer'), {
      onEscape: () => closeDrawers(),
      initialFocus: $('#addUrl'),
      restoreFocusTo: lastFocus
    });
  $('#addUrl').focus();
}

// 打开"新增当前页"抽屉：填充当前标签页 URL/标题 + 已存在检测
async function openAddDrawerForCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      toast('没有找到当前标签页，请在表单里手动填写', 'warn');
      openAddDrawer();
      return;
    }
    // 没有 tabs 权限时 chrome.tabs 不会返回 url/title（例如侧边栏不是通过点击扩展图标
    // 打开、activeTab 未授予）。这与"当前页确实不是网页"是两回事，提示要分开。
    const url = typeof tab.url === 'string' ? tab.url : '';
    if (!url) {
      toast('未能读取当前页地址，请在表单里粘贴网址', 'warn');
      openAddDrawer();
      return;
    }
    if (!/^https?:/i.test(url)) {
      toast('当前页不是普通网页（比如浏览器设置页），无法收藏', 'warn');
      openAddDrawer(); // 空表单兜底
      return;
    }
    const existing = findExistingByUrl(url);
    if (existing.length) {
      const top = existing[0];
      // 三按钮：编辑已有 / 仍要新增 / 取消（取消时什么都不做）
      const result = await confirmDialog({
        title: '该书签已存在',
        message: `当前页面已是已保存的书签：<br><b>${escapeHtml(top.title || '(无标题)')}</b><br><span style="color:var(--muted);font-size:var(--fs-meta);">${escapeHtml(top.url)}</span><br><br>「编辑已有」打开这个书签；「仍要新增」创建副本；「取消」什么也不做。`,
        confirmText: '仍要新增',
        cancelText: '取消',
        thirdText: '编辑已有',
        danger: false
      });
      if (result === 'third') {
        openAddDrawer(top); // 编辑模式（含标签）
      } else if (result === true) {
        // 仍要新增 → 新增抽屉预填（会触发精确重复提示）
        openAddDrawer({ url, title: tab.title || '' });
        setAddMsg('该 URL 已存在，将创建副本', 'warn');
      }
      // result === false（取消）→ 什么都不做
    } else {
      openAddDrawer({ url, title: tab.title || '' });
      setAddMsg('正在保存当前页面', '');
    }
  } catch (e) {
    console.warn('[书签管家] 打开新增抽屉失败', e);
    openAddDrawer();
  }
}

// 渲染「建议标签」chips：基于本地规则（分类/域名组/注册域名）+ 已有的标签输入
function renderTagSuggest() {
  const box = $('#tagSuggest');
  if (!box) return;
  const url = $('#addUrl').value.trim();
  const title = $('#addTitle').value.trim();
  const cur = ($('#addTags').value || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  const sugg = [];
  if (url) {
    let host = '';
    try {
      host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname;
    } catch (e) {
      /* keep empty */
    }
    sugg.push(...(BM.suggestTags ? BM.suggestTags({ host, url, title }) : []));
  }
  // 已输入的标签去重展示
  const all = [...new Set([...cur, ...sugg])].slice(0, 10);
  if (!all.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML =
    all
      .map(
        t =>
          `<button type="button" class="tag-chip" data-action="pick-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
      )
      .join('') + (sugg.length ? `<span class="tag-suggest-tip">（建议）</span>` : '');
}

// URL/标题变化时刷新建议标签 + 精确重复提示
function suggestCat() {
  renderTagSuggest();
  const url = $('#addUrl').value.trim();
  const hint = $('#addDupHint');
  if (!hint) return;
  if (!url) {
    hint.style.display = 'none';
    return;
  }
  const duplicates = findExistingByUrl(url, EDITING && EDITING.id);
  if (duplicates.length) {
    const links = duplicates.slice(0, 3).map(it => {
      let href = '';
      try {
        href = ` href="${escapeHtml(BM.normalizeHttpUrl(it.url).href)}" target="_blank" rel="noopener"`;
      } catch (e) {
        /* unsupported URL */
      }
      return `<a${href} style="color:inherit;text-decoration:underline;">${escapeHtml(it.title)}</a>`;
    });
    hint.style.display = 'block';
    hint.innerHTML =
      '⚠️ 已有 <b>' +
      duplicates.length +
      '</b> 个相同网址书签：' +
      links.join('、') +
      (duplicates.length > 3 ? '…' : '');
  } else {
    hint.style.display = 'none';
  }
}

// AI 打标：为当前新增/编辑的书签生成 1-3 个标签
async function aiTagSuggest() {
  const url = $('#addUrl').value.trim();
  const title = $('#addTitle').value.trim();
  if (!url) {
    setAddMsg('请先填写网址', 'err');
    return;
  }
  const btn = $('#addAiTag');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '准备中…';
  try {
    await settingsReady;
    if (!SETTINGS.apiKey || !SETTINGS.baseUrl || !SETTINGS.model) {
      setAddMsg('还没有配置 AI 服务，先到设置页填好接口地址、API Key 和模型名', 'err');
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    if (!(await BM.hasLlmHostPermission(SETTINGS.baseUrl))) {
      setAddMsg('需要授权访问 AI 服务域名：到设置页点一次「保存配置」并在弹窗中允许', 'err');
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    const safeUrl = BM.normalizeHttpUrl(url).href;
    const meta = BM.getBookmarkMetadata(safeUrl, title || safeUrl);
    if (meta.sensitive.some(item => item.sev === 'high')) {
      setAddMsg('这个书签涉及隐私（登录 / 金融等），已阻止发送给 AI，请手动填写标签', 'warn');
      return;
    }
    btn.textContent = '打标中…';
    const map = await BM.aiTag([{ id: 'new', title: title || safeUrl, url: safeUrl }], SETTINGS);
    const tags = map['new'] || [];
    if (tags.length) {
      $('#addTags').value = tags.join(', ');
      renderTagSuggest();
      setAddMsg('已生成标签：' + tags.join('、'), 'ok');
    } else {
      setAddMsg('AI 未生成标签，请手动输入', 'warn');
    }
  } catch (e) {
    setAddMsg('AI 打标失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 打标';
  }
}

async function saveAdd() {
  const raw = $('#addUrl').value.trim();
  if (!raw) {
    setAddMsg('请填写网址', 'err');
    return;
  }
  let u;
  try {
    u = BM.normalizeHttpUrl(raw);
  } catch (e) {
    setAddMsg(e.message || '网址格式不正确', 'err');
    return;
  }
  const title = $('#addTitle').value.trim() || u.hostname;
  // 标签：逗号分隔解析（可多个）
  const tags = ($('#addTags').value || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  const btn = $('#addSave');
  let selfCreationReserved = false;
  let selfCreationConfirmed = false;
  let selfCreationParentId = '';
  let created = null;
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    // ---- 编辑模式：改标题 / URL / 标签 ----
    if (EDITING) {
      // 前置校验：书签可能已被外部删除/清理（移动设备同步、其他插件、⭐ 删除等）
      try {
        const cur = await chrome.bookmarks.get(EDITING.id);
        if (!cur || !cur.length) {
          setAddMsg('该书签已不存在（可能已被外部删除），请刷新', 'err');
          EDITING = null;
          refresh();
          return;
        }
      } catch (e) {
        setAddMsg('书签校验失败：' + (e.message || e) + '（请刷新重试）', 'err');
        EDITING = null;
        refresh();
        return;
      }
      const previousUrl = EDITING.url;
      await chrome.bookmarks.update(EDITING.id, { title, url: u.href });
      if (previousUrl !== u.href) await BM.migrateTagSyncUrl(EDITING.id, previousUrl, u.href);
      if (!(await BM.setTags(EDITING.id, tags))) throw new Error('标签保存失败，请重试');
      if (!(await unifySameUrlTags({ id: EDITING.id, url: u.href }, tags)))
        throw new Error('同址标签同步失败，请重试');
      toast('已保存修改 ✓' + (tags.length ? '（标签 ' + tags.length + ' 个）' : ''), 'ok');
      EDITING = null;
      closeDrawers();
      refresh();
      return;
    }
    // ---- 新增模式：书签栏 + 标签 ----
    // 精确 URL 校验：仅在完整 URL 完全相同时二次确认。
    const duplicates = findExistingByUrl(u.href);
    if (duplicates.length) {
      btn.disabled = false;
      btn.textContent = '保存书签';
      const ok = await confirmDialog({
        title: '已有相同网址的书签？',
        message:
          `「${escapeHtml(u.href)}」与现有 <b>${duplicates.length}</b> 个书签网址相同：<br>` +
          duplicates
            .slice(0, 5)
            .map(
              it =>
                `· ${escapeHtml(it.title)}<span style="color:var(--muted)"> — ${escapeHtml(it.url)}</span>`
            )
            .join('<br>') +
          (duplicates.length > 5 ? `<br>… 等 ${duplicates.length} 个` : '') +
          `<br><br>可编辑已有书签的标签，或保留一个副本。`,
        confirmText: '保留副本',
        thirdText: '编辑已有',
        danger: false
      });
      if (ok === 'third') {
        openAddDrawer(duplicates[0]);
        return;
      }
      if (!ok) {
        setAddMsg('已取消：该书签与现有书签网址相同', 'warn');
        return;
      }
      btn.disabled = true;
      btn.textContent = '保存中…';
    }
    const tree = await chrome.bookmarks.getTree();
    const bar = tree[0].children && tree[0].children[0];
    if (!bar) {
      setAddMsg('没有找到书签栏，无法保存书签（请检查浏览器的书签功能）', 'err');
      return;
    }
    // 标签兜底：用户没填 → 自动套用本地规则建议（可保存后编辑修改）
    let finalTags = tags;
    if (!finalTags.length) {
      let host = '';
      try {
        host = u.hostname;
      } catch (e) {
        /* keep empty */
      }
      finalTags = (BM.suggestTags ? BM.suggestTags({ host, url: u.href, title }) : []) || [];
    }
    // 先向后台登记精确创建令牌，创建返回 id 后再确认，避免同 URL 的原生收藏被误跳过。
    try {
      selfCreationParentId = bar.id;
      const reserved = await chrome.runtime.sendMessage({
        type: SELF_CREATION_MESSAGE,
        action: 'reserve',
        parentId: bar.id,
        url: u.href
      });
      selfCreationReserved = !!(reserved && reserved.ok);
    } catch (e) {
      /* 后台重启时允许继续保存，随后由默认规则兜底 */
    }
    created = await chrome.bookmarks.create({ parentId: bar.id, title, url: u.href });
    if (selfCreationReserved) {
      try {
        const confirmed = await chrome.runtime.sendMessage({
          type: SELF_CREATION_MESSAGE,
          action: 'confirm',
          parentId: bar.id,
          url: u.href,
          bookmarkId: created.id
        });
        selfCreationConfirmed = !!(confirmed && confirmed.ok);
      } catch (e) {
        /* noop */
      }
    }
    if (finalTags.length && !(await BM.setTags(created.id, finalTags)))
      throw new Error('标签保存失败，请重试');
    // 本地建议没有命中时，交后台按「⭐ 收藏」同一套规则补齐（含可选的自动 AI 打标），
    // 否则新增的书签会一直停在「未打标」。
    let autoTags = [];
    if (!finalTags.length) {
      try {
        const filled = await chrome.runtime.sendMessage({
          type: AUTO_TAG_MESSAGE,
          bookmarkId: created.id
        });
        if (filled && filled.ok && Array.isArray(filled.tags)) autoTags = filled.tags;
      } catch (e) {
        /* 后台不可用时保持未打标，用户仍可在编辑里手动补标签 */
      }
    }
    const shownTags = finalTags.length ? finalTags : autoTags;
    if (!(await unifySameUrlTags({ id: created.id, url: u.href }, shownTags)))
      throw new Error('同址标签同步失败，请重试');
    toast(
      '已新增书签 ✓' +
        (shownTags.length ? '（自动标签：' + shownTags.join('、') + '，可在编辑中修改）' : ''),
      'ok'
    );
    closeDrawers();
    refresh();
  } catch (e) {
    if (selfCreationReserved && !selfCreationConfirmed) {
      try {
        await chrome.runtime.sendMessage({
          type: SELF_CREATION_MESSAGE,
          action: 'cancel',
          parentId: selfCreationParentId,
          url: u.href
        });
      } catch (e2) {
        /* noop */
      }
    }
    if (created) {
      closeDrawers();
      toast('书签已新增，但标签同步失败，请在列表中编辑重试', 'warn');
      refresh();
      return;
    }
    setAddMsg('保存失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = EDITING ? '保存修改' : '保存书签';
  }
}

// ---------- AI 批量打标：force=false 只打未打标；force=true 全量重打（覆盖） ----------
let aiTagRunning = false;
let aiTagCancel = false; // 终止标志：为 true 时停止发起新批次，已成功的结果保留
let aiResumeState = null; // 失败后仅保留尚未成功写入的代表书签，避免从头请求
let aiTagStarting = false; // 权限检查与确认期间也占用启动锁，避免重复点击续打

function claimAiTagStart() {
  if (aiTagRunning || aiTagStarting) return false;
  aiTagStarting = true;
  return true;
}

// 单个书签 AI 打标：复用批量打标引擎，只处理这一条；已有有效标签时默认覆盖重打
async function aiTagSingle(id, force) {
  const it = getItemById(id);
  if (!it) {
    toast('书签不存在，请刷新后重试', 'warn');
    return;
  }
  if (aiTagRunning || aiTagStarting) {
    toast('AI 打标正在进行中，请稍候', 'warn');
    return;
  }
  const hasUsableTag = (it.tags || []).some(t => t && t !== BM.FALLBACK_TAG);
  const f = typeof force === 'boolean' ? force : hasUsableTag;
  await aiTagAll(f, [it]);
}

async function aiTagAll(force, resumeItems) {
  if (!claimAiTagStart()) return;
  try {
    await settingsReady;
    if (aiTagRunning) return;
    aiTagCancel = false;
    const isResume = Array.isArray(resumeItems);
    // 选择目标书签：force=true → 全部；否则与标签页“未打标”计数保持同一口径。
    const targets = isResume ? resumeItems : getAiTagTargets(force);
    if (!targets.length) {
      toast(isResume || force ? '没有待处理书签' : '所有书签都已打标 ✓', 'ok');
      return;
    }
    if (!SETTINGS.apiKey || !SETTINGS.baseUrl || !SETTINGS.model) {
      toast('还没有配置 AI 服务：在设置页填好接口地址、API Key 和模型名即可开始', 'warn');
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    let hasLlmPermission;
    try {
      hasLlmPermission = await BM.hasLlmHostPermission(SETTINGS.baseUrl);
    } catch (e) {
      toast('LLM 配置无效：' + (e.message || e), 'warn');
      try {
        chrome.runtime.openOptionsPage();
      } catch (e2) {
        /* noop */
      }
      return;
    }
    if (!hasLlmPermission) {
      toast('请先在设置中保存配置并授予该 LLM 服务访问权限', 'warn');
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    const protectedTargets = targets.filter(it => {
      const meta = BM.getBookmarkMetadata ? BM.getBookmarkMetadata(it.url, it.title) : it;
      return (meta.sensitive || []).some(item => item.sev === 'high');
    });
    const unsupportedTargets = targets.filter(it => !BM.isHttpUrl(it.url));
    const batch = targets.filter(
      it => !protectedTargets.includes(it) && !unsupportedTargets.includes(it)
    );
    if (!batch.length) {
      toast('这些书签都不适合发给 AI（仅支持普通网页；登录、银行等敏感站点已自动保护）', 'warn');
      return;
    }

    // 同址去重：同一地址（urlKey 相同）只请求一次 AI，结果回填给该地址的全部书签，
    // 避免 LLM 对相同地址给出不同标签（同址不同标）。
    const { representatives, siblingsByKey } = collectAiTagGroups(batch);
    const aiBatch = [...representatives.values()];
    const affectedCount = new Set(
      [...siblingsByKey.values()].flatMap(items => items.map(it => it.id))
    ).size;
    const representativeById = new Map(aiBatch.map(it => [String(it.id), it]));

    const ok =
      isResume ||
      (await confirmDialog({
        title: force
          ? `全量重新打标 ${affectedCount} 个书签？`
          : `AI 批量打标 ${affectedCount} 个书签？`,
        message:
          (force
            ? `⚠️ 将<b>覆盖</b> ${affectedCount} 个书签的现有标签，重新生成 1-3 个标签。`
            : `将为 <b>${affectedCount}</b> 个书签生成 1-3 个标签。`) +
          (protectedTargets.length
            ? `<br>AI 隐私保护已跳过 <b>${protectedTargets.length}</b> 个高风险书签。`
            : '') +
          (unsupportedTargets.length
            ? `<br>已跳过 <b>${unsupportedTargets.length}</b> 个非 HTTP(S) 书签。`
            : '') +
          `<br>· 隐私保护：仅发送标题与 URL 的域名、路径；query 和 fragment 不发送<br>· 可随时点「终止打标」停止：已成功的结果保留，剩余不再请求<br>· 结果实时写入本地，可在「标签」页查看`,
        confirmText: force ? '全量重打' : '开始打标'
      }));
    if (!ok) return;

    aiResumeState = null;
    clearPersistentError();
    aiTagRunning = true;
    const btns = document.querySelectorAll(
      '[data-action="ai-tag-all"], [data-action="ai-tag-all-force"]'
    );
    btns.forEach(b => {
      b.disabled = false;
      b.textContent = '终止打标';
    });
    startProgress(force ? 'AI 全量重打中' : 'AI 打标中', {
      onCancel: () => {
        aiTagCancel = true;
      }
    });
    let applied = 0;
    const completedRepresentatives = new Set();
    try {
      // 每批 AI 成功后立即批量落盘；后续批次失败不影响已保存结果。
      // aiBatch 已是同址去重后的代表书签集；结果按 urlKey 回填到同址全部书签。
      await BM.aiTagBatched(aiBatch, SETTINGS, {
        batchSize: 40,
        retries: 2,
        shouldStop: () => aiTagCancel,
        onBatch: async map => {
          const changes = {};
          const updated = [];
          const completedInBatch = new Set();
          for (const [id, tags] of Object.entries(map)) {
            const rep = representativeById.get(String(id));
            // 仅有“其他”仍视为未打标，保留给失败后的继续打标。
            if (!rep || !Array.isArray(tags) || isAiTagPending({ tags })) continue;
            const siblings = siblingsByKey.get(rep.key || BM.urlKey(rep.url)) || [rep];
            const nextTags = mergeAiTagsWithSameUrl(siblings, tags, force);
            for (const it of siblings) {
              changes[it.id] = nextTags;
              updated.push({ it, tags: nextTags });
            }
            completedInBatch.add(String(id));
          }
          if (!updated.length) return;
          const saved = await BM.setTagsBatch(changes);
          if (!saved) throw new Error('标签保存失败，请重试');
          updated.forEach(({ it, tags }) => {
            it.tags = tags;
          });
          completedInBatch.forEach(id => completedRepresentatives.add(id));
          applied += updated.length;
        },
        onProgress: (ratio, done, total) => {
          updateProgress(
            Math.round(ratio * 100),
            'AI 打标 ' + done + '/' + total + (aiTagCancel ? '（终止中…）' : '')
          );
        }
      });
      endProgress();
      const remainingItems = getPendingAiRepresentatives(aiBatch, completedRepresentatives);
      if (remainingItems.length) {
        const title = aiTagCancel ? 'AI 打标已终止' : 'AI 打标未完成';
        const detail = aiTagCancel
          ? `已保留 ${applied} 个结果，仍有 ${remainingItems.length} 个待处理。`
          : `已保留 ${applied} 个结果；模型未返回 ${remainingItems.length} 个书签的有效标签。`;
        aiResumeState = { force, items: remainingItems };
        showPersistentError(title, detail, {
          label: '继续打标（' + remainingItems.length + '）',
          onClick: () => {
            if (aiTagRunning || aiTagStarting || !aiResumeState) return;
            const state = aiResumeState;
            aiTagAll(state.force, state.items);
          }
        });
        toast(detail, 'warn');
      } else {
        toast((force ? '全量重打完成：已为 ' : 'AI 已为 ') + applied + ' 个书签打标 ✓', 'ok');
        aiResumeState = null;
      }
      refresh();
    } catch (e) {
      endProgress();
      const error = e.message || e;
      const title = applied ? 'AI 打标未完成，已保留 ' + applied + ' 个结果' : 'AI 打标失败';
      const remainingItems = getPendingAiRepresentatives(aiBatch, completedRepresentatives);
      if (remainingItems.length) {
        aiResumeState = { force, items: remainingItems };
        showPersistentError(title, error, {
          label: '继续打标（' + remainingItems.length + '）',
          onClick: () => {
            if (aiTagRunning || aiTagStarting || !aiResumeState) return;
            const state = aiResumeState;
            aiTagAll(state.force, state.items);
          }
        });
      } else {
        aiResumeState = null;
        showPersistentError(title, error);
      }
      if (applied) refresh();
      try {
        BM.logError('ai-tag-all', e);
      } catch (e2) {
        /* ignore */
      }
    } finally {
      aiTagRunning = false;
      aiTagCancel = false;
      const btns = document.querySelectorAll(
        '[data-action="ai-tag-all"], [data-action="ai-tag-all-force"]'
      );
      btns.forEach(b => {
        b.disabled = false;
        b.textContent = b.dataset.action === 'ai-tag-all-force' ? '重新打标全部' : 'AI 批量打标';
      });
    }
  } finally {
    aiTagStarting = false;
  }
}

// ---------- 新增书签校验 ----------
// 按完整 URL 精确查找已存在的书签。
function findExistingByUrl(url, excludeId) {
  if (!DATA || !url) return [];
  const candidates = DATA.itemsByUrl
    ? DATA.itemsByUrl.get(url) || []
    : DATA.items.filter(it => it.url === url);
  return excludeId ? candidates.filter(it => it.id !== excludeId) : candidates;
}

function getSameUrlGroups() {
  if (!DATA) return [];
  if (DATA.itemsByUrlKey) return [...DATA.itemsByUrlKey.values()].filter(items => items.length > 1);
  const byKey = new Map();
  (DATA.items || []).forEach(item => {
    const key = item.key || BM.urlKey(item.url);
    if (!key) return;
    const items = byKey.get(key);
    if (items) items.push(item);
    else byKey.set(key, [item]);
  });
  return [...byKey.values()].filter(items => items.length > 1);
}

function getSameUrlSiblings(bookmark) {
  if (!bookmark || !bookmark.id) return [];
  const key = bookmark.key || BM.urlKey(bookmark.url || '');
  if (!key) return [bookmark];
  const group =
    DATA && DATA.itemsByUrlKey
      ? DATA.itemsByUrlKey.get(key) || []
      : DATA && DATA.items
        ? DATA.items.filter(item => (item.key || BM.urlKey(item.url)) === key)
        : [];
  // 传入的书签可能刚创建或刚改址，不能使用 DATA 中同 id 的旧快照。
  return [...group.filter(item => item.id !== bookmark.id), bookmark];
}

function collectAiTagGroups(batch) {
  const representatives = new Map();
  const siblingsByKey = new Map();
  (batch || []).forEach(item => {
    const key = item.key || BM.urlKey(item.url);
    if (representatives.has(key)) return;
    representatives.set(key, item);
    siblingsByKey.set(key, getSameUrlSiblings(item));
  });
  return { representatives, siblingsByKey };
}

function mergeAiTagsWithSameUrl(siblings, aiTags, force) {
  if (force) return aiTags;
  const tagsById = BM.getTags() || {};
  return BM.unionTagLists([
    ...(siblings || []).map(item => tagsById[item.id] || item.tags || []),
    aiTags
  ]);
}

function getPendingAiRepresentatives(items, completedIds) {
  return (items || []).filter(item => !completedIds.has(String(item.id)));
}

// 同址（urlKey 相同）标签统一：某书签标签变更后，把并集写回同址全部书签，避免同址不同标。
// tags 为空数组表示清除标签，此时同址兄弟一并清除。
async function unifySameUrlTags(bookmarkOrId, tags) {
  if (!bookmarkOrId || !DATA) return false;
  const self =
    typeof bookmarkOrId === 'object'
      ? bookmarkOrId
      : DATA.itemById
        ? DATA.itemById.get(bookmarkOrId)
        : DATA.items.find(it => it.id === bookmarkOrId);
  if (!self) return false;
  const siblings = getSameUrlSiblings(self);
  if (siblings.length <= 1) return true;
  try {
    await BM.loadTags();
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const currentMap = BM.getTags() || {};
  const lists = siblings.map(it => currentMap[it.id] || []);
  // 本次变更的标签优先合并进并集，保证本次操作语义生效。
  let union;
  if (Array.isArray(tags) && tags.length) {
    union = BM.unionTagLists([tags, ...lists]);
  } else if (Array.isArray(tags) && !tags.length) {
    union = [];
  } else {
    union = BM.unionTagLists(lists);
  }
  const changes = {};
  siblings.forEach(it => {
    changes[it.id] = union.length ? union : null;
  });
  try {
    return await BM.setTagsBatch(changes);
  } catch (e) {
    return false;
  }
}

// ---------- 标签管理：新建 / 重命名 / 从池删除 / 批量打标签 ----------

// 新建标签：加入固定池（若已存在或不在池则提示）
async function createTag() {
  const name = await promptDialog({
    title: '新建标签',
    message: '输入新标签名（将加入固定标签池，AI 打标可选用）：',
    placeholder: '如：效率'
  });
  if (!name) return;
  const clean = BM.normalizeTag(name);
  if (!clean) {
    toast('标签名不能为空（去掉首尾空格后至少留 1 个字）', 'warn');
    return;
  }
  try {
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const pool = [...(BM.getFixedTags() || [])];
  if (pool.includes(clean)) {
    toast('#' + clean + ' 已经在标签池里了', 'warn');
    return;
  }
  const max = BM.MAX_FIXED_TAGS || 50;
  if (pool.length >= max) {
    toast('标签池已达上限（' + max + '），请先删除或重命名', 'warn');
    return;
  }
  pool.push(clean);
  try {
    await BM.loadTagRules();
    await BM.saveSyncedTagConfiguration(
      pool.filter(tag => tag !== BM.FALLBACK_TAG),
      BM.getTagRules() || {}
    );
    toast('已新建标签 #' + clean + ' ✓', 'ok');
  } catch (e) {
    toast('新建失败：' + (e.message || e), 'danger');
  }
  refresh();
}

function renameTagInRules(rules, oldName, newName) {
  const oldKey = String(oldName || '')
    .trim()
    .toLowerCase();
  const replaceInMap = map =>
    Object.fromEntries(
      Object.entries(map && typeof map === 'object' && !Array.isArray(map) ? map : {}).map(
        ([key, tags]) => [
          key,
          (Array.isArray(tags) ? tags : []).map(tag =>
            String(tag || '')
              .trim()
              .toLowerCase() === oldKey
              ? newName
              : tag
          )
        ]
      )
    );
  return {
    domain: replaceInMap(rules && rules.domain),
    keyword: replaceInMap(rules && rules.keyword)
  };
}

// 重命名标签：同步改池 + 所有带此标签的书签
async function renameTag(oldName) {
  const newName = await promptDialog({
    title: '重命名标签',
    message: '将把 #' + oldName + ' 重命名为（同步修改所有书签）：',
    value: oldName,
    placeholder: '新标签名'
  });
  if (!newName || newName === oldName) return;
  const clean = BM.normalizeTag(newName);
  if (!clean) {
    toast('新标签名不能为空', 'warn');
    return;
  }
  // 1. 改固定池
  try {
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const pool = [...(BM.getFixedTags() || [])];
  const idx = pool.indexOf(oldName);
  if (idx >= 0) {
    if (pool.includes(clean)) {
      toast('#' + clean + ' 已存在，换一个名字吧', 'warn');
      return;
    }
    pool[idx] = clean;
    try {
      await BM.loadTagRules();
      const rules = renameTagInRules(BM.getTagRules() || {}, oldName, clean);
      await BM.saveSyncedTagConfiguration(
        pool.filter(tag => tag !== BM.FALLBACK_TAG),
        rules
      );
    } catch (e) {
      /* 配置已保留在本地，下次同步重试 */
    }
  }
  // 2. 改所有书签的标签
  try {
    await BM.loadTags();
  } catch (e) {
    /* noop */
  }
  const map = BM.getTags() || {};
  let changed = 0;
  for (const id of Object.keys(map)) {
    const arr = map[id];
    if (arr.includes(oldName)) {
      try {
        await BM.setTags(
          id,
          arr.map(t => (t === oldName ? clean : t))
        );
        changed++;
      } catch (e) {
        /* ignore */
      }
    }
  }
  BM.invalidateFixedTags();
  BM.invalidateTags();
  toast('已重命名 #' + oldName + ' → #' + clean + '（' + changed + ' 个书签）✓', 'ok');
  refresh();
}

// 从固定池删除标签（书签上已有的标签保留，不再出现在标签云/建议/AI 打标）
async function removeTagFromPool(name) {
  if (name === BM.FALLBACK_TAG) {
    toast('「' + name + '」是兜底标签，不能删除', 'warn');
    return;
  }
  const ok = await confirmDialog({
    title: '从固定池移除 #' + name + '？',
    message:
      '仅从标签池移除（不再建议/打标）。已有书签上的 #' +
      name +
      ' 标签会保留，但被视为「散落标签」，可之后收敛。',
    confirmText: '移除',
    danger: false
  });
  if (!ok) return;
  try {
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const pool = [...(BM.getFixedTags() || [])].filter(t => t !== name);
  try {
    await BM.loadTagRules();
    await BM.saveSyncedTagConfiguration(
      pool.filter(tag => tag !== BM.FALLBACK_TAG),
      BM.getTagRules() || {}
    );
  } catch (e) {
    toast('移除失败：' + (e.message || e), 'danger');
    return;
  }
  toast('已从池移除 #' + name, 'ok');
  refresh();
}

// 打开标签管理弹层（列出固定池标签）
function openTagManager() {
  const pool = (BM.getFixedTags() || []).filter(t => t !== BM.FALLBACK_TAG);
  const list = $('#tagMgrList');
  list.innerHTML =
    pool
      .map(t => {
        const count = (DATA.tagStats || {})[t] || 0;
        return `<div class="tag-mgr-row">
      <span class="tag-mgr-name">#${escapeHtml(t)}</span>
      <span class="tag-mgr-count">${count} 个书签</span>
      <div class="tag-mgr-btns">
        <button class="btn small ghost" data-mgr="rename" data-tag="${escapeHtml(t)}">${ICON_SM('edit')} 重命名</button>
        <button class="btn small ghost danger-text" data-mgr="remove" data-tag="${escapeHtml(t)}">${ICON_SM('trash')} 从池移除</button>
      </div>
    </div>`;
      })
      .join('') || '<div class="tag-mgr-empty">固定池为空</div>';
  $('#tagMgrWrap').classList.remove('hidden');
  // 焦点陷阱（Esc 关闭）：先记住触发元素，便于关闭后归还焦点
  tagMgrFocus = document.activeElement;
  if (window.UI && typeof UI.focusTrap === 'function')
    UI.focusTrap($('#tagMgrWrap'), {
      onEscape: () => closeTagManager(),
      initialFocus: $('#tagMgrClose'),
      restoreFocusTo: tagMgrFocus
    });
  const closeBtn = $('#tagMgrClose');
  if (closeBtn) closeBtn.focus();
}

// 标签管理弹层关闭：释放焦点陷阱并归还焦点
let tagMgrFocus = null;
function closeTagManager() {
  const wrap = $('#tagMgrWrap');
  if (wrap) wrap.classList.add('hidden');
  if (window.UI && typeof UI.releaseTrap === 'function') UI.releaseTrap(wrap, { restore: false });
  if (tagMgrFocus && document.contains(tagMgrFocus)) tagMgrFocus.focus();
  tagMgrFocus = null;
}

// 批量打标签：选中书签 → 追加指定标签（去重、限数）
async function bulkTagSelected() {
  const sel = getSelectedIds();
  if (!sel.length) {
    toast('先在列表里勾选要打标签的书签', 'warn');
    return;
  }
  const input = await promptDialog({
    title: '批量打标签',
    message: '为选中的 ' + sel.length + ' 个书签追加标签（逗号分隔，已存在的不会重复）：',
    placeholder: '开发, 工作'
  });
  if (!input) return;
  const newTags = input
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!newTags.length) return;
  try {
    await BM.loadTags();
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  startProgress('批量打标中');
  let done = 0;
  let failed = 0;
  for (const id of sel) {
    try {
      const cur = (BM.getTags() || {})[id] || [];
      const merged = [...new Set([...cur, ...newTags])].slice(0, BM.MAX_TAGS_PER_BOOKMARK || 6);
      if (!(await BM.setTags(id, merged))) throw new Error('标签保存失败');
      if (!(await unifySameUrlTags(id, merged))) throw new Error('同址标签同步失败');
    } catch (e) {
      failed++;
    }
    done++;
    updateProgress(Math.round((done / sel.length) * 100), '打标 ' + done + '/' + sel.length);
  }
  endProgress();
  toast(
    failed
      ? '已为 ' + (sel.length - failed) + ' 个书签追加标签，' + failed + ' 个保存失败'
      : '已为 ' + sel.length + ' 个书签追加标签 ✓',
    failed ? 'warn' : 'ok'
  );
  refresh();
}

// ---------- 标签收敛：把历史散落标签归并到固定池 + #其他 重新打标 ----------
async function migrateTags() {
  try {
    await BM.loadTags();
  } catch (e) {
    /* noop */
  }
  try {
    await BM.loadFixedTags();
  } catch (e) {
    /* noop */
  }
  const map = BM.getTags();
  if (!map || !Object.keys(map).length) {
    toast('还没有任何标签记录，不需要收敛', 'warn');
    return;
  }
  const ids = Object.keys(map);
  const activeIds = ids.filter(id => !!getItemById(id));
  const staleIds = ids.filter(id => !getItemById(id));
  const changeMap = {}; // 旧标签 -> { to, n }
  const affectedIds = new Set();
  const otherIds = []; // 被归到 #其他（兜底）的书签 id
  activeIds.forEach(id => {
    const orig = map[id];
    // #其他 视为"未真正命中池"，单独收集
    if (orig.includes(BM.FALLBACK_TAG)) {
      otherIds.push(id);
      // 但原始标签里如有其它池外词，仍按规则映射
      const others = orig.filter(t => t !== BM.FALLBACK_TAG);
      if (others.length) {
        const mapped = [...new Set(others.map(t => BM.normalizeToPool(t)).filter(Boolean))];
        const same = others.length === mapped.length && others.every((t, i) => t === mapped[i]);
        if (!same) {
          affectedIds.add(id);
          others.forEach(t => {
            const mt = BM.normalizeToPool(t);
            if (mt !== t) (changeMap[t] = changeMap[t] || { to: mt, n: 0 }).n++;
          });
        }
      }
      return;
    }
    const mapped = [...new Set(orig.map(t => BM.normalizeToPool(t)).filter(Boolean))];
    const same = orig.length === mapped.length && orig.every((t, i) => t === mapped[i]);
    if (same) return;
    affectedIds.add(id);
    orig.forEach(t => {
      const mt = BM.normalizeToPool(t);
      if (mt !== t) (changeMap[t] = changeMap[t] || { to: mt, n: 0 }).n++;
    });
  });
  if (!affectedIds.size && !otherIds.length && !staleIds.length) {
    toast('所有标签都已在固定池内 ✓', 'ok');
    return;
  }
  const total = new Set([...affectedIds, ...otherIds]).size;
  const hiddenCount = [...new Set([...affectedIds, ...otherIds])].filter(
    id => getItemById(id) && getItemById(id).hidden
  ).length;
  const changeList = Object.entries(changeMap).sort((a, b) => b[1].n - a[1].n);
  const preview =
    changeList
      .slice(0, 15)
      .map(([from, c]) => `${escapeHtml(from)} → ${escapeHtml(c.to)}（${c.n}）`)
      .join('<br>') + (changeList.length > 15 ? `<br>… 等共 ${changeList.length} 种标签` : '');
  let message = '';
  if (affectedIds.size) {
    message += `<b>${affectedIds.size}</b> 个书签有散落标签，将归并到固定池：<br>${preview}<br>`;
  }
  if (otherIds.length) {
    // 列出 #其他 书签标题预览（最多 5）
    const otherPreview =
      otherIds
        .slice(0, 5)
        .map(id => {
          const item = getItemById(id);
          return `· ${escapeHtml(item ? item.title : '(已删除书签)')}<span style="color:var(--muted);font-size:var(--fs-meta);"> — ${escapeHtml(item ? item.host : '')}</span>`;
        })
        .join('<br>') + (otherIds.length > 5 ? `<br>… 等 ${otherIds.length} 个` : '');
    message += `<br>⚠️ <b>${otherIds.length}</b> 个书签被归到「#${escapeHtml(BM.FALLBACK_TAG)}」（池外兜底），将用本地规则重新打标（消耗 API 即可考虑 AI 重打）：<br>${otherPreview}<br>`;
  }
  if (hiddenCount) message += `<br>其中 <b>${hiddenCount}</b> 个为隐藏书签，也会一并处理。`;
  if (staleIds.length)
    message += `<br>将清理 <b>${staleIds.length}</b> 条已删除书签的历史标签记录。`;
  message += '<br>⚠️ 此操作会更新上述书签的标签数据，可在「标签」页查看结果。';
  const title = total
    ? `收敛 ${total} 个书签的标签${staleIds.length ? `，并清理 ${staleIds.length} 条历史记录` : ''}？`
    : `清理 ${staleIds.length} 条历史标签记录？`;
  const ok = await confirmDialog({
    title,
    message,
    confirmText: '开始收敛'
  });
  if (!ok) return;
  startProgress('收敛标签中');
  let done = 0;
  const otherIdSet = new Set(otherIds);
  const normalizableIds = [...affectedIds].filter(id => !otherIdSet.has(id));
  const operationCount = normalizableIds.length + otherIds.length + staleIds.length;
  const tagChanges = {};
  // 1. 仅收集确实需要归并、且不含 #其他 的书签。
  for (const id of normalizableIds) {
    const orig = map[id];
    const mapped = [...new Set(orig.map(t => BM.normalizeToPool(t)).filter(Boolean))];
    tagChanges[id] = mapped;
    done++;
    updateProgress(
      Math.round((done / operationCount) * 100),
      '收敛 ' + done + '/' + operationCount
    );
  }
  // 2. #其他 书签：用本地规则重新打标（suggestTags，不消耗 API）
  for (const id of otherIds) {
    try {
      const item = getItemById(id);
      const sugg = item
        ? BM.suggestTags
          ? BM.suggestTags({ host: item.host, url: item.url, title: item.title })
          : []
        : [];
      const cleaned = (map[id] || []).filter(t => t !== BM.FALLBACK_TAG);
      const newTags = [...new Set([...cleaned, ...sugg])].filter(Boolean);
      tagChanges[id] = newTags;
    } catch (e) {
      /* noop */
    }
    done++;
    updateProgress(
      Math.round((done / operationCount) * 100),
      '重打 ' + done + '/' + operationCount
    );
  }
  for (const id of staleIds) {
    tagChanges[id] = null;
    done++;
    updateProgress(
      Math.round((done / operationCount) * 100),
      '清理 ' + done + '/' + operationCount
    );
  }
  let saved = false;
  try {
    saved = await BM.setTagsBatch(tagChanges);
  } catch (e) {
    saved = false;
  }
  endProgress();
  if (!saved) {
    toast('标签收敛保存失败，请重试', 'danger');
    return;
  }
  toast(
    `标签已收敛 ✓（处理 ${total} 个书签${staleIds.length ? `，清理 ${staleIds.length} 条历史记录` : ''}）`,
    'ok'
  );
  scheduleRefresh();
}

// ---------- （分类体系已精简删除：AI 分类 / 全量重分类 / 整理方案） ----------

// 初始化链上任何未捕获的失败都要变成可见的提示，而不是让面板一直停在加载态。
function reportFatal(reason) {
  console.error('[书签管家] 面板初始化失败', reason);
  try {
    const box = document.getElementById('content');
    // 只在内容区还没有渲染出结果时铺错误卡，避免把已经能用的列表覆盖掉
    if (box && !box.querySelector('.row, .entry-card, .error-card')) showError(reason);
  } catch (e) {
    /* 兜底提示本身失败时不再抛错 */
  }
}
window.addEventListener('unhandledrejection', event => reportFatal(event.reason));

// 侧边栏文档可能被复用（扩展重载 / bfcache）：DOMContentLoaded 已经过去时必须直接初始化，
// 否则 init 永不执行，面板会永久停在 popup.html 写死的「正在扫描书签…」骨架上。
function bootstrap() {
  Promise.resolve()
    .then(init)
    .catch(reportFatal);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
