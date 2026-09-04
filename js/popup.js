// ===== 书签管家 · 交互逻辑 v2（全面改版） =====
'use strict';

let DATA = null;
let currentTab = 'overview';
let overviewDetail = '';   // clean | trash；由概览待办项进入的工具视图
let SEARCH = '';            // 全局搜索词
let searchTimer = null;
let TAG_FILTER = '';        // 标签筛选：当前选中的标签（'' = 全部）
let tabRenderToken = 0;
let listRenderLimits = Object.create(null);
let refreshInFlight = null;
let refreshQueued = false;
let tagRenderToken = 0;
let trashRestoreInProgress = false;
let activeProgressCancel = null;

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
const INITIAL_TAG_SYNC_WAIT_MS = 1200;

// ---- LLM 设置：服务商预设统一来自 lib.js（DRY，与 options.js 共享同一份配置）----
const PROVIDERS = BM.PROVIDERS;
let SETTINGS = { provider: 'deepseek', baseUrl: '', apiKey: '', model: 'deepseek-chat' };
let settingsReady = Promise.resolve();
let tagConfigurationReady = Promise.resolve();
let tagConfigurationSyncFailed = false;

// 同步目录可能在 Chrome 书签同步中暂时不完整。首屏不能因此永久停在扫描态，
// 任务仍会在后台完成，并由 storage 监听触发后续刷新。
function waitForInitialTagConfiguration() {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, INITIAL_TAG_SYNC_WAIT_MS);
    tagConfigurationReady.then(finish, finish);
  });
}

// ---- SVG 图标助手（配合 popup.html 的 <symbol> sprite，替代 emoji）----
const ICON = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${name}"/></svg>`;
const ICON_SM = name => `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${name}"/></svg>`;

// ---- 统一方案引擎：删除整理操作走「预览 → 确认 → 执行」----
let planMode = false;
let PLAN = null;            // { type:'delete', groups:[...] }
let EDITING = null;         // 编辑模式：正在编辑的书签项（null = 新增模式）

const $ = sel => document.querySelector(sel);
const content = () => $('#content');

function getItemById(id) {
  if (!DATA) return null;
  if (DATA.itemById) return DATA.itemById.get(id) || null;
  return DATA.items.find(item => item.id === id) || null;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 搜索命中高亮：把文本中所有匹配 q 的片段包 <mark>
function highlightHtml(text, q) {
  const s = String(text == null ? '' : text);
  const low = s.toLowerCase();
  const ql = String(q).toLowerCase();
  if (!ql || !low.includes(ql)) return escapeHtml(s);
  let out = '', i = 0;
  while (i < s.length) {
    const j = low.indexOf(ql, i);
    if (j < 0) { out += escapeHtml(s.slice(i)); break; }
    out += escapeHtml(s.slice(i, j)) + '<mark>' + escapeHtml(s.slice(j, j + ql.length)) + '</mark>';
    i = j + ql.length;
  }
  return out;
}

// ---------- 反馈组件：Toast / 进度条 ----------
function toast(msg, type, action) {
  type = type || 'ok';
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const txt = document.createElement('span');
  txt.textContent = msg;
  el.appendChild(txt);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.remove(); action.onClick && action.onClick(); });
    el.appendChild(btn);
  }
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 320);
  }, action ? 10000 : 2600); // 可撤销操作给足 10s 窗口
}

function showPersistentError(title, detail, action) {
  $('#operationNoticeTitle').textContent = title;
  $('#operationNoticeDetail').textContent = detail;
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
  const rules = BM.getTagRules ? (BM.getTagRules() || {}) : {};
  return Object.keys(rules.domain || {}).length + Object.keys(rules.keyword || {}).length;
}

// 同址书签统一处理：标题不同仍可命中不同规则，但最终标签保持一致。
function collectCustomRuleApplications(mode) {
  const tagsById = BM.getTags() || {};
  const groups = new Map();
  ((DATA && DATA.items) || []).forEach(item => {
    const key = item.key || BM.urlKey(item.url || '') || ('bookmark:' + item.id);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  });

  const changes = {};
  let matched = 0;
  groups.forEach(items => {
    const ruleTags = BM.unionTagLists(items.map(item => {
      const result = BM.matchCustomTagRules({ host: item.host, url: item.url, title: item.title });
      return [...(result.domain || []), ...(result.keyword || [])];
    }));
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
      toast('请先在设置中配置至少一条自定义规则', 'warn');
      return;
    }

    const previews = {
      append: collectCustomRuleApplications('append'),
      replace: collectCustomRuleApplications('replace'),
      untagged: collectCustomRuleApplications('untagged')
    };
    const matched = previews.append.matched;
    if (!matched) {
      toast('没有书签命中当前自定义规则', 'warn');
      return;
    }
    if (trigger) trigger.textContent = '选择策略…';
    const choice = await confirmDialog({
      title: '应用自定义规则',
      message: `命中 <b>${matched}</b> 个书签；全程在本地处理，不调用 AI。<br>`
        + `仅未标：${previews.untagged.changed} 项；追加：${previews.append.changed} 项；覆盖：${previews.replace.changed} 项。`,
      confirmText: '追加',
      thirdText: '覆盖',
      fourthText: '仅未标',
      danger: false
    });
    const mode = choice === true ? 'append' : choice === 'third' ? 'replace' : choice === 'fourth' ? 'untagged' : '';
    if (!mode) return;

    const result = collectCustomRuleApplications(mode);
    if (!result.changed) {
      toast('没有需要更新的标签', 'ok');
      return;
    }
    const saved = await BM.setTagsBatch(result.changes);
    if (!saved) throw new Error('标签保存失败');
    const modeLabel = mode === 'append' ? '追加' : mode === 'replace' ? '覆盖' : '补全未标';
    toast(`已按自定义规则${modeLabel} ${result.changed} 个书签`, 'ok');
    refresh();
  } catch (e) {
    toast('应用规则失败：' + (e.message || e), 'danger');
    try { BM.logError('apply-custom-rules', e); } catch (e2) { /* ignore */ }
  } finally {
    if (trigger && document.contains(trigger)) {
      trigger.disabled = false;
      trigger.textContent = originalText;
    }
  }
}

// 自定义确认弹层（替代原生 confirm，视觉统一、可定制文案）
function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const wrap = $('#confirmWrap');
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
    wrap.classList.remove('hidden');
    const done = v => {
      wrap.classList.add('hidden');
      yes.onclick = no.onclick = wrap.onclick = third.onclick = fourth.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const no = $('#confirmNo');
    const onKey = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    if (opts.thirdText) third.onclick = () => done('third');
    if (opts.fourthText) fourth.onclick = () => done('fourth');
    wrap.addEventListener('click', e => { if (e.target === wrap) done(false); });
    document.addEventListener('keydown', onKey);
    yes.focus();
  });
}

// 输入弹层：resolve 输入字符串（取消/为空 → null）
function promptDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const wrap = $('#promptWrap');
    $('#promptTitle').textContent = opts.title || '输入';
    $('#promptMsg').textContent = opts.message || '';
    const input = $('#promptInput');
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '输入内容…';
    wrap.classList.remove('hidden');
    const yes = $('#promptYes');
    const no = $('#promptNo');
    const done = v => {
      wrap.classList.add('hidden');
      yes.onclick = no.onclick = wrap.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') done(input.value.trim() || null);
    };
    yes.onclick = () => done(input.value.trim() || null);
    no.onclick = () => done(null);
    wrap.addEventListener('click', e => { if (e.target === wrap) done(null); });
    document.addEventListener('keydown', onKey);
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
  const concurrency = Math.max(1, Math.min(Math.floor(Number(opts.concurrency) || DELETE_CONCURRENCY), total));
  const shouldClearTags = opts.clearTags !== false;

  const reportProgress = force => {
    if (!label) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < DELETE_PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    updateProgress(Math.round(completed / total * 100), label + ' ' + completed + '/' + total);
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
    await Promise.all(Array.from(
      { length: concurrency },
      () => worker()
    ));

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
    (root && root.children || []).forEach(child => {
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
    (left, right) => (nodesById.get(right).depth - nodesById.get(left).depth)
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
  const items = ids.map(id => {
    const it = getItemById(id);
    return it ? { id: it.id, title: it.title, url: it.url, parentId: it.parentId, path: it.path } : null;
  }).filter(Boolean);
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
    if (result.failed.length) toast('有 ' + result.failed.length + ' 项未能撤销', 'warn');
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
    toast('仅支持打开 http 或 https 网址', 'warn');
  }
}

function itemRow(it, opts) {
  opts = opts || {};
  const q = opts.highlight || '';
  const cat = `<span class="tag cat">${escapeHtml(it.category)}</span>`;
  // 多标签 chips（点切换筛选）：过滤掉 #其他 兜底（数据层保留但 UI 不显示，归并到"收敛"流程）
  const tags = (it.tags || [])
    .filter(t => t !== BM.FALLBACK_TAG)
    .map(t => `<button class="tag-chip" data-action="filter-tag" data-tag="${escapeHtml(t)}" title="按标签筛选">#${escapeHtml(t)}</button>`).join('');
  const deadDot = opts.dead
    ? `<span class="dead-dot ${(it.dead || 'unknown')}" id="dot-${it.id}"></span>` : '';
  const titleHtml = q ? highlightHtml(it.title, q) : escapeHtml(it.title);
  const urlHtml = q ? highlightHtml(it.url, q) : escapeHtml(it.url);
  const hiddenCls = it.hidden ? ' row-hidden' : '';
  const searchCls = opts.search ? ' search-result-row' : '';
  const eyeBtn = `<button class="row-eye" data-action="toggle-hidden" data-id="${it.id}" title="${it.hidden ? '取消隐藏' : '隐藏此书签（从日常视图排除）'}">${it.hidden ? ICON_SM('eye-off') : ICON_SM('eye')}</button>`;
  return `<div class="row clickable draggable${hiddenCls}${searchCls}" draggable="true" data-id="${it.id}">
    <label class="checkbox-slot"><input type="checkbox" class="checkbox sel" data-id="${it.id}" aria-label="选择 ${escapeHtml(it.title)}"></label>
    <div class="meta">
      <div class="title">${deadDot}${it.hidden ? '<span class="tag warn">已隐藏</span> ' : ''}${titleHtml}</div>
      <div class="url">${urlHtml}</div>
      <div class="loc"><span>${ICON_SM('folder')} ${escapeHtml(it.path.join(' / '))}</span> ${cat} ${tags}</div>
    </div>
    ${eyeBtn}
    <button class="row-edit" data-action="edit-item" data-id="${it.id}" title="编辑书签">${ICON_SM('edit')}</button>
  </div>`;
}

function groupWrap(groupKey, icon, name, badgeCls, badgeText, actions, body) {
  return `<div class="group" data-group="${groupKey}">
    <div class="group-head">
      <div class="g-title">
        <span>${icon}</span>
        <span class="g-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="badge ${badgeCls || ''}">${badgeText}</span>
      </div>
      <div class="actions">${actions}</div>
    </div>
    <div class="group-body">${body}</div>
  </div>`;
}

function emptyState(icon, title, desc) {
  return `<div class="empty-state">
    <span class="emoji">${icon}</span>
    <div class="title">${escapeHtml(title)}</div>
    <div class="desc">${escapeHtml(desc || '')}</div>
  </div>`;
}

function helpDot(text) {
  const tip = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
    more: count < items.length
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
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 24);
  const tagCount = entries.length;
  // 清理提醒（有待办项优先）
  const acts = [
    { ico: ICON_SM('repeat'), name: '重复书签', n: d.exactDuplicates.length, jump: 'clean', sub: 'repeat', cls: 'danger', done: '✓ 无重复' },
    { ico: ICON_SM('trash'), name: '空文件夹', n: d.emptyFolders.length, jump: 'clean', sub: 'empty', cls: 'warn', done: '✓ 无空夹' },
    { ico: ICON_SM('archive'), name: '回收站', n: trashN, jump: 'trash', cls: 'info', done: '✓ 回收站为空' }
  ].sort((a, b) => (b.n > 0) - (a.n > 0));

  const actRow = a => {
    const done = a.n === 0;
    return `<div class="act-item ${a.cls}" ${done ? '' : `data-jump="${a.jump}" data-sub="${a.sub}"`}>
      <span class="act-badge ${done ? 'done' : ''}">${done ? ICON('check') : a.n}</span>
      <div class="act-info">
        <div class="act-name">${a.ico} ${a.name}</div>
      </div>
      <span class="act-go">${done ? a.done : '去处理 ' + ICON_SM('arrow-r')}</span>
    </div>`;
  };

  const tagChip = (t, n) => {
    return `<button class="tag-cloud" data-action="filter-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}<span class="cnt">${n}</span></button>`;
  };

  content().innerHTML = `
    <div class="kpi">
      <div class="card big"><b>${d.total}</b><span>书签总数</span></div>
      <div class="card" data-jump="tags"><b>${tagCount}</b><span>标签</span></div>
      <div class="card" data-jump="clean"><b>${d.exactDuplicates.length + d.emptyFolders.length}</b><span>待清理</span></div>
      <div class="card" data-jump="trash"><b>${trashN}</b><span>回收站</span></div>
    </div>
    <div class="search-hero">
      <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-search"/></svg>
      <input id="heroSearch" type="text" placeholder="搜索书签" autocomplete="off" spellcheck="false" />
    </div>
    ${tagCount ? `
    <div class="tag-cloud-card">
      <div class="cloud-head">${ICON_SM('tag')} 热门标签</div>
      <div class="tag-cloud-wrap">${entries.map(([t, n]) => tagChip(t, n)).join('')}</div>
    </div>` : `
    <div class="empty-state"><span class="emoji">${ICON('tag')}</span><div class="title">还没有标签</div></div>`}
    <div class="act-card">
      <div class="act-head">${ICON_SM('sparkles')} 待清理</div>
      ${acts.map(actRow).join('')}
    </div>
    <div class="backup-card">
      <div>
        <div class="b-title">${ICON_SM('download')} 书签备份 / 恢复 ${helpDot('导出全部书签为 JSON 文件；恢复时默认合并完整 URL 相同的书签与标签，也可选择保留副本。单书签最多 6 个标签，已有标签优先保留。')}</div>
      </div>
      <div class="b-actions">
        <button class="btn small ghost" data-action="backup-export">${ICON_SM('download')} 导出备份</button>
        <button class="btn small" data-action="backup-import">${ICON_SM('upload')} 恢复</button>
      </div>
    </div>`;
  // 首页大搜索框联动顶部搜索
  const hero = $('#heroSearch');
  if (hero) hero.addEventListener('input', () => {
    const q = hero.value.trim();
    if (!q) return;
    $('#searchInput').value = q;
    SEARCH = q.toLowerCase();
    $('#searchClear').classList.remove('hidden');
    renderSearch();
  });
  hero && hero.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
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

function renderExact(container) {
  const c = container || content();
  const sameUrlGroups = getSameUrlGroups();
  if (!DATA.exactDuplicates.length) {
    c.innerHTML = emptyState(ICON('repeat'), '重复书签已清理干净', '没有发现 URL 完全相同的书签') + (sameUrlGroups.length ? `
      <div class="section-toolbar" style="margin-top:14px;">
        <span class="sec-title">发现 <b>${sameUrlGroups.length}</b> 组归一化同址书签，可统一历史标签</span>
        <button class="btn small" data-action="unify-exact-tags">🏷 统一同址标签</button>
      </div>` : '');
    return;
  }
  const total = DATA.exactDuplicates.reduce((s, g) => s + g.items.length - 1, 0);
  let html = `
    <div class="section-toolbar">
      <span class="sec-title">共 <b>${DATA.exactDuplicates.length}</b> 组完全相同 · 可一键清理 <b>${total}</b> 个多余项</span>
      <button class="btn small primary" data-action="bulk-exact">${ICON_SM('sparkles')} 一键去重</button>
      <button class="btn small" data-action="unify-exact-tags">🏷 统一同址标签</button>
    </div>`;
  const groups = takeForRender(DATA.exactDuplicates, 'exact-groups', FIRST_GROUP_COUNT, FIRST_GROUP_COUNT);
  groups.items.forEach((g, groupIndex) => {
    const head = g.items[0].domain || g.items[0].host || '链接';
    html += groupWrap('exact-' + groupIndex, ICON('repeat'), head, '', g.items.length + ' 个相同', `
      <button class="btn small" data-action="keepfirst" data-idx="${groupIndex}">保留首个</button>
      <button class="btn small ghost" data-action="selall" data-group="exact-${groupIndex}">全选</button>
    `, renderItemRows(g.items, 'exact-items-' + groupIndex, FIRST_GROUP_ITEM_COUNT, FIRST_GROUP_ITEM_COUNT));
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
  return groupWrap('tag-' + index, ICON('tag'), '#' + tag, 'tag-badge', count + ' 个', `
    <button class="btn small ghost" data-action="filter-tag" data-tag="${escapeHtml(tag)}">只看此标签</button>
  `, renderItemRows(items, 'tag-preview-' + tag, FIRST_TAG_PREVIEW_COUNT, FIRST_TAG_PREVIEW_COUNT));
}

function appendTagGroups(entries, itemsByTag, startIndex, more, token) {
  let index = startIndex;
  const appendNext = () => {
    if (token !== tagRenderToken || currentTab !== 'tags') return;
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

function renderTags() {
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
  const entriesAll = Object.entries(stats).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  const entries = entriesAll.filter(([t]) => poolSet.has(t));
  const looseCount = entriesAll.reduce((s, [t, n]) => s + (poolSet.has(t) ? 0 : n), 0);
  const untaggedCount = getAiTagTargets(false).length;
  const customRuleCount = getCustomRuleCount();
  if (!entries.length && !looseCount) {
    content().innerHTML = emptyState(ICON('tag'), '还没有标签', '给书签打标签后即可按标签快速浏览（一个书签可多个标签）') + `
      <div class="section-toolbar" style="margin-top:14px;">
        <span class="sec-title">${untaggedCount} 个书签未打标 ${helpDot('可在新增或编辑书签时填写标签，或使用 AI 批量打标。')}</span>
        ${hiddenCount ? `<button class="btn small ghost" data-jump="hidden">👁 隐藏（${hiddenCount}）</button>` : ''}
        ${customRuleCount ? `<button class="btn small ghost" data-action="apply-custom-rules">⚡ 应用规则</button>` : ''}
        <button class="btn small primary" data-action="ai-tag-all">🤖 AI 批量打标</button>
      </div>`;
    return;
  }
  const total = totalVisible;
  const pct = total ? (taggedCount === total ? 100 : Math.floor(taggedCount / total * 100)) : 0;
  // 数据摘要卡：3 个数字 + 进度条 + 散落警告
  const looseKinds = entriesAll.length - entries.length;   // 池外标签种类数
  const summaryHtml = `<div class="tag-summary">
    <div class="tag-summary-row">
      <span class="big">${taggedCount}</span><span>/ ${total} 已打标</span><span class="pct">${pct}%</span>
      <span class="sep">|</span><span><b>${entries.length}</b> 个标签</span>${helpDot('标签后的数字表示书签数量。')}
      ${looseKinds ? `<span class="sep">|</span><span><span class="dot" style="background:var(--warn)"></span><b>${looseKinds}</b> 个散落标签</span>` : ''}
      <span style="margin-left:auto; display:flex; gap:6px;">
        <button class="btn small ghost" data-jump="hidden" title="查看隐藏书签">👁 隐藏（${hiddenCount}）</button>
        <button class="btn small primary" data-action="ai-tag-all" ${untaggedCount ? '' : 'disabled'}>🤖 打标未标（${untaggedCount}）</button>
        <button class="btn small ghost" data-action="ai-tag-all-force">🔄 全量重打</button>
      </span>
    </div>
    <div class="tag-summary-bar"><div class="tag-summary-bar-fill" style="width:${pct}%"></div></div>
    ${customRuleCount ? `<div class="tag-summary-tip">
      <span>已配置 <b>${customRuleCount}</b> 条自定义规则，可批量应用到已有书签，不调用 AI。</span>
      <button class="btn small primary" data-action="apply-custom-rules">⚡ 应用规则</button>
    </div>` : ''}
    ${looseCount ? `<div class="tag-summary-tip">
      <span><span class="dot" style="background:var(--warn)"></span><b>${looseCount}</b> 个书签有散落标签（不在固定池内），池外会归到「其他」</span>
      <button class="btn small primary" data-action="migrate-tags">🧹 立即收敛</button>
    </div>` : ''}
    ${(fallbackCount || hiddenFallbackCount) ? `<div class="tag-summary-tip">
      <span><span class="dot" style="background:var(--muted)"></span>${hiddenFallbackCount
        ? `<b>${fallbackCount}</b> 个当前可见书签含「#其他」兜底标签，另有 <b>${hiddenFallbackCount}</b> 个隐藏书签`
        : `<b>${fallbackCount}</b> 个书签含「#其他」兜底标签`}${otherCount ? `；其中 <b>${otherCount}</b> 个仍未打标` : ''}</span>
      <button class="btn small primary" data-action="migrate-tags">🧹 去收敛</button>
    </div>` : ''}
  </div>`;

  // 标签数量直接显示为数字，避免以字号或长度条重复表达同一信息。
  const chip = (t, n) => {
    const active = TAG_FILTER === t ? ' active' : '';
    return `<button class="tag-cloud${active}" data-action="filter-tag" data-tag="${escapeHtml(t)}">
      <span>${t ? '#' + escapeHtml(t) : '全部'}</span><span class="cnt">${n}</span>
    </button>`;
  };

  let html = summaryHtml + `
    <div class="tag-cloud-card">
      <div class="cloud-head">
        <span style="display:inline-flex;align-items:center;gap:6px;">${ICON_SM('tag')} 标签云</span>
        <span style="margin-left:auto;display:flex;gap:6px;">
          <button class="btn small ghost" data-action="create-tag">＋ 新建标签</button>
          <button class="btn small ghost" data-action="manage-tags">🏷 管理标签</button>
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
  const filtered = TAG_FILTER ? (itemsByTag.get(TAG_FILTER) || []) : taggedItems;
  if (TAG_FILTER) {
    const items = filtered;
    html += `<div class="section-toolbar"><span class="sec-title">标签 <b>#${escapeHtml(TAG_FILTER)}</b> · ${items.length} 个书签</span>
      <button class="btn small ghost" data-action="clear-tag-filter">清除筛选</button></div>`;
    if (!items.length) html += emptyState(ICON('tag'), '该标签下没有书签', '');
    else html += renderItemRows(items, 'tag-filter-' + TAG_FILTER, FIRST_TAG_FILTER_COUNT, FIRST_LIST_COUNT);
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
  content().innerHTML = html;
  if (!TAG_FILTER) {
    const tagGroups = takeForRender(entries, 'tag-groups', FIRST_GROUP_COUNT, FIRST_GROUP_COUNT);
    if (FIRST_TAG_GROUP_COUNT < tagGroups.items.length) {
      appendTagGroups(tagGroups.items, itemsByTag, FIRST_TAG_GROUP_COUNT, tagGroups.more, ++tagRenderToken);
    } else {
      tagRenderToken++;
    }
  } else {
    tagRenderToken++;
  }
}

// ---------- 清理 tab：重复 / 空夹（子区块切换） ----------
let cleanSub = 'repeat';   // repeat | empty

function cleanNav(label, key, icon, n) {
  const active = cleanSub === key ? ' active' : '';
  return `<button class="subtab${active}" data-action="clean-sub" data-sub="${key}">${icon} ${label} <span class="cnt">${n}</span></button>`;
}

function renderClean() {
  const d = DATA;
  let html = overviewDetailHeader('清理书签') + pageHint(ICON('sparkles'), '<b>本页能做什么：</b>一次性处理完全重复的书签和空文件夹。每个区块可一键批量操作。') + `
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
  const html = overviewDetailHeader('回收站') + pageHint(ICON('archive'), '<b>本页能做什么：</b>回收站保存删除的书签，30 天内可恢复。') + `
    <div id="trashBody"></div>`;
  content().innerHTML = html;
  renderTrash($('#trashBody'));
}

function overviewDetailHeader(title) {
  return `<div class="section-toolbar"><button class="btn small ghost" data-action="overview-back">返回概览</button><span class="sec-title">${title}</span></div>`;
}

function renderEmpty(container) {
  const c = container || content();
  if (!DATA.emptyFolders.length) { c.innerHTML = emptyState(ICON('trash'), '没有空文件夹', '书签结构很整洁，无需清理'); return; }
  let html = `
    <div class="section-toolbar">
      <span class="sec-title">共 <b>${DATA.emptyFolders.length}</b> 个空文件夹</span>
      <button class="btn small danger" data-action="bulk-empty">${ICON_SM('trash')} 一键清空</button>
    </div>`;
  const folders = takeForRender(DATA.emptyFolders, 'empty-folders', FIRST_LIST_COUNT, FIRST_LIST_COUNT);
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
    c.innerHTML = emptyState(ICON('archive'), '回收站是空的', '在「书签管家」中删除的书签会先进回收站，30 天内可恢复');
    return;
  }
  const ttl = BM.TRASH_TTL_DAYS || 30;
  let html = `
    <div class="section-toolbar">
      <span class="sec-title">共 <b>${list.length}</b> 项待恢复${list.length >= (BM.TRASH_MAX || 1000) ? `（已达上限，最早的记录会被新删除项挤出）` : ''}</span>
      <div class="toolbar-actions">
        <button class="btn small primary" data-action="trash-restore-all">${ICON_SM('undo')} 一键恢复</button>
        <button class="btn small danger" data-action="trash-clear">${ICON_SM('trash')} 清空回收站</button>
      </div>
    </div>`;
  const now = Date.now();
  const page = takeForRender(list, 'trash-items', FIRST_LIST_COUNT, FIRST_LIST_COUNT);
  page.items.forEach(t => {
    const remain = Math.max(0, Math.ceil((t.deletedAt + ttl * 86400000 - now) / 86400000));
    const pathText = (t.path && t.path.length) ? t.path.join(' / ') : '书签栏';
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
  if (!t) { toast('该记录不存在', 'warn'); return; }
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
  if (!items.length) { toast('回收站是空的', 'warn'); return; }
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
      onProgress: progress => updateProgress(
        Math.round(progress.done / progress.total * 100),
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
  if (renderPage !== false) render(currentTab);
}

function openTagFilter(tag) {
  TAG_FILTER = tag || '';
  clearSearch(false);
  switchTab('tags');
}

function renderSearch() {
  const q = SEARCH;
  const hiddenScope = currentTab === 'hidden';
  const sourceItems = hiddenScope ? DATA.items.filter(it => it.hidden) : DATA.items;
  const hits = sourceItems.filter(it => {
    const hay = it.searchText || ((it.title || '') + ' ' + (it.url || '') + ' ' + (it.host || '')).toLowerCase();
    return hay.includes(q);
  });
  content().innerHTML = `
    <section class="search-results">
      <header class="search-results-head">
        <div class="search-query">
          <span class="search-query-icon">${ICON('search')}</span>
          <div class="search-query-copy">
            <span>${hiddenScope ? '隐藏书签搜索' : '搜索结果'}</span>
            <b title="${escapeHtml(q)}">${escapeHtml(q)}</b>
          </div>
        </div>
        <div class="search-result-actions">
          <span class="search-result-count"><b>${hits.length}</b> 个匹配</span>
          <button class="search-result-clear" data-action="clear-search" title="清除搜索" aria-label="清除搜索">${ICON_SM('x')}</button>
        </div>
      </header>
      <div class="search-results-list${hits.length === 1 ? ' single' : ''}">
        ${hits.length ? renderItemRows(hits, 'search-' + currentTab + '-' + q, FIRST_LIST_COUNT, FIRST_LIST_COUNT, { highlight: q, search: true }) : emptyState(ICON('search'), hiddenScope ? '没有匹配的隐藏书签' : '没有匹配结果', '换个关键词，或检查是否有拼写错误')}
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

// ---------- 数据加载 ----------
async function runRefresh() {
  await waitForInitialTagConfiguration();
  tabRenderToken++;
  listRenderLimits = Object.create(null);
  content().innerHTML = '<div class="loading">正在扫描书签…</div>';
  try {
    if (!chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function') {
      throw new Error('chrome.bookmarks API 不可用，请确认扩展已正确加载并启用');
    }
    DATA = await BMAnalyzer.analyze();
    // storage 版本迁移钩子（预留 schema 变更）
    try { await BM.migrateStorage(); } catch (e) { console.warn('[书签管家] storage 迁移失败', e); }
    // 先清理超过 30 天的过期项，再读入回收站（惰性清理，与后台 alarm 双保险）
    try { await BM.purgeExpiredTrash(); } catch (e) { console.warn('[书签管家] 回收站清理失败', e); }
    DATA.trash = await BM.getTrash();
    render(currentTab);
    updateBulk();
  } catch (e) {
    console.error('[书签管家] 扫描失败:', e);
    showError(e);
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
      items: g.items.slice(1).map(it => ({ id: it.id, title: it.title, url: it.url, host: it.host, included: true }))
    }));
  }
  groups = groups.filter(g => g.items.length);
  if (!groups.length) { toast('没有可一键清理的项', 'warn'); return; }
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
      ${g.items.map(i => `
        <div class="row plan-item plan-del clickable" data-id="${i.id}">
          <input type="checkbox" class="plan-inc sel" data-id="${i.id}" ${i.included ? 'checked' : ''}>
          <div class="meta">
            <div class="title">${escapeHtml(i.title)}</div>
            <div class="url">${escapeHtml(i.url)}</div>
          </div>
          <span class="d-label">删除</span>
        </div>`).join('')}`;
    const n = g.items.filter(i => i.included).length;
    html += groupWrap('plan-' + idx, ICON('trash'), g.label, n ? 'danger' : '', n + ' 待删', `
      <label class="plan-grp-toggle">
        <input type="checkbox" class="sel plan-grp" data-idx="${idx}" ${n ? 'checked' : ''}> 整组</label>
    `, body);
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
    PLAN.groups.forEach(g => g.items.forEach(i => { if (i.included) ids.push(i.id); }));
    if (!ids.length) { toast('没有要删除的项', 'warn'); return; }
    const ok = await confirmDialog({
      title: '删除选中的 ' + ids.length + ' 个书签？',
      message: '每组将保留 1 个。删除后 30 天内可在「回收站」恢复；本次产生的空文件夹将同步清理（文件夹不可恢复）。',
      confirmText: '删除'
    });
    if (!ok) return;
    const r = await softDelete(ids, '删除中', { pruneEmptyFolders: true });
    toast('已删除 ' + r.n + ' 个重复书签' + (r.prunedFolders ? '，清理 ' + r.prunedFolders + ' 个空文件夹' : ''), 'ok', { label: '撤销', onClick: () => undoDelete(r.items) });
    planMode = false; PLAN = null;
    refresh();
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
    confirmText: '清空'
  });
  if (!ok) return;
  // emptyFolders 已按子目录优先收集，必须串行删除才能继续清掉随后变空的父目录。
  const removal = await removeForIds(ids, '清理中', { concurrency: 1, clearTags: false });
  toast('已清理 ' + removal.count + ' 个空文件夹 ✓', 'ok');
  refresh();
}

// 统一同址（urlKey 相同）书签的标签：对每一组，取全体标签的并集写回每个书签。
// 用于修复历史遗留的同址不同标（例如 AI 分批打标 / 手动编辑造成的不一致）。
async function unifyExactTags() {
  try { await BM.loadTags(); await BM.loadFixedTags(); } catch (e) { /* noop */ }
  const currentMap = BM.getTags() || {};
  const groups = getSameUrlGroups();
  if (!groups.length) { toast('没有同址多书签需要统一', 'ok'); return; }
  // 找出确实存在不一致的组（任一组的标签集合彼此不同）。
  const tagSig = tags => [...(tags || [])].sort().join('\u0000');
  const diverged = groups.filter(items => {
    const sigs = new Set(items.map(it => tagSig(currentMap[it.id] || [])));
    return sigs.size > 1;
  });
  if (!diverged.length) { toast('同址书签的标签已一致 ✓', 'ok'); return; }
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
      items.forEach(it => { changes[it.id] = union.length ? union : null; });
    });
    saved = await BM.setTagsBatch(changes);
  } catch (e) { saved = false; }
  if (!saved) { toast('统一标签保存失败，请重试', 'danger'); return; }
  toast(`已统一 ${diverged.length} 组同址书签的标签 ✓`, 'ok');
  refresh();
}

// ---------- 批量移动：选中项 → 分类文件夹 ----------
// 在书签栏根目录下查找或创建同名文件夹，返回其 id
async function ensureFolder(title) {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0].children && tree[0].children[0];
  if (!bar) throw new Error('未找到书签栏根目录');
  let folder = (await chrome.bookmarks.search({ title })).find(f => f.parentId === bar.id && !f.url);
  if (!folder) folder = await chrome.bookmarks.create({ parentId: bar.id, title });
  return folder.id;
}

// ---------- 选择 / 批量栏 ----------
function getSelectedIds() {
  return [...document.querySelectorAll('#content .sel:checked')].map(c => c.dataset.id);
}

function updateBulk() {
  if (planMode) { $('#bulkBar').classList.add('hidden'); return; }
  const checked = getSelectedIds();
  const bar = $('#bulkBar');
  if (checked.length) {
    $('#bulkCount').innerHTML = '已选 <b>' + checked.length + '</b> 项';
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

// ---------- 书签备份 / 恢复（JSON 导出 / 导入） ----------
async function exportBackup() {
  if (!DATA) { toast('暂无数据，请先扫描', 'warn'); return; }
  try {
    const r = await BM.exportBookmarksJSON();
    const blob = new Blob([r.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bookmark-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已导出 ' + r.count + ' 个书签备份 ✓', 'ok');
  } catch (e) {
    toast('导出失败：' + (e.message || e), 'danger');
    try { BM.logError('backup-export', e); } catch (e2) { /* ignore */ }
  }
}

let backupFileInput = null;
function ensureBackupInput() {
  if (backupFileInput) return backupFileInput;
  backupFileInput = document.createElement('input');
  backupFileInput.type = 'file';
  backupFileInput.accept = 'application/json,.json';
  backupFileInput.style.display = 'none';
  document.body.appendChild(backupFileInput);
  backupFileInput.addEventListener('change', async () => {
    const f = backupFileInput.files && backupFileInput.files[0];
    backupFileInput.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      // 第一步：dryRun 统计 → 预览确认
      const stats = await BM.importBookmarksJSON(text, { dryRun: true });
      const choice = await confirmDialog({
        title: '恢复书签备份？',
        message: `备份将新增 <b>${stats.folders}</b> 个文件夹、<b>${stats.bookmarks}</b> 个书签`
          + (stats.merged ? `，合并 <b>${stats.merged}</b> 个相同网址书签及其标签` : '')
          + (stats.skipped ? `（跳过 ${stats.skipped} 个）` : '')
          + (stats.merged ? '。单书签最多保留 6 个标签，已有标签优先。' : '。')
          + '顶级同名文件夹会自动复用。',
        confirmText: stats.merged ? '合并并恢复' : '开始恢复',
        thirdText: stats.merged ? '保留副本' : '',
        danger: false
      });
      if (!choice) return;
      const keepDuplicates = choice === 'third';
      const real = await BM.importBookmarksJSON(text, { dryRun: false, keepDuplicates });
      toast(`恢复完成：新增 ${real.bookmarks} 个书签、${real.folders} 个文件夹`
        + (real.merged ? `，合并 ${real.merged} 个相同网址书签` : '') + ' ✓', 'ok');
      refresh();
    } catch (e) {
      toast('恢复失败：' + (e.message || e), 'danger');
      try { BM.logError('backup-import', e); } catch (e2) { /* ignore */ }
    }
  });
  return backupFileInput;
}

// ---------- 标签切换与渲染分发 ----------
function switchTab(tab) {
  const changed = currentTab !== tab;
  planMode = false; PLAN = null;
  currentTab = tab;
  overviewDetail = '';
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
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
  if (SEARCH) { renderSearch(); return; }
  if (planMode) { renderPlan(); return; }
  if (tab === 'overview' && overviewDetail === 'clean') renderClean();
  else if (tab === 'overview' && overviewDetail === 'trash') renderTrashView();
  else if (tab === 'overview') renderOverview();
  else if (tab === 'tags') renderTags();
  else if (tab === 'hidden') renderHidden();
  applyCollapsed(); // 恢复折叠状态（sessionStorage 记忆）
  updateBulk();
}

function openOverviewDetail(detail, sub) {
  tabRenderToken++;
  overviewDetail = detail;
  if (detail === 'clean') cleanSub = sub || 'repeat';
  planMode = false; PLAN = null;
  currentTab = 'overview';
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'overview'));
  if (DATA) render('overview');
}

// 折叠状态记忆：渲染后按 sessionStorage 恢复各分组折叠状态
function applyCollapsed() {
  try {
    document.querySelectorAll('#content .group').forEach(g => {
      const key = 'bm-fold-' + g.dataset.group;
      if (sessionStorage.getItem(key) === '1') {
        const body = g.querySelector('.group-body');
        if (body) body.style.display = 'none';
      }
    });
  } catch (e) { /* ignore */ }
}

// ---------- 键盘导航（j/k 移动高亮行，Enter 打开） ----------
let kbRow = null;
function kbRows() { return [...document.querySelectorAll('#content .row.clickable')]; }
function kbHighlight(row) {
  kbRow = row;
  kbRows().forEach(r => r.classList.toggle('kb-focus', r === row));
  if (row) row.scrollIntoView({ block: 'nearest' });
}
function kbMove(dir) {
  const rows = kbRows();
  if (!rows.length) return;
  const idx = kbRow ? rows.indexOf(kbRow) : -1;
  const next = Math.max(0, Math.min(rows.length - 1, idx + dir));
  kbHighlight(rows[next]);
}
function kbOpen(row) {
  const it = getItemById(row.dataset.id);
  if (it && it.url) openBookmarkUrl(it.url, false);
}

// ---------- 拖拽排序 / 跨组移动（HTML5 drag & drop） ----------
let dragState = null; // { id, fromParent }

function bindDrag() {
  const contentEl = content();
  contentEl.addEventListener('dragstart', e => {
    const row = e.target.closest('.row.clickable.draggable');
    if (!row || !row.dataset.id) return;
    const it = getItemById(row.dataset.id);
    if (!it) return;
    dragState = { id: it.id, fromParent: it.parentId };
    try { e.dataTransfer.setData('text/plain', it.id); } catch (err) { /* ignore */ }
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  contentEl.addEventListener('dragend', () => {
    clearDragHints();
    dragState = null;
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
      row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    } else if (head) {
      head.closest('.group').classList.add('drag-target');
    }
  });
  contentEl.addEventListener('drop', async e => {
    e.preventDefault();
    if (!dragState) return;
    const row = e.target.closest('.row.clickable.draggable');
    const head = e.target.closest('.group-head');
    try {
      if (row && row.dataset.id !== dragState.id) await dropOntoRow(row);
      else if (head) await dropOntoGroup(head);
    } catch (err) {
      toast('移动失败：' + (err.message || err), 'danger');
      try { BM.logError('drag', err); } catch (e2) { /* ignore */ }
    } finally {
      dragState = null;
      clearDragHints();
      refresh();
    }
  });
}

function clearDragHints() {
  document.querySelectorAll('#content .drop-before, #content .drop-after, #content .group.drag-target')
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drag-target'));
}

// 拖到书签行：排序 / 插入到目标行所在文件夹的对应位置
async function dropOntoRow(row) {
  const targetIt = getItemById(row.dataset.id);
  if (!targetIt) return;
  const children = await chrome.bookmarks.getChildren(targetIt.parentId);
  let index = children.findIndex(c => c.id === targetIt.id);
  if (dsFromSameParent(dragState.fromParent, targetIt.parentId)) {
    const fromIndex = children.findIndex(c => c.id === dragState.id);
    if (fromIndex >= 0 && fromIndex < index) index -= 1;
  }
  await chrome.bookmarks.move(dragState.id, { parentId: targetIt.parentId, index: index < 0 ? 0 : index });
  toast('已移动书签 ✓', 'ok');
}
const dsFromSameParent = (a, b) => String(a) === String(b);

// 拖到分组标题：整组移动（exact → 域名文件夹；category → 分类文件夹）
async function dropOntoGroup(head) {
  const group = head.closest('.group');
  const gkey = group.dataset.group;
  const gnameEl = head.querySelector('.g-name');
  const name = gnameEl ? gnameEl.textContent : '';
  if (!gkey || !name) { toast('该分组不支持拖入', 'warn'); return; }
  let folderTitle;
  if (gkey.startsWith('exact-')) folderTitle = name;
  else if (gkey.startsWith('cat-')) folderTitle = '书签管家·' + name;
  else { toast('该分组不支持拖入', 'warn'); return; }
  const folderId = await ensureFolder(folderTitle);
  await chrome.bookmarks.move(dragState.id, { parentId: folderId });
  toast('已移动到「' + name + '」✓', 'ok');
}

// ---------- 初始化 ----------
async function init() {
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
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (SEARCH) renderSearch(); else render(currentTab);
    }, 180);
  });
  searchClear.addEventListener('click', () => {
    clearSearch();
  });

  // 内容区事件委托
  content().addEventListener('click', e => {
    // KPI / 行动清单从概览进入工具视图，不增加顶级页签。
    const jmp = e.target.closest('[data-jump]');
    if (jmp) {
      const t = jmp.dataset.jump;
      const sub = jmp.dataset.sub || '';
      if (t === 'clean' || t === 'trash') openOverviewDetail(t, sub);
      else switchTab(t);
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'clear-search') {
        clearSearch();
      } else if (action === 'selall') {
        const g = btn.dataset.group;
        document.querySelectorAll(`.group[data-group="${g}"] .sel`).forEach(c => { c.checked = true; });
        updateBulk();
      } else if (action === 'keepfirst') {
        const g = DATA.exactDuplicates[+btn.dataset.idx];
        const ids = g.items.slice(1).map(i => i.id);
        confirmDialog({
          title: '清理这组重复书签？',
          message: `将删除 <b>${ids.length}</b> 个重复项，保留「${escapeHtml(g.items[0].title)}」。删除后 30 天内可在回收站恢复；本次产生的空文件夹将同步清理（文件夹不可恢复）。`,
          confirmText: '删除'
        }).then(ok => {
          if (!ok) return;
          softDelete(ids, '清理重复项', { pruneEmptyFolders: true }).then(r => {
            if (r.n) toast('已清理 ' + r.n + ' 个重复项' + (r.prunedFolders ? '，清理 ' + r.prunedFolders + ' 个空文件夹' : ''), 'ok', { label: '撤销', onClick: () => undoDelete(r.items) });
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
        render('tags');
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
        const cur = ($('#addTags').value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (!cur.includes(t)) {
          cur.push(t);
          $('#addTags').value = cur.join(', ');
        }
        renderTagSuggest();
      } else if (action === 'delfolder') {
        confirmDialog({
          title: '删除空文件夹？',
          message: '「' + escapeHtml(btn.dataset.title || '') + '」是空文件夹，删除后不可恢复。',
          confirmText: '删除'
        }).then(ok => {
          if (!ok) return;
          removeForIds([btn.dataset.id], '删除中', { clearTags: false }).then(removal => {
            if (removal.count) toast('已删除空文件夹 ✓', 'ok');
            refresh();
          });
        });
      } else if (action === 'plan-back') {
        planMode = false; PLAN = null; render(currentTab);
      } else if (action === 'plan-apply') {
        applyPlan();
      } else if (action === 'trash-restore') {
        doRestoreTrash(btn.dataset.id);
      } else if (action === 'trash-restore-all') {
        doRestoreAllTrash();
      } else if (action === 'trash-discard') {
        if (trashRestoreInProgress) { toast('回收站恢复中，请稍候', 'warn'); return; }
        confirmDialog({
          title: '永久删除该记录？',
          message: '书签本身早已删除，此操作仅清空回收站记录，<b>不可撤销</b>。',
          confirmText: '永久删除'
        }).then(ok => {
          if (!ok) return;
          BM.discardTrashItem(btn.dataset.id)
            .then(() => {
              toast('已永久删除 ✓', 'ok');
              refresh();
            })
            .catch(e => toast('永久删除失败：' + (e.message || e), 'danger'));
        });
      } else if (action === 'trash-clear') {
        if (trashRestoreInProgress) { toast('回收站恢复中，请稍候', 'warn'); return; }
        confirmDialog({
          title: '清空回收站？',
          message: '所有待恢复书签将<b>永久丢失</b>，不可恢复。',
          confirmText: '清空'
        }).then(ok => {
          if (!ok) return;
          BM.clearTrash()
            .then(() => {
              toast('回收站已清空 ✓', 'ok');
              refresh();
            })
            .catch(e => toast('清空回收站失败：' + (e.message || e), 'danger'));
        });
      } else if (action === 'edit-item') {
        const it = getItemById(btn.dataset.id);
        if (it) openAddDrawer(it);
      } else if (action === 'backup-export') {
        exportBackup();
      } else if (action === 'backup-import') {
        ensureBackupInput().click();
      }
      return;
    }
    // 点击书签行打开链接（排除复选框/勾选区/标签/按钮/链接等控件）
    const row = e.target.closest('.row.clickable');
    if (row && !e.target.closest('.checkbox-slot') && !e.target.closest('input') && !e.target.closest('select') && !e.target.closest('button') && !e.target.closest('a')) {
      const it = getItemById(row.dataset.id);
      if (it && it.url) {
        openBookmarkUrl(it.url, !(e.ctrlKey || e.metaKey));
        return;
      }
    }
    // 折叠/展开（点击 input/select 时不触发折叠；状态写入 sessionStorage 记忆）
    const head = e.target.closest('.group-head');
    if (head && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('select')) {
      const body = head.parentElement.querySelector('.group-body');
      if (body) {
        body.style.display = (body.style.display === 'none' ? '' : 'none');
        try {
          sessionStorage.setItem('bm-fold-' + head.parentElement.dataset.group, body.style.display === 'none' ? '1' : '0');
        } catch (err) { /* ignore */ }
      }
    }
  });

  // 复选框 / 下拉变化（含方案控件）
  content().addEventListener('change', e => {
    if (e.target.id === 'planPrefix') { PLAN.prefix = e.target.value; return; }
    if (e.target.classList.contains('plan-inc')) {
      const p = findPlanItem(e.target.dataset.id);
      if (p) { p.included = e.target.checked; updatePlanSummary(); }
      return;
    }
    if (e.target.classList.contains('plan-grp')) {
      const g = PLAN.groups[+e.target.dataset.idx];
      if (g) {
        g.items.forEach(i => { i.included = e.target.checked; });
        // 局部同步整组行的勾选状态，避免整页重渲染跳动
        const wrap = e.target.closest('.group');
        if (wrap) wrap.querySelectorAll('.plan-inc').forEach(c => { c.checked = e.target.checked; });
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
  $('#bulkDelete').addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#content .sel:checked')].map(c => c.dataset.id);
    if (!ids.length) return;
    const isMass = ids.length >= 50; // 危险操作二次确认
    confirmDialog({
      title: '删除选中的 ' + ids.length + ' 项？',
      message: (isMass
        ? `<div class="confirm-warn">⚠️ 你选择了 <b>${ids.length}</b> 项，属于大范围操作，请再次确认无误。</div>`
        : '') + '删除后 30 天内可在「回收站」恢复，恢复时优先放回原位置。',
      confirmText: isMass ? '确认删除 ' + ids.length + ' 项' : '删除'
    }).then(ok => {
      if (!ok) return;
      softDelete(ids, '删除中').then(r => {
        if (r.n) toast('已删除 ' + r.n + ' 项', 'ok', { label: '撤销', onClick: () => undoDelete(r.items) });
        refresh();
      });
    });
  });
  $('#bulkAll').addEventListener('click', () => {
    document.querySelectorAll('#content .sel').forEach(c => { c.checked = true; });
    updateBulk();
  });
  $('#bulkInvert').addEventListener('click', () => {
    document.querySelectorAll('#content .sel').forEach(c => { c.checked = !c.checked; });
    updateBulk();
  });
  $('#bulkClear').addEventListener('click', () => {
    document.querySelectorAll('#content .sel:checked').forEach(c => { c.checked = false; });
    updateBulk();
  });
  // 批量打标签
  $('#bulkTag').addEventListener('click', bulkTagSelected);
  // 标签管理弹层
  $('#tagMgrClose').addEventListener('click', () => $('#tagMgrWrap').classList.add('hidden'));
  $('#tagMgrList').addEventListener('click', e => {
    const btn = e.target.closest('[data-mgr]');
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (btn.dataset.mgr === 'rename') renameTag(tag);
    else if (btn.dataset.mgr === 'remove') removeTagFromPool(tag);
  });

  // 底部按钮
  $('#rescanBtn').addEventListener('click', () => refresh(true));
  $('#rescanMini').addEventListener('click', () => refresh(true));
  // 收起侧边栏（关闭面板）
  $('#closePanelBtn').addEventListener('click', async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (chrome.sidePanel && chrome.sidePanel.close) {
        await chrome.sidePanel.close({ windowId: win.id });
      }
    } catch (e) { /* 无 close 或失败 */ }
  });

  // ---------- 键盘快捷键：/ 搜索、? 帮助、Esc 关抽屉/退方案、Ctrl+K 搜索、j/k 导航 ----------
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (!$('#drawerOverlay').classList.contains('hidden')) { closeDrawers(); return; }
      if (planMode) { planMode = false; PLAN = null; render(currentTab); return; }
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); $('#searchInput').focus(); return; }
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === 'j' || e.key === 'J') { e.preventDefault(); kbMove(1); return; }
    if (e.key === 'k' || e.key === 'K') { e.preventDefault(); kbMove(-1); return; }
    if (e.key === 'Enter' && kbRow && tag !== 'button') { kbOpen(kbRow); }
  });

  // ---------- 抽屉焦点陷阱（Tab 循环）+ 关闭恢复焦点 ----------
  ['#addDrawer', '#helpDrawer'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const list = [...el.querySelectorAll('button, input, select, textarea, a[href]')]
        .filter(x => !x.disabled && x.offsetParent !== null);
      if (!list.length) return;
      if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === list[list.length - 1]) { e.preventDefault(); list[0].focus(); }
    });
  });

  // ---------- 拖拽排序 / 跨组移动 ----------
  bindDrag();

  // 设置按钮 → 直接打开独立设置页（含 AI 分类 / 标签体系 / 浏览器集成 三大组）
  $('#settingsBtn').addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch (e) { console.warn('[书签管家] 无法打开设置页', e); }
  });

  // 操作指南抽屉
  $('#helpBtn').addEventListener('click', openHelp);
  $('#helpClose').addEventListener('click', closeDrawers);

  // 新增书签抽屉
  $('#addBtn').addEventListener('click', openAddDrawerForCurrentTab);
  $('#addClose').addEventListener('click', closeDrawers);
  $('#addSave').addEventListener('click', saveAdd);
  $('#addAiTag').addEventListener('click', aiTagSuggest);
  $('#addTags').addEventListener('input', renderTagSuggest);
  $('#addUrl').addEventListener('input', () => { clearTimeout(addUrlTimer); addUrlTimer = setTimeout(suggestCat, 250); });
  $('#addTitle').addEventListener('input', () => { clearTimeout(addUrlTimer); addUrlTimer = setTimeout(suggestCat, 250); });

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
          if (p && !SETTINGS.model) SETTINGS.model = p.model;
        }
      }
      if (area === 'local' && changes.bmFixedTags) {
        try { BM.invalidateFixedTags(); } catch (e) { /* noop */ }
        try {
          if (BM.loadFixedTags) BM.loadFixedTags().then(() => {
            const manager = $('#tagMgrWrap');
            if (manager && !manager.classList.contains('hidden')) openTagManager();
          }).catch(() => {});
        } catch (e) { /* noop */ }
      }
      if (area === 'local' && changes.bmTagRules) {
        try { BM.invalidateTagRules(); } catch (e) { /* noop */ }
        try { if (BM.loadTagRules) BM.loadTagRules().catch(() => {}); } catch (e) { /* noop */ }
      }
      if (area === 'local' && changes.bmTags) {
        try { BM.invalidateTags(); } catch (e) { /* noop */ }
        refresh();
      }
    });
  } catch (e) { /* 存储事件不可用时忽略 */ }

  await Promise.all([settingsReady, refresh(true)]);

  // 标签原生同步在首屏之后继续；它不能阻塞本地书签的可用视图。
  try {
    BM.watchTagConfiguration(() => {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      refresh(true);
    });
    void tagConfigurationReady.then(async () => {
      if (tagConfigurationSyncFailed) return;
      const changed = await BM.pullTagsFromCloud();
      if (changed) { BM.invalidateTags(); await refresh(true); }
    }).catch(() => {});
  } catch (e) { /* 无 sync 权限等忽略 */ }

}

// ---------- 设置：读取（设置 UI 已迁移至独立 options.html 选项页）----------
async function loadSettings() {
  try {
    const [r] = await Promise.all([
      chrome.storage.local.get('bmSettings'),
      BM.loadTagRules ? BM.loadTagRules() : Promise.resolve()
    ]);
    if (r.bmSettings) {
      SETTINGS = Object.assign({ provider: 'deepseek', baseUrl: '', apiKey: '', model: '' }, r.bmSettings);
      const p = PROVIDERS[SETTINGS.provider];
      if (p && !SETTINGS.baseUrl) SETTINGS.baseUrl = p.base;
      if (p && !SETTINGS.model) SETTINGS.model = p.model;
    }
  } catch (e) { console.warn('[书签管家] 读取设置失败', e); }
}

// 操作指南抽屉
function openHelp() {
  closeDrawers();
  lastFocus = document.activeElement;
  $('#drawerOverlay').classList.remove('hidden');
  $('#helpDrawer').classList.remove('hidden');
}

// 抽屉打开前的焦点（关闭后恢复）
let lastFocus = null;

function closeDrawers() {
  $('#drawerOverlay').classList.add('hidden');
  $('#addDrawer').classList.add('hidden');
  $('#helpDrawer').classList.add('hidden');
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
    $('#addDrawerTitle').textContent = '✏️ 编辑书签';
    $('#addUrl').value = item.url || '';
    $('#addTitle').value = item.title || '';
    tagsInput.value = (item.tags || []).join(', ');
    $('#addSave').textContent = '保存修改';
    setAddMsg('修改保存后立即生效', '');
  } else {
    $('#addDrawerTitle').textContent = '➕ 新增书签';
    $('#addUrl').value = (item && item.url) || '';
    $('#addTitle').value = (item && item.title) || '';
    tagsInput.value = '';
    $('#addSave').textContent = '保存书签';
    setAddMsg((item && item.url) ? '' : '');
  }
  // 新增模式（无 id）且有 url：自动套用建议标签，用户可修改
  if (!isEdit && item && item.url) {
    const url = String(item.url || '').trim();
    const title = String(item.title || '').trim();
    if (url) {
      let host = '';
      try { host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname; } catch (e) { /* keep empty */ }
      const sugg = BM.suggestTags ? BM.suggestTags({ host, url, title }) : [];
      if (sugg.length) {
        tagsInput.value = sugg.join(', ');
        setAddMsg('✨ 已自动建议标签：' + sugg.join('、') + '（可直接保存或修改）', '');
      }
    }
  }
  renderTagSuggest();
  $('#drawerOverlay').classList.remove('hidden');
  $('#addDrawer').classList.remove('hidden');
  $('#addUrl').focus();
}

// 打开"新增当前页"抽屉：填充当前标签页 URL/标题 + 已存在检测
async function openAddDrawerForCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
      toast('当前页面不支持保存为书签', 'warn');
      openAddDrawer(); // 空表单兜底
      return;
    }
    const existing = findExistingByUrl(tab.url);
    if (existing.length) {
      const top = existing[0];
      // 三按钮：编辑已有 / 仍要新增 / 取消（取消时什么都不做）
      const result = await confirmDialog({
        title: '该书签已存在',
        message: `当前页面已是已保存的书签：<br><b>${escapeHtml(top.title || '(无标题)')}</b><br><span style="color:var(--muted);font-size:11px;">${escapeHtml(top.url)}</span><br><br>「编辑已有」打开这个书签；「仍要新增」创建副本；「取消」什么也不做。`,
        confirmText: '仍要新增',
        cancelText: '取消',
        thirdText: '编辑已有',
        danger: false
      });
      if (result === 'third') {
        openAddDrawer(top); // 编辑模式（含标签）
      } else if (result === true) {
        // 仍要新增 → 新增抽屉预填（会触发精确重复提示）
        openAddDrawer({ url: tab.url, title: tab.title || '' });
        setAddMsg('该 URL 已存在，将创建副本', 'warn');
      }
      // result === false（取消）→ 什么都不做
    } else {
      openAddDrawer({ url: tab.url, title: tab.title || '' });
      setAddMsg('正在保存当前页面', '');
    }
  } catch (e) { console.warn('[书签管家] 打开新增抽屉失败', e); openAddDrawer(); }
}

// 渲染「建议标签」chips：基于本地规则（分类/域名组/注册域名）+ 已有的标签输入
function renderTagSuggest() {
  const box = $('#tagSuggest');
  if (!box) return;
  const url = $('#addUrl').value.trim();
  const title = $('#addTitle').value.trim();
  const cur = ($('#addTags').value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const sugg = [];
  if (url) {
    let host = '';
    try { host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname; } catch (e) { /* keep empty */ }
    sugg.push(...(BM.suggestTags ? BM.suggestTags({ host, url, title }) : []));
  }
  // 已输入的标签去重展示
  const all = [...new Set([...cur, ...sugg])].slice(0, 10);
  if (!all.length) { box.innerHTML = ''; return; }
  box.innerHTML = all.map(t =>
    `<button type="button" class="tag-chip" data-action="pick-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
  ).join('') + (sugg.length ? `<span class="tag-suggest-tip">（建议）</span>` : '');
}

// URL/标题变化时刷新建议标签 + 精确重复提示
function suggestCat() {
  renderTagSuggest();
  const url = $('#addUrl').value.trim();
  const hint = $('#addDupHint');
  if (!hint) return;
  if (!url) { hint.style.display = 'none'; return; }
  const duplicates = findExistingByUrl(url, EDITING && EDITING.id);
  if (duplicates.length) {
    const links = duplicates.slice(0, 3).map(it => {
      let href = '';
      try { href = ` href="${escapeHtml(BM.normalizeHttpUrl(it.url).href)}" target="_blank" rel="noopener"`; } catch (e) { /* unsupported URL */ }
      return `<a${href} style="color:inherit;text-decoration:underline;">${escapeHtml(it.title)}</a>`;
    });
    hint.style.display = 'block';
    hint.innerHTML = '⚠️ 已有 <b>' + duplicates.length + '</b> 个相同网址书签：' +
      links.join('、') + (duplicates.length > 3 ? '…' : '');
  } else {
    hint.style.display = 'none';
  }
}

// AI 打标：为当前新增/编辑的书签生成 1-3 个标签
async function aiTagSuggest() {
  const url = $('#addUrl').value.trim();
  const title = $('#addTitle').value.trim();
  if (!url) { setAddMsg('请先填写网址', 'err'); return; }
  const btn = $('#addAiTag');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = '准备中…';
  try {
    await settingsReady;
    if (!SETTINGS.apiKey || !SETTINGS.baseUrl || !SETTINGS.model) {
      setAddMsg('未配置 LLM，请先到 ⚙️ 设置', 'err');
      try { chrome.runtime.openOptionsPage(); } catch (e) { /* noop */ }
      return;
    }
    if (!await BM.hasLlmHostPermission(SETTINGS.baseUrl)) {
      setAddMsg('请先在 ⚙️ 设置中点击“保存配置”并授予该 LLM 服务访问权限', 'err');
      try { chrome.runtime.openOptionsPage(); } catch (e) { /* noop */ }
      return;
    }
    const safeUrl = BM.normalizeHttpUrl(url).href;
    const meta = BM.getBookmarkMetadata(safeUrl, title || safeUrl);
    if (meta.sensitive.some(item => item.sev === 'high')) {
      setAddMsg('该书签触发 AI 隐私保护，不会发送给 AI，请手动填写标签', 'warn');
      return;
    }
    btn.textContent = '打标中…';
    const map = await BM.aiTag([{ id: 'new', title: title || safeUrl, url: safeUrl }], SETTINGS);
    const tags = map['new'] || [];
    if (tags.length) {
      $('#addTags').value = tags.join(', ');
      renderTagSuggest();
      setAddMsg('🤖 已生成标签：' + tags.join('、'), 'ok');
    } else {
      setAddMsg('🤖 AI 未生成标签，请手动输入', 'warn');
    }
  } catch (e) {
    setAddMsg('AI 打标失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = '🤖 AI 打标';
  }
}

async function saveAdd() {
  const raw = $('#addUrl').value.trim();
  if (!raw) { setAddMsg('请填写网址', 'err'); return; }
  let u;
  try { u = BM.normalizeHttpUrl(raw); }
  catch (e) { setAddMsg(e.message || '网址格式不正确', 'err'); return; }
  const title = $('#addTitle').value.trim() || u.hostname;
  // 标签：逗号分隔解析（可多个）
  const tags = ($('#addTags').value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const btn = $('#addSave');
  let selfCreationReserved = false;
  let selfCreationConfirmed = false;
  let selfCreationParentId = '';
  let created = null;
  btn.disabled = true; btn.textContent = '保存中…';
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
      if (!await BM.setTags(EDITING.id, tags)) throw new Error('标签保存失败，请重试');
      if (!await unifySameUrlTags({ id: EDITING.id, url: u.href }, tags)) throw new Error('同址标签同步失败，请重试');
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
      btn.disabled = false; btn.textContent = '保存书签';
      const ok = await confirmDialog({
        title: '已有相同网址的书签？',
        message: `「${escapeHtml(u.href)}」与现有 <b>${duplicates.length}</b> 个书签网址相同：<br>` +
          duplicates.slice(0, 5).map(it => `· ${escapeHtml(it.title)}<span style="color:var(--muted)"> — ${escapeHtml(it.url)}</span>`).join('<br>') +
          (duplicates.length > 5 ? `<br>… 等 ${duplicates.length} 个` : '') +
          `<br><br>可编辑已有书签的标签，或保留一个副本。`,
        confirmText: '保留副本',
        thirdText: '编辑已有',
        danger: false
      });
      if (ok === 'third') { openAddDrawer(duplicates[0]); return; }
      if (!ok) { setAddMsg('已取消：该书签与现有书签网址相同', 'warn'); return; }
      btn.disabled = true; btn.textContent = '保存中…';
    }
    const tree = await chrome.bookmarks.getTree();
    const bar = tree[0].children && tree[0].children[0];
    if (!bar) { setAddMsg('未找到书签栏根目录', 'err'); return; }
    // 标签兜底：用户没填 → 自动套用本地规则建议（可保存后编辑修改）
    let finalTags = tags;
    if (!finalTags.length) {
      let host = '';
      try { host = u.hostname; } catch (e) { /* keep empty */ }
      finalTags = (BM.suggestTags ? BM.suggestTags({ host, url: u.href, title }) : []) || [];
    }
    // 先向后台登记精确创建令牌，创建返回 id 后再确认，避免同 URL 的原生收藏被误跳过。
    try {
      selfCreationParentId = bar.id;
      const reserved = await chrome.runtime.sendMessage({
        type: SELF_CREATION_MESSAGE, action: 'reserve', parentId: bar.id, url: u.href
      });
      selfCreationReserved = !!(reserved && reserved.ok);
    } catch (e) { /* 后台重启时允许继续保存，随后由默认规则兜底 */ }
    created = await chrome.bookmarks.create({ parentId: bar.id, title, url: u.href });
    if (selfCreationReserved) {
      try {
        const confirmed = await chrome.runtime.sendMessage({
          type: SELF_CREATION_MESSAGE, action: 'confirm', parentId: bar.id, url: u.href, bookmarkId: created.id
        });
        selfCreationConfirmed = !!(confirmed && confirmed.ok);
      } catch (e) { /* noop */ }
    }
    if (finalTags.length && !await BM.setTags(created.id, finalTags)) throw new Error('标签保存失败，请重试');
    if (!await unifySameUrlTags({ id: created.id, url: u.href }, finalTags)) throw new Error('同址标签同步失败，请重试');
    toast('已新增书签 ✓' + (finalTags.length ? '（自动标签：' + finalTags.join('、') + '，可在编辑中修改）' : ''), 'ok');
    closeDrawers();
    refresh();
  } catch (e) {
    if (selfCreationReserved && !selfCreationConfirmed) {
      try {
        await chrome.runtime.sendMessage({ type: SELF_CREATION_MESSAGE, action: 'cancel', parentId: selfCreationParentId, url: u.href });
      } catch (e2) { /* noop */ }
    }
    if (created) {
      closeDrawers();
      toast('书签已新增，但标签同步失败，请在列表中编辑重试', 'warn');
      refresh();
      return;
    }
    setAddMsg('保存失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = EDITING ? '保存修改' : '保存书签';
  }
}

// ---------- AI 批量打标：force=false 只打未打标；force=true 全量重打（覆盖） ----------
let aiTagRunning = false;
let aiTagCancel = false;   // 终止标志：为 true 时停止发起新批次，已成功的结果保留
let aiResumeState = null;  // 失败后仅保留尚未成功写入的代表书签，避免从头请求
let aiTagStarting = false; // 权限检查与确认期间也占用启动锁，避免重复点击续打

function claimAiTagStart() {
  if (aiTagRunning || aiTagStarting) return false;
  aiTagStarting = true;
  return true;
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
  if (!targets.length) { toast(isResume || force ? '没有待处理书签' : '所有书签都已打标 ✓', 'ok'); return; }
  if (!SETTINGS.apiKey || !SETTINGS.baseUrl || !SETTINGS.model) {
    toast('请先在 ⚙️ 设置中配置 LLM API', 'warn');
    try { chrome.runtime.openOptionsPage(); } catch (e) { /* noop */ }
    return;
  }
  let hasLlmPermission;
  try {
    hasLlmPermission = await BM.hasLlmHostPermission(SETTINGS.baseUrl);
  } catch (e) {
    toast('LLM 配置无效：' + (e.message || e), 'warn');
    try { chrome.runtime.openOptionsPage(); } catch (e2) { /* noop */ }
    return;
  }
  if (!hasLlmPermission) {
    toast('请先在 ⚙️ 设置中保存配置并授予该 LLM 服务访问权限', 'warn');
    try { chrome.runtime.openOptionsPage(); } catch (e) { /* noop */ }
    return;
  }
  const protectedTargets = targets.filter(it => {
    const meta = BM.getBookmarkMetadata ? BM.getBookmarkMetadata(it.url, it.title) : it;
    return (meta.sensitive || []).some(item => item.sev === 'high');
  });
  const unsupportedTargets = targets.filter(it => !BM.isHttpUrl(it.url));
  const batch = targets.filter(it => !protectedTargets.includes(it) && !unsupportedTargets.includes(it));
  if (!batch.length) {
    toast('没有可发送给 AI 的可处理 HTTP(S) 书签', 'warn');
    return;
  }

  // 同址去重：同一地址（urlKey 相同）只请求一次 AI，结果回填给该地址的全部书签，
  // 避免 LLM 对相同地址给出不同标签（同址不同标）。
  const { representatives, siblingsByKey } = collectAiTagGroups(batch);
  const aiBatch = [...representatives.values()];
  const affectedCount = new Set([...siblingsByKey.values()].flatMap(items => items.map(it => it.id))).size;
  const representativeById = new Map(aiBatch.map(it => [String(it.id), it]));

  const ok = isResume || await confirmDialog({
    title: force ? `全量重新打标 ${affectedCount} 个书签？` : `AI 批量打标 ${affectedCount} 个书签？`,
    message: (force
      ? `⚠️ 将<b>覆盖</b> ${affectedCount} 个书签的现有标签，重新生成 1-3 个标签。`
      : `将为 <b>${affectedCount}</b> 个书签生成 1-3 个标签。`) +
      (protectedTargets.length ? `<br>AI 隐私保护已跳过 <b>${protectedTargets.length}</b> 个高风险书签。` : '') +
      (unsupportedTargets.length ? `<br>已跳过 <b>${unsupportedTargets.length}</b> 个非 HTTP(S) 书签。` : '') +
      `<br>· 隐私保护：仅发送标题与 URL 的域名、路径；query 和 fragment 不发送<br>· 可随时点「终止打标」停止：已成功的结果保留，剩余不再请求<br>· 结果实时写入本地，可在「标签」页查看`,
    confirmText: force ? '全量重打' : '开始打标'
  });
  if (!ok) return;

  aiResumeState = null;
  clearPersistentError();
  aiTagRunning = true;
  const btns = document.querySelectorAll('[data-action="ai-tag-all"], [data-action="ai-tag-all-force"]');
  btns.forEach(b => { b.disabled = false; b.textContent = '⏹ 终止打标'; });
  startProgress(force ? 'AI 全量重打中' : 'AI 打标中', {
    onCancel: () => { aiTagCancel = true; }
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
        updated.forEach(({ it, tags }) => { it.tags = tags; });
        completedInBatch.forEach(id => completedRepresentatives.add(id));
        applied += updated.length;
      },
      onProgress: (ratio, done, total) => {
        updateProgress(Math.round(ratio * 100), 'AI 打标 ' + done + '/' + total + (aiTagCancel ? '（终止中…）' : ''));
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
    try { BM.logError('ai-tag-all', e); } catch (e2) { /* ignore */ }
  } finally {
    aiTagRunning = false;
    aiTagCancel = false;
    const btns = document.querySelectorAll('[data-action="ai-tag-all"], [data-action="ai-tag-all-force"]');
    btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.action === 'ai-tag-all-force' ? '🔄 全量重新打标' : '🤖 AI 批量打标'; });
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
    ? (DATA.itemsByUrl.get(url) || [])
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
  const group = DATA && DATA.itemsByUrlKey
    ? (DATA.itemsByUrlKey.get(key) || [])
    : (DATA && DATA.items ? DATA.items.filter(item => (item.key || BM.urlKey(item.url)) === key) : []);
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
  const self = typeof bookmarkOrId === 'object'
    ? bookmarkOrId
    : (DATA.itemById ? DATA.itemById.get(bookmarkOrId) : DATA.items.find(it => it.id === bookmarkOrId));
  if (!self) return false;
  const siblings = getSameUrlSiblings(self);
  if (siblings.length <= 1) return true;
  try { await BM.loadTags(); await BM.loadFixedTags(); } catch (e) { /* noop */ }
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
  siblings.forEach(it => { changes[it.id] = union.length ? union : null; });
  try { return await BM.setTagsBatch(changes); } catch (e) { return false; }
}

// ---------- 标签管理：新建 / 重命名 / 从池删除 / 批量打标签 ----------

// 新建标签：加入固定池（若已存在或不在池则提示）
async function createTag() {
  const name = await promptDialog({ title: '➕ 新建标签', message: '输入新标签名（将加入固定标签池，AI 打标可选用）：', placeholder: '如：效率' });
  if (!name) return;
  const clean = BM.normalizeTag(name);
  if (!clean) { toast('标签名无效', 'warn'); return; }
  try { await BM.loadFixedTags(); } catch (e) { /* noop */ }
  const pool = [...(BM.getFixedTags() || [])];
  if (pool.includes(clean)) { toast('标签已存在', 'warn'); return; }
  const max = BM.MAX_FIXED_TAGS || 50;
  if (pool.length >= max) { toast('标签池已达上限（' + max + '），请先删除或重命名', 'warn'); return; }
  pool.push(clean);
  try {
    await BM.loadTagRules();
    await BM.saveSyncedTagConfiguration(
      pool.filter(tag => tag !== BM.FALLBACK_TAG), BM.getTagRules() || {}
    );
    toast('已新建标签 #' + clean + ' ✓', 'ok');
  } catch (e) { toast('新建失败：' + (e.message || e), 'danger'); }
  refresh();
}

function renameTagInRules(rules, oldName, newName) {
  const oldKey = String(oldName || '').trim().toLowerCase();
  const replaceInMap = map => Object.fromEntries(Object.entries(
    map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  ).map(([key, tags]) => [key, (Array.isArray(tags) ? tags : []).map(tag =>
    String(tag || '').trim().toLowerCase() === oldKey ? newName : tag
  )]));
  return {
    domain: replaceInMap(rules && rules.domain),
    keyword: replaceInMap(rules && rules.keyword)
  };
}

// 重命名标签：同步改池 + 所有带此标签的书签
async function renameTag(oldName) {
  const newName = await promptDialog({
    title: '✏️ 重命名标签',
    message: '将把 #' + oldName + ' 重命名为（同步修改所有书签）：',
    value: oldName,
    placeholder: '新标签名'
  });
  if (!newName || newName === oldName) return;
  const clean = BM.normalizeTag(newName);
  if (!clean) { toast('标签名无效', 'warn'); return; }
  // 1. 改固定池
  try { await BM.loadFixedTags(); } catch (e) { /* noop */ }
  const pool = [...(BM.getFixedTags() || [])];
  const idx = pool.indexOf(oldName);
  if (idx >= 0) {
    if (pool.includes(clean)) { toast('目标标签已存在', 'warn'); return; }
    pool[idx] = clean;
    try {
      await BM.loadTagRules();
      const rules = renameTagInRules(BM.getTagRules() || {}, oldName, clean);
      await BM.saveSyncedTagConfiguration(
        pool.filter(tag => tag !== BM.FALLBACK_TAG), rules
      );
    } catch (e) { /* 配置已保留在本地，下次同步重试 */ }
  }
  // 2. 改所有书签的标签
  try { await BM.loadTags(); } catch (e) { /* noop */ }
  const map = BM.getTags() || {};
  let changed = 0;
  for (const id of Object.keys(map)) {
    const arr = map[id];
    if (arr.includes(oldName)) {
      try {
        await BM.setTags(id, arr.map(t => (t === oldName ? clean : t)));
        changed++;
      } catch (e) { /* ignore */ }
    }
  }
  BM.invalidateFixedTags();
  BM.invalidateTags();
  toast('已重命名 #' + oldName + ' → #' + clean + '（' + changed + ' 个书签）✓', 'ok');
  refresh();
}

// 从固定池删除标签（书签上已有的标签保留，不再出现在标签云/建议/AI 打标）
async function removeTagFromPool(name) {
  if (name === BM.FALLBACK_TAG) { toast('「' + name + '」是兜底标签，不能删除', 'warn'); return; }
  const ok = await confirmDialog({
    title: '从固定池移除 #' + name + '？',
    message: '仅从标签池移除（不再建议/打标）。已有书签上的 #' + name + ' 标签会保留，但被视为「散落标签」，可之后收敛。',
    confirmText: '移除',
    danger: false
  });
  if (!ok) return;
  try { await BM.loadFixedTags(); } catch (e) { /* noop */ }
  const pool = [...(BM.getFixedTags() || [])].filter(t => t !== name);
  try {
    await BM.loadTagRules();
    await BM.saveSyncedTagConfiguration(
      pool.filter(tag => tag !== BM.FALLBACK_TAG), BM.getTagRules() || {}
    );
  } catch (e) { toast('移除失败：' + (e.message || e), 'danger'); return; }
  toast('已从池移除 #' + name, 'ok');
  refresh();
}

// 打开标签管理弹层（列出固定池标签）
function openTagManager() {
  const pool = (BM.getFixedTags() || []).filter(t => t !== BM.FALLBACK_TAG);
  const list = $('#tagMgrList');
  list.innerHTML = pool.map(t => {
    const count = (DATA.tagStats || {})[t] || 0;
    return `<div class="tag-mgr-row">
      <span class="tag-mgr-name">#${escapeHtml(t)}</span>
      <span class="tag-mgr-count">${count} 个书签</span>
      <div class="tag-mgr-btns">
        <button class="btn small ghost" data-mgr="rename" data-tag="${escapeHtml(t)}">✏️ 重命名</button>
        <button class="btn small ghost danger-text" data-mgr="remove" data-tag="${escapeHtml(t)}">🗑 从池移除</button>
      </div>
    </div>`;
  }).join('') || '<div class="tag-mgr-empty">固定池为空</div>';
  $('#tagMgrWrap').classList.remove('hidden');
}

// 批量打标签：选中书签 → 追加指定标签（去重、限数）
async function bulkTagSelected() {
  const sel = getSelectedIds();
  if (!sel.length) { toast('请先勾选书签', 'warn'); return; }
  const input = await promptDialog({
    title: '🏷 批量打标签',
    message: '为选中的 <b>' + sel.length + '</b> 个书签追加标签（逗号分隔，已存在的不会重复）：',
    placeholder: '开发, 工作'
  });
  if (!input) return;
  const newTags = input.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (!newTags.length) return;
  try { await BM.loadTags(); await BM.loadFixedTags(); } catch (e) { /* noop */ }
  startProgress('批量打标中');
  let done = 0;
  let failed = 0;
  for (const id of sel) {
    try {
      const cur = (BM.getTags() || {})[id] || [];
      const merged = [...new Set([...cur, ...newTags])].slice(0, BM.MAX_TAGS_PER_BOOKMARK || 6);
      if (!await BM.setTags(id, merged)) throw new Error('标签保存失败');
      if (!await unifySameUrlTags(id, merged)) throw new Error('同址标签同步失败');
    } catch (e) { failed++; }
    done++;
    updateProgress(Math.round(done / sel.length * 100), '打标 ' + done + '/' + sel.length);
  }
  endProgress();
  toast(failed
    ? '已为 ' + (sel.length - failed) + ' 个书签追加标签，' + failed + ' 个保存失败'
    : '已为 ' + sel.length + ' 个书签追加标签 ✓', failed ? 'warn' : 'ok');
  refresh();
}

// ---------- 标签收敛：把历史散落标签归并到固定池 + #其他 重新打标 ----------
async function migrateTags() {
  try { await BM.loadTags(); } catch (e) { /* noop */ }
  try { await BM.loadFixedTags(); } catch (e) { /* noop */ }
  const map = BM.getTags();
  if (!map || !Object.keys(map).length) { toast('没有标签数据', 'warn'); return; }
  const ids = Object.keys(map);
  const activeIds = ids.filter(id => !!getItemById(id));
  const staleIds = ids.filter(id => !getItemById(id));
  const changeMap = {};      // 旧标签 -> { to, n }
  const affectedIds = new Set();
  const otherIds = [];       // 被归到 #其他（兜底）的书签 id
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
  if (!affectedIds.size && !otherIds.length && !staleIds.length) { toast('所有标签都已在固定池内 ✓', 'ok'); return; }
  const total = new Set([...affectedIds, ...otherIds]).size;
  const hiddenCount = [...new Set([...affectedIds, ...otherIds])]
    .filter(id => getItemById(id) && getItemById(id).hidden).length;
  const changeList = Object.entries(changeMap).sort((a, b) => b[1].n - a[1].n);
  const preview = changeList.slice(0, 15).map(([from, c]) => `${escapeHtml(from)} → ${escapeHtml(c.to)}（${c.n}）`).join('<br>')
    + (changeList.length > 15 ? `<br>… 等共 ${changeList.length} 种标签` : '');
  let message = '';
  if (affectedIds.size) {
    message += `📌 <b>${affectedIds.size}</b> 个书签有散落标签，将归并到固定池：<br>${preview}<br>`;
  }
  if (otherIds.length) {
    // 列出 #其他 书签标题预览（最多 5）
    const otherPreview = otherIds.slice(0, 5).map(id => {
      const item = getItemById(id);
      return `· ${escapeHtml(item ? item.title : '(已删除书签)')}<span style="color:var(--muted);font-size:11px;"> — ${escapeHtml(item ? item.host : '')}</span>`;
    }).join('<br>') + (otherIds.length > 5 ? `<br>… 等 ${otherIds.length} 个` : '');
    message += `<br>⚠️ <b>${otherIds.length}</b> 个书签被归到「#${escapeHtml(BM.FALLBACK_TAG)}」（池外兜底），将用本地规则重新打标（消耗 API 即可考虑 AI 重打）：<br>${otherPreview}<br>`;
  }
  if (hiddenCount) message += `<br>👁 其中 <b>${hiddenCount}</b> 个为隐藏书签，也会一并处理。`;
  if (staleIds.length) message += `<br>🧹 将清理 <b>${staleIds.length}</b> 条已删除书签的历史标签记录。`;
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
    updateProgress(Math.round(done / operationCount * 100), '收敛 ' + done + '/' + operationCount);
  }
  // 2. #其他 书签：用本地规则重新打标（suggestTags，不消耗 API）
  for (const id of otherIds) {
    try {
      const item = getItemById(id);
      const sugg = item ? (BM.suggestTags ? BM.suggestTags({ host: item.host, url: item.url, title: item.title }) : []) : [];
      const cleaned = (map[id] || []).filter(t => t !== BM.FALLBACK_TAG);
      const newTags = [...new Set([...cleaned, ...sugg])].filter(Boolean);
      tagChanges[id] = newTags;
    } catch (e) { /* noop */ }
    done++;
    updateProgress(Math.round(done / operationCount * 100), '重打 ' + done + '/' + operationCount);
  }
  for (const id of staleIds) {
    tagChanges[id] = null;
    done++;
    updateProgress(Math.round(done / operationCount * 100), '清理 ' + done + '/' + operationCount);
  }
  let saved = false;
  try { saved = await BM.setTagsBatch(tagChanges); } catch (e) { saved = false; }
  endProgress();
  if (!saved) { toast('标签收敛保存失败，请重试', 'danger'); return; }
  toast(`标签已收敛 ✓（处理 ${total} 个书签${staleIds.length ? `，清理 ${staleIds.length} 条历史记录` : ''}）`, 'ok');
  refresh();
}

// ---------- （分类体系已精简删除：AI 分类 / 全量重分类 / 整理方案） ----------

document.addEventListener('DOMContentLoaded', init);
