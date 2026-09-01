// ===== 书签管家 · 新标签页 (newtab.js) =====
// 底层：chrome.bookmarks 原生书签（文件夹树 + 同步）
// 上层：bmTags 多标签（插件本地）→ 以标签维度展示 + 搜索
(function () {
  'use strict';
  const $ = s => document.querySelector(s);

  let DATA = null;
  let search = '';
  let activeTag = '';
  let shown = 0;
  const STEP = 200; // 每次「加载更多」数量

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeHttpUrl(rawUrl) {
    try { return window.BM.normalizeHttpUrl(rawUrl).href; } catch (e) { return ''; }
  }

  function faviconUrl(rawUrl) {
    const href = safeHttpUrl(rawUrl);
    if (!href) return '';
    return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(href) + '&size=64';
  }

  function copyBookmarkUrl(rawUrl) {
    if (!safeHttpUrl(rawUrl)) return Promise.reject(new Error('无效书签链接'));
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      return Promise.reject(new Error('当前环境不支持复制'));
    }
    return navigator.clipboard.writeText(rawUrl);
  }

  function showCopyState(button, copied) {
    const label = copied ? '已复制链接' : '复制失败';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('is-copied', copied);
    button.classList.toggle('is-copy-error', !copied);
    window.setTimeout(() => {
      button.title = '复制链接';
      button.setAttribute('aria-label', '复制链接');
      button.classList.remove('is-copied', 'is-copy-error');
    }, 1600);
  }

  function suppressHoverAfterOpen(card) {
    if (!card || !card.hasAttribute('href')) return;
    const wrap = card.closest('.nt-card-wrap');
    if (!wrap) return;
    // 鼠标点击后链接仍会保留焦点；返回新标签页时应避免焦点重新展开抽屉。
    if (typeof card.blur === 'function') card.blur();
    wrap.classList.add('nt-card-opening');
    wrap.addEventListener('mouseleave', () => {
      wrap.classList.remove('nt-card-opening');
    }, { once: true });
  }

  // 过滤 + 排序（最近添加在前）。
  // 搜索语法：
  //   - 普通词："空格分词 AND"，每词都得在 hay (title/url/host/tags) 里出现
  //   - #标签前缀：开头一个 #xxx 表示精确匹配某个标签名（可与后续文本词 AND）
  function filtered() {
    const trimmed = search.trim().toLowerCase();
    // 解析 #标签前缀
    let tagTerm = '';
    let textTerms = [];
    if (trimmed.startsWith('#')) {
      const sp = trimmed.split(/\s+/);
      tagTerm = (sp[0] || '').slice(1);
      textTerms = sp.slice(1);
    } else {
      textTerms = trimmed.split(/\s+/).filter(Boolean);
    }
    const hasSearchTerm = Boolean(tagTerm || textTerms.length);

    // 正常浏览与标签筛选隐藏书签；有效搜索条件才将匹配的隐藏项纳入结果。
    let list = DATA.items.filter(it => hasSearchTerm || !it.hidden);
    if (activeTag) list = list.filter(it => (it.tags || []).includes(activeTag));
    if (hasSearchTerm) {
      list = list.filter(it => {
        // #标签前缀：精确匹配某个标签
        if (tagTerm) {
          if (!(it.tags || []).map(t => String(t).toLowerCase()).includes(tagTerm)) return false;
        }
        // 文本词：AND 匹配 hay
        if (textTerms.length) {
          const hay = ((it.title || '') + ' ' + (it.url || '') + ' ' + (it.host || '') + ' ' + (it.tags || []).join(' ')).toLowerCase();
          if (!textTerms.every(t => hay.includes(t))) return false;
        }
        return true;
      });
    }
    return [...list].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  }

  function renderTags() {
    const stats = DATA.tagStats || {};
    const pool = new Set(window.BM.getFixedTags() || []);
    // 标签条只显示固定池内的标签（收敛；散落标签不展示）
    const entries = Object.entries(stats).filter(([t]) => pool.has(t)).sort((a, b) => b[1] - a[1]);
    const chip = (t, n, active) =>
      `<button class="nt-tag${active ? ' active' : ''}" data-tag="${esc(t)}">${t ? '#' + esc(t) : '全部'} <span class="cnt">${n}</span></button>`;
    $('#ntTags').innerHTML = chip('', DATA.items.length, !activeTag) +
      entries.map(([t, n]) => chip(t, n, activeTag === t)).join('');
  }

  function cardHtml(it) {
    const href = safeHttpUrl(it.url);
    const favicon = faviconUrl(it.url);
    const initial = esc((it.host || it.title || '?').trim().charAt(0).toUpperCase() || '?');
    const tags = (it.tags || []).map(t => `<span class="nt-card-tag">#${esc(t)}</span>`).join('');
    const hiddenBadge = it.hidden ? '<span class="nt-card-hidden">已隐藏</span>' : '';
    const hiddenLabel = it.hidden ? '取消隐藏' : '隐藏';
    const actions = `
      <div class="nt-actions" data-id="${esc(it.id)}">
        <button type="button" class="nt-action" data-nt-act="copy" title="复制链接" aria-label="复制链接">${ICON('copy')}</button>
        <button type="button" class="nt-action" data-nt-act="toggle-hidden" title="${hiddenLabel}" aria-label="${hiddenLabel}">${ICON('eye')}</button>
        <button type="button" class="nt-action" data-nt-act="edit" title="编辑" aria-label="编辑">${ICON('edit')}</button>
        <button type="button" class="nt-action danger" data-nt-act="delete" title="删除（30 天内可恢复）" aria-label="删除">${ICON('trash')}</button>
      </div>`;
    return `<div class="nt-card-wrap">
      <a class="nt-card"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ' aria-disabled="true"'} title="${esc(it.title)}">
        <span class="nt-fav" aria-hidden="true">
          <span class="nt-fav-fallback">${initial}</span>
          ${favicon ? `<img class="nt-fav-img" src="${esc(favicon)}" alt="" loading="lazy" />` : ''}
        </span>
        <div class="nt-card-body">
          <div class="nt-card-title">${esc(it.title)}</div>
          <div class="nt-card-host">${esc(it.host || '')}</div>
          <div class="nt-card-tags">${hiddenBadge}${tags || '<span class="nt-card-untagged">未打标</span>'}</div>
        </div>
      </a>${actions}
    </div>`;
  }

  // 简易 SVG icon（内联，避免依赖 popup.html 的 <symbol>）
  function ICON(name) {
    const paths = {
      eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
      save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    };
    return paths[name] || '';
  }

  function render() {
    renderTags();
    const list = filtered();
    const grid = $('#ntGrid');
    const more = $('#ntMore');
    const empty = $('#ntEmpty');
    const tagged = DATA.items.filter(i => (i.tags || []).length).length;
    $('#ntCount').textContent = DATA.total + ' 个书签 · ' + tagged + ' 已打标';
    if (!list.length) {
      grid.innerHTML = '';
      more.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    shown = Math.min(STEP, list.length);
    grid.innerHTML = list.slice(0, shown).map(cardHtml).join('');
    updateMore(list);
  }

  function updateMore(list) {
    const more = $('#ntMore');
    if (list.length <= shown) { more.innerHTML = ''; return; }
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = `加载更多（${shown}/${list.length}）`;
    btn.onclick = () => {
      const next = Math.min(shown + STEP, list.length);
      $('#ntGrid').insertAdjacentHTML('beforeend', list.slice(shown, next).map(cardHtml).join(''));
      shown = next;
      updateMore(list);
    };
    more.innerHTML = '';
    more.appendChild(btn);
  }

  // 打开侧边栏管理面板（需要用户手势）
  async function openPanel() {
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    } catch (e) {
      // 降级：打开设置页
      try { chrome.runtime.openOptionsPage(); } catch (e2) { /* noop */ }
    }
  }

  // 事件绑定
  const searchInput = $('#ntSearch');
  let timer = null;
  searchInput.addEventListener('input', () => {
    search = searchInput.value.trim().toLowerCase();
    $('#ntClear').classList.toggle('hidden', !search);
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  });
  $('#ntClear').addEventListener('click', () => {
    search = ''; searchInput.value = ''; $('#ntClear').classList.add('hidden');
    render();
  });
  // 键盘：回车直接打开第一条
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#ntGrid .nt-card');
      if (first) first.click();
    }
  });
  $('#ntTags').addEventListener('click', e => {
    const t = e.target.closest('.nt-tag');
    if (!t) return;
    activeTag = t.dataset.tag === activeTag ? '' : t.dataset.tag; // 再点取消
    render();
  });
  $('#ntOpenPanel').addEventListener('click', openPanel);

  $('#ntGrid').addEventListener('click', e => {
    suppressHoverAfterOpen(e.target.closest('.nt-card'));
  });
  $('#ntGrid').addEventListener('auxclick', e => {
    if (e.button === 1) suppressHoverAfterOpen(e.target.closest('.nt-card'));
  });

  $('#ntGrid').addEventListener('error', e => {
    const img = e.target.closest && e.target.closest('.nt-fav-img');
    if (img) img.classList.add('is-error');
  }, true);

  // 卡片操作按钮（事件委托）：👁 隐藏 / ✏️ 编辑 / 🗑 删除
  $('#ntGrid').addEventListener('click', async e => {
    const btn = e.target.closest('[data-nt-act]');
    if (!btn) return;
    e.preventDefault(); // 阻止冒泡到卡片（避免打开 URL）
    e.stopPropagation();
    const id = btn.closest('.nt-actions').dataset.id;
    const it = (DATA.items || []).find(x => String(x.id) === String(id));
    if (!it) return;
    const act = btn.dataset.ntAct;
    if (act === 'copy') {
      try { await copyBookmarkUrl(it.url); showCopyState(btn, true); }
      catch (err) { showCopyState(btn, false); }
    } else if (act === 'toggle-hidden') {
      await window.BM.toggleHidden(it.id);
      // 实时刷新：onChanged 监听会自动重 analyze（但为即时反馈也可手动 render）
      render();
    } else if (act === 'edit') {
      openInlineEditor(it, btn.closest('.nt-card-wrap'));
    } else if (act === 'delete') {
      await softDeleteBookmark(it);
    }
  });

  // 软删除：加入收藏站 + 从 Chrome 移除
  async function softDeleteBookmark(it) {
    try {
      // 拿一下父级信息（回收站需要 parentId/title 等）
      const bm = await chrome.bookmarks.get(it.id).catch(() => null);
      const trashItem = {
        id: it.id, title: it.title, url: it.url,
        parentId: bm && bm[0] ? bm[0].parentId : undefined
      };
      const added = await window.BM.addToTrash([trashItem], { deletionPending: true });
      if (added !== 1) throw new Error('未能完整写入回收站');
      try {
        await chrome.bookmarks.remove(it.id);
      } catch (e) {
        try { await window.BM.completeTrashDelete([], [it.id]); } catch { /* 保留保护记录 */ }
        throw e;
      }
      try { await window.BM.completeTrashDelete([it.id], []); } catch { /* 保留保护记录 */ }
      // 清掉本地 tags 缓存（防引用）
      try { await window.BM.setTags(it.id, []); } catch (e) { /* noop */ }
      // 立即刷新
      DATA = await window.BMAnalyzer.analyze();
      render();
      showToast('已移入回收站（30 天内可在侧边栏「概览」中恢复）');
    } catch (e) {
      showToast('删除失败：' + (e.message || e), true);
    }
  }

  // Toast 简易提示
  function showToast(msg, danger) {
    const t = document.createElement('div');
    t.className = 'nt-toast' + (danger ? ' danger' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('nt-toast-out'); setTimeout(() => t.remove(), 220); }, 1800);
  }

  // Inline 编辑浮层（标题/URL/标签），不离开 New Tab
  function openInlineEditor(it, wrap) {
    if (!wrap) return;
    wrap.classList.add('editing');
    const tagsStr = (it.tags || []).join(', ');
    wrap.innerHTML = `
      <div class="nt-edit">
        <div class="nt-edit-row">
          <label>📝 标题</label>
          <input class="nt-edit-title" type="text" value="${esc(it.title)}" />
        </div>
        <div class="nt-edit-row">
          <label>🔗 URL</label>
          <input class="nt-edit-url" type="text" value="${esc(it.url)}" />
        </div>
        <div class="nt-edit-row">
          <label>🏷️ 标签（逗号分隔）</label>
          <input class="nt-edit-tags" type="text" value="${esc(tagsStr)}" placeholder="开发, github, 工作" />
        </div>
        <div class="nt-edit-actions">
          <button class="nt-edit-btn ghost" data-edit-act="cancel">${ICON('close')} 取消</button>
          <button class="nt-edit-btn primary" data-edit-act="save">${ICON('save')} 保存</button>
        </div>
      </div>`;
    // 保存
    wrap.querySelector('[data-edit-act="save"]').onclick = async () => {
      const newTitle = wrap.querySelector('.nt-edit-title').value.trim();
      const newUrl = wrap.querySelector('.nt-edit-url').value.trim();
      const newTags = wrap.querySelector('.nt-edit-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      try {
        if (newTitle && newTitle !== it.title) await chrome.bookmarks.update(it.id, { title: newTitle });
        if (newUrl && newUrl !== it.url) {
          await chrome.bookmarks.update(it.id, { url: window.BM.normalizeHttpUrl(newUrl).href });
        }
        await window.BM.setTags(it.id, newTags);
        DATA = await window.BMAnalyzer.analyze();
        render();
        showToast('已保存 ✓');
      } catch (e) {
        showToast('保存失败：' + (e.message || e), true);
      }
    };
    wrap.querySelector('[data-edit-act="cancel"]').onclick = () => render();
  }

  // 实时同步：侧边栏里隐藏/打标/收敛标签后，已打开的 New Tab 自动刷新（防抖 300ms）
  let syncTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = ['bmTags', 'bmHiddenIds', 'bmFixedTags', 'bmTagRules'];
    if (!keys.some(k => changes[k])) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        window.BM.invalidateTags && window.BM.invalidateTags();
        window.BM.invalidateHiddenIds && window.BM.invalidateHiddenIds();
        window.BM.invalidateFixedTags && window.BM.invalidateFixedTags();
        window.BM.invalidateTagRules && window.BM.invalidateTagRules();
        DATA = await window.BMAnalyzer.analyze();
        render();
      } catch (e) { /* 忽略同步失败 */ }
    }, 300);
  });

  // 初始化：加载配置 + 分析书签
  (async function init() {
    let tagConfigurationSyncReady = true;
    try { await window.BM.initializeSyncedTagConfiguration(); }
    catch (e) { tagConfigurationSyncReady = false; }
    try {
      window.BM.watchTagConfiguration && window.BM.watchTagConfiguration(() => {
        window.BM.invalidateFixedTags && window.BM.invalidateFixedTags();
        window.BM.invalidateTagRules && window.BM.invalidateTagRules();
        setTimeout(async () => {
          try { DATA = await window.BMAnalyzer.analyze(); render(); } catch (e) { /* ignore */ }
        }, 300);
      });
    } catch (e) { /* 保留本地标签配置 */ }
    if (tagConfigurationSyncReady) {
      try { await window.BM.pullTagsFromCloud(); } catch (e) { /* 保留本地标签 */ }
      try {
        window.BM.watchTagSync && window.BM.watchTagSync(() => {
          window.BM.invalidateTags && window.BM.invalidateTags();
          setTimeout(async () => {
            try { DATA = await window.BMAnalyzer.analyze(); render(); } catch (e) { /* ignore */ }
          }, 300);
        });
      } catch (e) { /* noop */ }
    }
    try { await window.BM.loadTags(); } catch (e) { /* 无标签 */ }
    try { await window.BM.loadFixedTags(); } catch (e) { /* 默认池 */ }
    try { await window.BM.loadTagRules(); } catch (e) { /* 无自定义规则 */ }
    try {
      DATA = await window.BMAnalyzer.analyze();
      render();
      searchInput.focus();
    } catch (e) {
      $('#ntEmpty').classList.remove('hidden');
      $('#ntEmptyTitle').textContent = '读取书签失败';
      $('#ntEmptyDesc').textContent = (e && e.message) || String(e);
      console.error('[书签管家] newtab 初始化失败', e);
    }
  })();
})();
