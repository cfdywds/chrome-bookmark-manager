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
  const INITIAL_TAG_SYNC_WAIT_MS = 1200;

  function waitForInitialTagSync(task) {
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ timedOut: true }), INITIAL_TAG_SYNC_WAIT_MS);
      task.then(finish, () => finish({ failed: true }));
    });
  }

  // ---- 新标签页外观（设置页「新标签页外观」）----
  const NT_APPEARANCE_KEY = 'bmNewtabAppearance';
  // 颜色变量由 newtab.css 按 data-nt-theme 维护（消除 JS/CSS 双份调色板）
  const NT_DEFAULT_BG = '#0f1117';
  const NT_WIDTHS = ['1080', '1440', '1720', '2560', 'auto'];

  function hexLuma(hex) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return 255; // 非法 → 当作亮色
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 应用外观：注入 --nt-maxw 与主题标记；theme='auto' 时还原为系统（移除覆盖）
  function applyAppearance(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const width = NT_WIDTHS.indexOf(raw.width) >= 0 ? raw.width : '1080';
    const theme = ['auto', 'light', 'dark', 'custom'].indexOf(raw.theme) >= 0 ? raw.theme : 'auto';
    const bg = /^#[0-9a-fA-F]{6}$/.test(String(raw.bg || ''))
      ? String(raw.bg).toLowerCase()
      : NT_DEFAULT_BG;
    const root = document.documentElement;

    // 1) 内容区宽度
    root.style.setProperty('--nt-maxw', width === 'auto' ? 'none' : width + 'px');

    // 2) 主题：先摘除旧标记与旧自定义底色，再按主题设置（变量由 CSS 维护）
    root.removeAttribute('data-nt-theme');
    root.style.removeProperty('--bg');
    if (theme === 'auto') return; // 交给 @media (prefers-color-scheme)

    if (theme === 'custom') {
      root.style.setProperty('--bg', bg);
      root.setAttribute('data-nt-theme', hexLuma(bg) < 128 ? 'dark' : 'light');
    } else {
      root.setAttribute('data-nt-theme', theme);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHttpUrl(rawUrl) {
    try {
      return window.BM.normalizeHttpUrl(rawUrl).href;
    } catch (e) {
      return '';
    }
  }

  function faviconUrl(rawUrl) {
    const href = safeHttpUrl(rawUrl);
    if (!href) return '';
    return (
      chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(href) + '&size=64'
    );
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
    wrap.addEventListener(
      'mouseleave',
      () => {
        wrap.classList.remove('nt-card-opening');
      },
      { once: true }
    );
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
          const hay = (
            (it.title || '') +
            ' ' +
            (it.url || '') +
            ' ' +
            (it.host || '') +
            ' ' +
            (it.tags || []).join(' ')
          ).toLowerCase();
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
    const entries = Object.entries(stats)
      .filter(([t]) => pool.has(t))
      .sort((a, b) => b[1] - a[1]);
    const chip = (t, n, active) =>
      `<button class="nt-tag${active ? ' active' : ''}" data-tag="${esc(t)}" aria-pressed="${active ? 'true' : 'false'}">${t ? '#' + esc(t) : '全部'} <span class="cnt">${n}</span></button>`;
    $('#ntTags').innerHTML =
      chip('', DATA.items.length, !activeTag) +
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
      trash:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
      save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
      close:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      sparkles:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>'
    };
    return paths[name] || '';
  }

  function render() {
    renderTags();
    const list = filtered();
    const grid = $('#ntGrid');
    const more = $('#ntMore');
    const empty = $('#ntEmpty');
    const loading = $('#ntLoading');
    if (loading) loading.classList.add('hidden');
    // 搜索/标签筛选时在搜索框内实时显示结果数（吸顶区始终可见）
    const resultCount = $('#ntResultCount');
    if (resultCount) {
      const filtering = Boolean(search.trim() || activeTag);
      resultCount.classList.toggle('hidden', !filtering);
      resultCount.textContent = filtering ? list.length + ' 个结果' : '';
    }
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
    if (list.length <= shown) {
      more.innerHTML = '';
      return;
    }
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
      try {
        chrome.runtime.openOptionsPage();
      } catch (e2) {
        /* noop */
      }
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
    search = '';
    searchInput.value = '';
    $('#ntClear').classList.add('hidden');
    render();
  });
  // 键盘：回车直接打开第一条
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#ntGrid .nt-card');
      if (first) first.click();
    }
  });
  // 全局快捷键：/ 聚焦搜索（与侧边栏一致）；Esc 清空搜索
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && search) {
      search = '';
      searchInput.value = '';
      $('#ntClear').classList.add('hidden');
      render();
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
    }
  });
  $('#ntTags').addEventListener('click', e => {
    const t = e.target.closest('.nt-tag');
    if (!t) return;
    activeTag = t.dataset.tag === activeTag ? '' : t.dataset.tag; // 再点取消
    render();
  });
  $('#ntOpenPanel').addEventListener('click', openPanel);

  // 搜索框滚动悬浮：越过顶栏后加深阴影提示已固定（IntersectionObserver，无滚动抖动）
  const searchBar = $('.nt-search');
  if (searchBar && typeof IntersectionObserver === 'function') {
    const sentinel = document.createElement('div');
    sentinel.className = 'nt-sticky-sentinel';
    searchBar.parentNode.insertBefore(sentinel, searchBar);
    new IntersectionObserver(
      entries => {
        searchBar.classList.toggle('is-stuck', !(entries[0] && entries[0].isIntersecting));
      },
      { threshold: 0 }
    ).observe(sentinel);
  }

  $('#ntGrid').addEventListener('click', e => {
    suppressHoverAfterOpen(e.target.closest('.nt-card'));
  });
  $('#ntGrid').addEventListener('auxclick', e => {
    if (e.button === 1) suppressHoverAfterOpen(e.target.closest('.nt-card'));
  });

  $('#ntGrid').addEventListener(
    'error',
    e => {
      const img = e.target.closest && e.target.closest('.nt-fav-img');
      if (img) img.classList.add('is-error');
    },
    true
  );

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
      try {
        await copyBookmarkUrl(it.url);
        showCopyState(btn, true);
      } catch (err) {
        showCopyState(btn, false);
      }
    } else if (act === 'toggle-hidden') {
      const wasHidden = it.hidden;
      await window.BM.toggleHidden(it.id);
      render();
      if (!wasHidden) {
        showToast('已隐藏书签', false, {
          label: '撤销',
          onClick: async () => {
            await window.BM.toggleHidden(it.id);
            DATA = await window.BMAnalyzer.analyze();
            render();
          }
        });
      } else {
        showToast('已取消隐藏 ✓', false);
      }
    } else if (act === 'edit') {
      openInlineEditor(it, btn.closest('.nt-card-wrap'));
    } else if (act === 'delete') {
      await softDeleteBookmark(it);
    }
  });

  // 轻量确认弹层：对齐侧边栏的确认交互，避免删除误触
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const wrap = $('#ntConfirmWrap');
      if (!wrap) {
        resolve(false);
        return;
      }
      const restoreFocusTo = document.activeElement;
      $('#ntConfirmTitle').textContent = opts.title || '确认操作？';
      $('#ntConfirmMsg').innerHTML = opts.message || '';
      const yes = $('#ntConfirmYes');
      const no = $('#ntConfirmNo');
      yes.textContent = opts.confirmText || '确认';
      yes.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
      wrap.classList.remove('hidden');
      const trapTab = e => {
        if (e.key !== 'Tab') return;
        const list = [yes, no].filter(x => x && x.offsetParent !== null);
        if (!list.length) return;
        if (e.shiftKey && document.activeElement === list[0]) {
          e.preventDefault();
          list[list.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) {
          e.preventDefault();
          list[0].focus();
        }
      };
      const onKey = e => {
        if (e.key === 'Escape') {
          done(false);
          return;
        }
        if (e.key === 'Enter' && e.target !== yes && e.target !== no) {
          done(true);
          return;
        }
        trapTab(e);
      };
      const onWrapClick = e => {
        if (e.target === wrap) done(false);
      };
      const done = v => {
        wrap.classList.add('hidden');
        yes.onclick = no.onclick = null;
        document.removeEventListener('keydown', onKey);
        wrap.removeEventListener('click', onWrapClick);
        if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
        resolve(v);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', onWrapClick);
      yes.focus();
    });
  }

  // 软删除：加入收藏站 + 从 Chrome 移除
  async function softDeleteBookmark(it) {
    try {
      const ok = await confirmDialog({
        title: '移入回收站？',
        message: `「${esc(it.title)}」将移入回收站，30 天内可恢复。`,
        confirmText: '移入回收站'
      });
      if (!ok) return;
      // 拿一下父级信息（回收站需要 parentId/title 等）
      const bm = await chrome.bookmarks.get(it.id).catch(() => null);
      const trashItem = {
        id: it.id,
        title: it.title,
        url: it.url,
        parentId: bm && bm[0] ? bm[0].parentId : undefined
      };
      const added = await window.BM.addToTrash([trashItem], { deletionPending: true });
      if (added !== 1) throw new Error('未能完整写入回收站');
      try {
        await chrome.bookmarks.remove(it.id);
      } catch (e) {
        try {
          await window.BM.completeTrashDelete([], [it.id]);
        } catch {
          /* 保留保护记录 */
        }
        throw e;
      }
      try {
        await window.BM.completeTrashDelete([it.id], []);
      } catch {
        /* 保留保护记录 */
      }
      // 清掉本地 tags 缓存（防引用）
      try {
        await window.BM.setTags(it.id, []);
      } catch (e) {
        /* noop */
      }
      // 立即刷新
      DATA = await window.BMAnalyzer.analyze();
      render();
      showToast('已移入回收站 · 30 天内可恢复', false, {
        label: '撤销',
        onClick: async () => {
          try {
            const r = await window.BM.restoreTrashItems([{ id: it.id }]);
            showToast(
              r.restored ? '已恢复书签 ✓' : '恢复失败：该记录可能已被永久删除',
              !r.restored
            );
            DATA = await window.BMAnalyzer.analyze();
            render();
          } catch (err) {
            showToast('恢复失败：' + (err.message || err), true);
          }
        }
      });
    } catch (e) {
      showToast('删除失败：' + (e.message || e), true);
    }
  }

  // Toast 简易提示（可附带撤销等动作按钮）
  function showToast(msg, danger, action) {
    const t = document.createElement('div');
    t.className = 'nt-toast' + (danger ? ' danger' : '');
    t.setAttribute('role', danger ? 'alert' : 'status');
    t.setAttribute('aria-live', danger ? 'assertive' : 'polite');
    const txt = document.createElement('span');
    txt.textContent = msg;
    t.appendChild(txt);
    if (action && action.label && typeof action.onClick === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nt-toast-act';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        t.remove();
        action.onClick();
      });
      t.appendChild(btn);
    }
    document.body.appendChild(t);
    const hold = action ? 8000 : 2200;
    setTimeout(() => {
      t.classList.add('nt-toast-out');
      setTimeout(() => t.remove(), 220);
    }, hold);
  }

  // Inline 编辑浮层（标题/URL/标签 + AI 打标），不离开 New Tab
  function openInlineEditor(it, wrap) {
    if (!wrap) return;
    wrap.classList.add('editing');
    const tagsStr = (it.tags || []).join(', ');
    wrap.innerHTML = `
      <div class="nt-edit">
        <div class="nt-edit-row">
          <label>标题</label>
          <input class="nt-edit-title" type="text" value="${esc(it.title)}" />
        </div>
        <div class="nt-edit-row">
          <label>URL</label>
          <input class="nt-edit-url" type="text" value="${esc(it.url)}" />
        </div>
        <div class="nt-edit-row">
          <label>标签（逗号分隔）</label>
          <div class="nt-edit-tags-line">
            <input class="nt-edit-tags" type="text" value="${esc(tagsStr)}" placeholder="开发, github, 工作" />
            <button type="button" class="nt-edit-btn ghost nt-edit-ai" data-edit-act="ai" title="AI 从固定标签池中挑 1-3 个标签（需在设置页配置 AI 服务）">${ICON('sparkles')}<span class="nt-edit-ai-label">AI 打标</span></button>
          </div>
        </div>
        <div class="nt-edit-actions">
          <button class="nt-edit-btn ghost" data-edit-act="cancel">${ICON('close')} 取消</button>
          <button class="nt-edit-btn primary" data-edit-act="save">${ICON('save')} 保存</button>
        </div>
      </div>`;
    // AI 打标：结果填入标签输入框，用户确认后点「保存」落盘
    wrap.querySelector('[data-edit-act="ai"]').onclick = () => {
      aiTagIntoEditor(it, wrap.querySelector('[data-edit-act="ai"]'), wrap.querySelector('.nt-edit-tags'));
    };
    // 保存
    wrap.querySelector('[data-edit-act="save"]').onclick = async () => {
      const newTitle = wrap.querySelector('.nt-edit-title').value.trim();
      const newUrl = wrap.querySelector('.nt-edit-url').value.trim();
      const newTags = wrap
        .querySelector('.nt-edit-tags')
        .value.split(/[,，]/)
        .map(s => s.trim())
        .filter(Boolean);
      try {
        if (newTitle && newTitle !== it.title)
          await chrome.bookmarks.update(it.id, { title: newTitle });
        if (newUrl && newUrl !== it.url) {
          const normalizedUrl = window.BM.normalizeHttpUrl(newUrl).href;
          await chrome.bookmarks.update(it.id, { url: normalizedUrl });
          await window.BM.migrateTagSyncUrl(it.id, it.url, normalizedUrl);
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

  // 编辑器内单条 AI 打标：与主界面同一套 lib.js 能力（固定标签池 + 隐私脱敏 + 高敏站点保护）
  async function aiTagIntoEditor(it, btn, tagsInput) {
    if (!btn || !tagsInput) return;
    if (btn.disabled) return;
    // 1) 读取 AI 配置（与设置页同一份 bmSettings）
    let cfg = {};
    try {
      const r = await chrome.storage.local.get('bmSettings');
      cfg = Object.assign({ provider: 'deepseek', baseUrl: '', apiKey: '', model: '' }, r.bmSettings || {});
    } catch (e) {
      /* 保持空配置 */
    }
    const p = (window.BM.PROVIDERS || {})[cfg.provider];
    if (p && !cfg.baseUrl) cfg.baseUrl = p.base;
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      showToast('还没有配置 AI 服务：请先到设置页填写接口地址、API Key 和模型名', true);
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    // 2) 资格检查：仅普通网页；高风险敏感站点不发 AI
    if (!window.BM.isHttpUrl(it.url)) {
      showToast('仅支持普通网页（http/https）', true);
      return;
    }
    const meta = window.BM.getBookmarkMetadata ? window.BM.getBookmarkMetadata(it.url, it.title) : null;
    if (meta && (meta.sensitive || []).some(s => s.sev === 'high')) {
      showToast('该站点为高风险敏感站点，已自动保护，不发送给 AI', true);
      return;
    }
    let hasPerm = false;
    try {
      hasPerm = await window.BM.hasLlmHostPermission(cfg.baseUrl);
    } catch (e) {
      showToast('LLM 配置无效：' + (e.message || e), true);
      return;
    }
    if (!hasPerm) {
      showToast('请先在设置中保存配置并授予该 LLM 服务访问权限', true);
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* noop */
      }
      return;
    }
    // 3) 请求 AI（单条；LLM 失败时 lib 会先通过 onBatch 降级返回本地规则标签）
    const label = btn.querySelector('.nt-edit-ai-label');
    const oldLabel = label ? label.textContent : '';
    btn.disabled = true;
    if (label) label.textContent = 'AI 打标中…';
    let batchMap = {};
    try {
      const map = await window.BM.aiTagBatched([it], cfg, {
        batchSize: 1,
        retries: 1,
        onBatch: async m => {
          batchMap = m || {};
        }
      });
      if (map && Object.keys(map).length) batchMap = map;
    } catch (e) {
      if (!Object.keys(batchMap).length) {
        showToast('AI 打标失败：' + (e.message || e), true);
        return;
      }
      showToast('AI 服务失败，已使用本地规则标签 ✓');
    } finally {
      btn.disabled = false;
      if (label) label.textContent = oldLabel;
    }
    const tags = batchMap[String(it.id)] || [];
    if (!tags.length) {
      showToast('未获得有效标签，请重试', true);
      return;
    }
    tagsInput.value = tags.join(', ');
    tagsInput.focus();
    showToast('标签已填入，点「保存」生效 ✓');
  }

  // 实时同步：侧边栏里隐藏/打标/收敛标签后，已打开的 New Tab 自动刷新（防抖 300ms）
  let syncTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // 外观配置变化 → 即时应用（无需重开新标签页）
    if (changes[NT_APPEARANCE_KEY]) {
      applyAppearance(changes[NT_APPEARANCE_KEY].newValue);
    }
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
      } catch (e) {
        /* 忽略同步失败 */
      }
    }, 300);
  });

  // 初始化：加载配置 + 分析书签
  (async function init() {
    // 版本号：直接读 manifest，保证与实际安装版本一致
    try {
      $('#ntVersion').textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (e) {
      /* noop */
    }
    const tagConfigurationTask = window.BM.initializeSyncedTagConfiguration()
      .then(changed => ({ changed: !!changed, failed: false }))
      .catch(() => ({ changed: false, failed: true }));
    await waitForInitialTagSync(tagConfigurationTask);
    // 应用外观配置（宽度/主题/自定义背景）——最先执行，避免闪烁
    try {
      const r = await chrome.storage.local.get(NT_APPEARANCE_KEY);
      applyAppearance(r[NT_APPEARANCE_KEY]);
    } catch (e) {
      /* 保持默认外观 */
    }
    try {
      await window.BM.loadTags();
    } catch (e) {
      /* 无标签 */
    }
    try {
      await window.BM.loadFixedTags();
    } catch (e) {
      /* 默认池 */
    }
    try {
      await window.BM.loadTagRules();
    } catch (e) {
      /* 无自定义规则 */
    }
    try {
      DATA = await window.BMAnalyzer.analyze();
      render();
      searchInput.focus();
    } catch (e) {
      const loading = $('#ntLoading');
      if (loading) loading.classList.add('hidden');
      $('#ntEmpty').classList.remove('hidden');
      $('#ntEmptyTitle').textContent = '读取书签失败';
      $('#ntEmptyDesc').textContent = (e && e.message) || String(e);
      console.error('[书签管家] newtab 初始化失败', e);
    }
    // 首屏已展示后再做一次标签拉取。初始化任务若仍在后台队列中，完成后会在此继续。
    void tagConfigurationTask
      .then(async result => {
        if (result.failed) return;
        const changed = await window.BM.pullTagsFromCloud();
        if (!changed || !DATA) return;
        window.BM.invalidateTags && window.BM.invalidateTags();
        DATA = await window.BMAnalyzer.analyze();
        render();
      })
      .catch(() => {});
  })();
})();
