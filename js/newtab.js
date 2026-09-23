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

  // ---- 视图模式 / 文件夹筛选 / 键盘导航状态 ----
  const NT_VIEW_KEY = 'bmNewtabView'; // 视图模式持久化键
  const NT_VIEWS = ['grid', 'list']; // 卡片网格 | 紧凑列表
  const VIRTUALIZE_AT = 200; // 结果超过此数量时启用 content-visibility 虚拟化
  let viewMode = 'grid';
  let activeFolder = ''; // 文件夹筛选（folderTree.folderById 的 id）
  let kbIndex = -1; // 键盘高亮位置（当前渲染出的卡片/行序号）
  const pendingHidden = new Map();
  const pendingDeletes = new Set();
  const completedDeletes = new Set();
  const finalizeDeletes = new Map();

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
    // 提示统一走 data-tip（由 js/ui.js 的 tooltip 呈现），不再使用原生 title
    button.setAttribute('data-tip', label);
    button.setAttribute('aria-label', label);
    button.classList.toggle('is-copied', copied);
    button.classList.toggle('is-copy-error', !copied);
    window.setTimeout(() => {
      button.setAttribute('data-tip', '复制链接');
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
  // folderId 为文件夹筛选（含全部后代文件夹），与搜索/标签筛选是 AND 关系
  function filtered(folderId) {
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
    // 文件夹筛选：命中该文件夹及其全部后代文件夹中的书签
    if (folderId) {
      const byId = (DATA.folderTree && DATA.folderTree.folderById) || new Map();
      const ids = new Set([String(folderId)]);
      const pending = [String(folderId)];
      while (pending.length) {
        const node = byId.get(pending.pop());
        if (!node) continue;
        for (const child of node.childFolders || []) {
          if (child && !ids.has(String(child.id))) {
            ids.add(String(child.id));
            pending.push(String(child.id));
          }
        }
      }
      list = list.filter(it => ids.has(String(it.parentId)));
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
    // favicon 兜底底色：域名哈希出稳定色相，父元素以 CSS 变量传递（.nt-fav-fallback 不新增属性）
    const seed = String(it.host || it.url || it.title || '');
    let hue = 0;
    for (let i = 0; i < seed.length; i += 1) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
    const tagList = it.tags || [];
    // 卡片高度自适应，标签全部展开（不折叠成「+N」）；列表视图列宽固定，仍保留 2 + 余数
    const chips = tagList.map(t => `<span class="nt-tag-chip">#${esc(t)}</span>`).join('');
    const hiddenBadge = it.hidden ? '<span class="nt-card-hidden">已隐藏</span>' : '';
    const hiddenLabel = it.hidden ? '取消隐藏' : '隐藏';
    const actions = `
      <div class="nt-actions" data-id="${esc(it.id)}">
        <button type="button" class="nt-action" data-nt-act="copy" data-tip="复制链接" aria-label="复制链接">${ICON('copy')}</button>
        <button type="button" class="nt-action" data-nt-act="toggle-hidden" data-tip="${hiddenLabel}" aria-label="${hiddenLabel}">${ICON('eye')}</button>
        <button type="button" class="nt-action" data-nt-act="edit" data-tip="编辑" aria-label="编辑">${ICON('edit')}</button>
        <button type="button" class="nt-action danger" data-nt-act="delete" data-tip="删除（30 天内可恢复）" aria-label="删除">${ICON('trash')}</button>
      </div>`;
    return `<div class="nt-card-wrap" id="nt-card-${esc(it.id)}" data-nt-id="${esc(it.id)}" role="option" aria-selected="false">
      <a class="nt-card"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ' aria-disabled="true"'} data-tip="${esc(it.title)}">
        <span class="nt-fav" aria-hidden="true" style="--fav-hue: ${hue}">
          <span class="nt-fav-fallback">${initial}</span>
          ${favicon ? `<img class="nt-fav-img" src="${esc(favicon)}" alt="" loading="lazy" />` : ''}
        </span>
        <div class="nt-card-body">
          <div class="nt-card-title">${esc(it.title)}</div>
          <div class="nt-card-host">${esc(it.host || '')}</div>
          <div class="nt-card-tags">${hiddenBadge}${chips || '<span class="nt-card-untagged">未打标</span>'}</div>
        </div>
      </a>${actions}
    </div>`;
  }

  // 紧凑列表行：单行承载 标题 / 站点 / 目录 / 标签 四列，列宽固定保证跨行对齐，
  // 行高 28px（卡片 112px）；「找书签」的信息密度是列表视图存在的理由。
  function rowHtml(it) {
    const href = safeHttpUrl(it.url);
    const favicon = faviconUrl(it.url);
    const initial = esc((it.host || it.title || '?').trim().charAt(0).toUpperCase() || '?');
    const seed = String(it.host || it.url || it.title || '');
    let hue = 0;
    for (let i = 0; i < seed.length; i += 1) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
    const tagList = it.tags || [];
    // 列表列宽固定，标签最多 2 个 + 余数，避免撑破列宽导致跨行错位
    const chips =
      tagList.slice(0, 2).map(t => `<span class="nt-tag-chip">#${esc(t)}</span>`).join('') +
      (tagList.length > 2 ? `<span class="nt-tag-chip more">+${tagList.length - 2}</span>` : '');
    const tagsHtml = chips || '<span class="nt-row-untagged">未打标</span>';
    // 目录取路径末两级，并去掉首段（书签栏/其他书签这类根容器对每一行都相同）：
    // 卡片给不出这个信息，用来区分「同名不同夹」的重复书签。
    const rel = (it.path || []).slice(1);
    const folder = (rel.length ? rel : it.path || []).slice(-2).join(' / ');
    const hiddenLabel = it.hidden ? '取消隐藏' : '隐藏';
    const actions = `
      <div class="nt-actions" data-id="${esc(it.id)}">
        <button type="button" class="nt-action" data-nt-act="copy" data-tip="复制链接" aria-label="复制链接">${ICON('copy')}</button>
        <button type="button" class="nt-action" data-nt-act="toggle-hidden" data-tip="${hiddenLabel}" aria-label="${hiddenLabel}">${ICON('eye')}</button>
        <button type="button" class="nt-action" data-nt-act="edit" data-tip="编辑" aria-label="编辑">${ICON('edit')}</button>
        <button type="button" class="nt-action danger" data-nt-act="delete" data-tip="删除（30 天内可恢复）" aria-label="删除">${ICON('trash')}</button>
      </div>`;
    return `<div class="nt-card-wrap nt-row" id="nt-card-${esc(it.id)}" data-nt-id="${esc(it.id)}" role="option" aria-selected="false">
      <a class="nt-row-link"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ' aria-disabled="true"'} data-tip="${esc(it.title)}">
        <span class="nt-fav" aria-hidden="true" style="--fav-hue: ${hue}">
          <span class="nt-fav-fallback">${initial}</span>
          ${favicon ? `<img class="nt-fav-img" src="${esc(favicon)}" alt="" loading="lazy" />` : ''}
        </span>
        <span class="nt-row-title">${esc(it.title)}</span>
        <span class="nt-row-meta">
          <span class="nt-row-host">${esc(it.host || '')}</span>
          <span class="nt-row-folder" data-tip="${esc((it.path || []).join(' / '))}">${esc(folder)}</span>
          <span class="nt-row-tags">${tagsHtml}${it.hidden ? '<span class="nt-row-hidden">已隐藏</span>' : ''}</span>
        </span>
      </a>${actions}
    </div>`;
  }

  // 图标统一引用外链雪碧图 icons/sprite.svg（不再内联 path）
  function ICON(name) {
    const ids = {
      eye: 'i-eye',
      copy: 'i-copy',
      edit: 'i-edit',
      trash: 'i-trash',
      save: 'i-save',
      close: 'i-x',
      sparkles: 'i-sparkles',
      list: 'i-list',
      grid: 'i-grid',
      folder: 'i-folder',
      search: 'i-search',
      globe: 'i-globe',
      alert: 'i-alert'
    };
    const id = ids[name];
    if (!id) return '';
    return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="icons/sprite.svg#${id}"/></svg>`;
  }

  function render() {
    // DATA 就绪前（首次 analyze 进行中）直接返回：打开新标签页后用户可以立刻在搜索框打字，
    // 输入会触发 render（input 事件防抖 150ms），此时 DATA 仍为 null；analyze 完成后 init() 会再渲染一次
    if (!DATA) return;
    renderTags();
    renderFolders();
    const list = filtered(activeFolder);
    const grid = $('#ntGrid');
    const more = $('#ntMore');
    const empty = $('#ntEmpty');
    const loading = $('#ntLoading');
    if (loading) loading.classList.add('hidden');
    const isList = viewMode === 'list';
    grid.classList.toggle('is-list', isList);
    // >200 条时启用 content-visibility（零依赖虚拟化，Chrome 原生支持）
    grid.classList.toggle('is-virt', list.length > VIRTUALIZE_AT);
    // 搜索/标签/文件夹筛选时在搜索框内实时显示结果数与「清除筛选」入口（吸顶区始终可见）
    const filtering = hasActiveFilters();
    const resultCount = $('#ntResultCount');
    if (resultCount) {
      resultCount.classList.toggle('hidden', !filtering);
      resultCount.textContent = filtering ? list.length + ' 个结果' : '';
    }
    // 「清除筛选」与「清空搜索」互斥显示：clearAllFilters 已经把搜索词一并清掉，
    // 两者同时出现会在搜索框右侧并排两个叉，看着重复。
    // 有标签/文件夹筛选时统一交给「清除筛选」（它清得更全），只有搜索词时才单独给「清空搜索」。
    const scopedFiltering = Boolean(activeTag || activeFolder);
    const filterClear = $('#ntFilterClear');
    if (filterClear) filterClear.classList.toggle('hidden', !scopedFiltering);
    const searchClear = $('#ntClear');
    if (searchClear) searchClear.classList.toggle('hidden', !search || scopedFiltering);
    const tagged = DATA.items.filter(i => (i.tags || []).length).length;
    $('#ntCount').textContent = DATA.total + ' 个书签 · ' + tagged + ' 已打标';
    if (!list.length) {
      grid.innerHTML = '';
      more.innerHTML = '';
      kbIndex = -1;
      grid.removeAttribute('aria-activedescendant');
      empty.classList.remove('hidden');
      const emptyTitle = $('#ntEmptyTitle');
      const emptyDesc = $('#ntEmptyDesc');
      if (emptyTitle) emptyTitle.textContent = '没有匹配的书签';
      if (emptyDesc)
        emptyDesc.textContent = activeFolder
          ? '当前文件夹下没有符合筛选条件的书签，换个文件夹或清空筛选条件'
          : '换个关键词，或清空筛选条件';
      return;
    }
    empty.classList.add('hidden');
    shown = Math.min(STEP, list.length);
    grid.innerHTML = list.slice(0, shown).map(itemHtml).join('');
    syncKbHighlight();
    updateMore(list);
  }

  // 是否存在任一筛选条件（搜索词 / 标签 / 文件夹）
  function hasActiveFilters() {
    return Boolean(search.trim() || activeTag || activeFolder);
  }

  // 一键清除全部筛选条件（搜索词 + 标签 + 文件夹），回到完整列表
  function clearAllFilters() {
    const had = hasActiveFilters();
    search = '';
    activeTag = '';
    activeFolder = '';
    searchInput.value = '';
    render();
    if (had) {
      try {
        searchInput.focus({ preventScroll: true });
      } catch (e) {
        searchInput.focus();
      }
    }
  }

  // 当前视图下的单条渲染（卡片 / 紧凑列表行）
  function itemHtml(it) {
    return viewMode === 'list' ? rowHtml(it) : cardHtml(it);
  }

  // 文件夹筛选弹窗：用 analyzer 的 folderTree 填充（含后代缩进与计数）
  let folderSignature = '';
  let folderTreeRef = null;
  let folderRenderKey = '';
  function folderGuideHtml(ancestors, isLast) {
    if (!ancestors.length) return '';
    const parentHasNext = ancestors[ancestors.length - 1] === true;
    return ancestors
      .slice(0, -1)
      .map(hasNext => `<i class="nt-folder-guide${hasNext ? ' has-line' : ''}"></i>`)
      .join('') + `<i class="nt-folder-guide is-branch${isLast && !parentHasNext ? ' is-last' : ''}"></i>`;
  }
  function renderFolders() {
    const menu = $('#ntFolderMenu');
    if (!menu) return;
    const tree = (DATA && DATA.folderTree) || {};
    const roots = tree.roots || [];
    const byId = tree.folderById || new Map();
    if (activeFolder && !byId.has(String(activeFolder))) activeFolder = '';
    // 签名覆盖根节点、父级、标题、计数和子目录顺序：重命名、跨层移动或重排后不会显示旧结构。
    // 树对象未变时跳过全量拼接，避免每次输入防抖都做一次 O(n) 字符串拼接。
    if (tree !== folderTreeRef) {
      folderTreeRef = tree;
      const nodes = [];
      const visit = list => {
        for (const node of list) {
          nodes.push(
            node.id + '/' +
              node.parentId + '/' +
              node.title + '/' +
              node.totalCount + '/' +
              node.visibleCount + '/' +
              (node.childFolders || []).map(child => child.id).join('|')
          );
          visit(node.childFolders || []);
        }
      };
      visit(roots);
      folderSignature = roots.map(node => node.id).join('|') + ':' + nodes.join(',');
    }
    const renderKey = folderSignature + ':' + activeFolder;
    if (renderKey !== folderRenderKey) {
      folderRenderKey = renderKey;
      const folderChoices = [{ value: '', title: '全部文件夹', count: DATA.total || 0, depth: 0, guides: '' }];
      const walk = (nodes, depth, ancestors) => {
        nodes.forEach((node, index) => {
          const isLast = index === nodes.length - 1;
          folderChoices.push({
            value: String(node.id),
            title: node.title,
            count: node.visibleCount,
            depth,
            guides: folderGuideHtml(ancestors, isLast)
          });
          walk(node.childFolders || [], depth + 1, depth ? ancestors.concat(!isLast) : [!isLast]);
        });
      };
      walk(roots, 0, []);
      menu.innerHTML = folderChoices
        .map(
          choice => `<div class="nt-folder-option${choice.value ? '' : ' is-all'}" role="option" tabindex="-1" data-value="${esc(choice.value)}" aria-selected="${
            String(choice.value) === String(activeFolder)
          }">
            <span class="nt-folder-option-guides" aria-hidden="true">${choice.guides}</span>
            <span class="nt-folder-option-icon" aria-hidden="true">${ICON('folder')}</span>
            <span class="nt-folder-option-label">${esc(choice.title)}</span>
            <span class="nt-folder-option-count">${choice.count}</span>
          </div>`
        )
        .join('');
    }
    const selectedNode = activeFolder ? byId.get(String(activeFolder)) : null;
    const summary = $('#ntFolderSummary');
    if (summary) {
      summary.textContent = selectedNode
        ? `当前目录：${selectedNode.title} · ${selectedNode.visibleCount} 个可见书签`
        : roots.length
          ? `${roots.length} 个顶级目录，可按目录及其子目录筛选`
          : '暂无可用文件夹';
    }
    const filterToggle = $('#ntFilterToggle');
    if (filterToggle) {
      const active = Boolean(selectedNode);
      filterToggle.classList.toggle('active', active);
      filterToggle.setAttribute('aria-pressed', String(active));
      filterToggle.setAttribute('data-tip', active ? `当前文件夹：${selectedNode.title}` : '按文件夹筛选');
    }
    const clearBtn = $('#ntFolderClear');
    if (clearBtn) clearBtn.disabled = !selectedNode;
  }

  // 视图切换：同步 .active / aria-pressed 并持久化到 storage
  function setView(mode, options) {
    const settings = options || {};
    viewMode = NT_VIEWS.indexOf(mode) >= 0 ? mode : 'grid';
    const isList = viewMode === 'list';
    const gridBtn = $('#ntViewGrid');
    const listBtn = $('#ntViewList');
    if (gridBtn) {
      gridBtn.classList.toggle('active', !isList);
      gridBtn.setAttribute('aria-pressed', String(!isList));
    }
    if (listBtn) {
      listBtn.classList.toggle('active', isList);
      listBtn.setAttribute('aria-pressed', String(isList));
    }
    if (settings.persist !== false) {
      try {
        const task = chrome.storage.local.set({ [NT_VIEW_KEY]: viewMode });
        if (task && typeof task.catch === 'function') task.catch(() => {});
      } catch (e) {
        /* 持久化失败不影响当前视图 */
      }
    }
    if (settings.rerender !== false && DATA) {
      kbIndex = -1;
      render();
    }
  }

  // ---- 键盘导航：j/k 与方向键移动高亮，Enter 打开，e 编辑，Delete 删除 ----
  function cardsInGrid() {
    const grid = $('#ntGrid');
    return grid ? Array.from(grid.querySelectorAll('.nt-card-wrap')) : [];
  }

  function syncKbHighlight() {
    const grid = $('#ntGrid');
    if (!grid) return;
    const wraps = cardsInGrid();
    if (kbIndex < 0 || kbIndex >= wraps.length) {
      kbIndex = -1;
      grid.removeAttribute('aria-activedescendant');
      return;
    }
    const active = wraps[kbIndex];
    active.classList.add('kb-active');
    active.setAttribute('aria-selected', 'true');
    grid.setAttribute('aria-activedescendant', active.id);
  }

  function kbMove(delta) {
    const wraps = cardsInGrid();
    if (!wraps.length) return;
    wraps.forEach(wrap => {
      wrap.classList.remove('kb-active');
      wrap.setAttribute('aria-selected', 'false');
    });
    kbIndex = kbIndex < 0 ? (delta > 0 ? 0 : wraps.length - 1) : kbIndex + delta;
    if (kbIndex < 0) kbIndex = 0;
    if (kbIndex > wraps.length - 1) kbIndex = wraps.length - 1;
    syncKbHighlight();
    const active = wraps[kbIndex];
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function kbClear() {
    if (kbIndex < 0) return;
    cardsInGrid().forEach(wrap => {
      wrap.classList.remove('kb-active');
      wrap.setAttribute('aria-selected', 'false');
    });
    kbIndex = -1;
    const grid = $('#ntGrid');
    if (grid) grid.removeAttribute('aria-activedescendant');
  }

  function kbTarget() {
    const wrap = cardsInGrid()[kbIndex];
    if (!wrap) return null;
    const id = wrap.dataset.ntId || wrap.id.replace('nt-card-', '');
    const it = (DATA.items || []).find(x => String(x.id) === String(id));
    return it ? { it, wrap } : null;
  }

  // Shift+Enter：优先在后台新开标签页，不可用时退回 window.open
  function openInBackground(rawUrl) {
    const href = safeHttpUrl(rawUrl);
    if (!href) return;
    const fallback = () => window.open(href, '_blank', 'noopener');
    try {
      const task = chrome.tabs.create({ url: href, active: false });
      if (task && typeof task.catch === 'function') task.catch(fallback);
    } catch (e) {
      fallback();
    }
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
      $('#ntGrid').insertAdjacentHTML('beforeend', list.slice(shown, next).map(itemHtml).join(''));
      shown = next;
      updateMore(list);
    };
    more.innerHTML = '';
    more.appendChild(btn);
  }

  // 打开侧边栏管理面板（需要用户手势）
  //
  // 侧边栏页面的路径只由 manifest 的 side_panel.default_path 声明：扩展在 chrome://extensions
  // 重新加载（或更新）之后，Chrome 会丢掉这份注册并销毁面板已有的 web contents，此时
  // sidePanel.open() 只会露出一个空白面板——页面根本没有被加载，面板内部的看门狗与错误卡
  // 也没有机会运行（用户看到的就是「白屏」，连顶栏都不存在）。所以打开前把路径显式写回去。
  const PANEL_PATH = 'popup.html';
  function ensurePanelRegistration() {
    // 必须留在用户手势的同步调用栈里，且不能 await：await 会断开手势链，
    // 随后的 sidePanel.open() 会被拒绝（只能由用户操作触发）。
    try {
      const task = chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
      if (task && typeof task.catch === 'function') task.catch(() => {});
    } catch (e) {
      /* Chrome 114 以下没有 sidePanel：忽略，打开失败时走标签页兜底 */
    }
  }

  // 兜底入口：不经过 side panel，直接以标签页打开管理界面。
  // 侧边栏空白属于 Chromium 的平台行为，任何面板内部的兜底都救不了，这条路径保证进得去。
  function openManagerTab() {
    const url = chrome.runtime.getURL(PANEL_PATH);
    const fallback = () => window.open(url, '_blank', 'noopener');
    try {
      const task = chrome.tabs.create({ url });
      if (task && typeof task.catch === 'function') task.catch(fallback);
    } catch (e) {
      fallback();
    }
  }

  async function openPanel() {
    ensurePanelRegistration();
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      // 面板若已停在空白状态（重载后 Chrome 留下的空壳），再指认一次路径促使它重新加载。
      // 配置未变化时 Chrome 不会重新加载已就绪的面板，因此对正常打开无副作用。
      ensurePanelRegistration();
    } catch (e) {
      // 降级：面板 API 不可用 / 版本过低 / 手势被拒 → 以标签页打开管理界面
      openManagerTab();
      showToast('侧边栏未能打开，已在标签页中打开管理界面');
    }
  }

  // 事件绑定
  const searchInput = $('#ntSearch');

  // 打开新标签页即把光标放进搜索框，不等书签分析（analyze）完成。
  // Chrome 会把新标签页首次加载时的焦点留给地址栏（omnibox），此时页面的 focus() 会被忽略，
  // 所以在这里按时间窗反复尝试，直到页面「真的」拿到焦点为止；
  // 注意不能拿 document.activeElement 当成功判据：autofocus 被浏览器忽略时它一样会指向输入框。
  // 用户一旦开始操作页面（点击 / 按键）就立即停止，之后不再抢焦点。
  // 框内已有内容时全选，便于直接覆盖输入（为将来「恢复上次搜索词」预留行为）。
  let searchAutofocusStopped = false;
  function focusSearch() {
    if (searchAutofocusStopped) return;
    try {
      searchInput.focus({ preventScroll: true });
    } catch (e) {
      searchInput.focus();
    }
    // 页面持有焦点 + 焦点落在搜索框，才算真正成功
    if (!document.hasFocus() || document.activeElement !== searchInput) return;
    searchAutofocusStopped = true;
    if (searchInput.value) {
      try {
        searchInput.select();
      } catch (e) {
        /* 部分环境不支持 select，忽略 */
      }
    }
  }
  // 用户已经开始操作页面（点击 / 按键）时就别再抢焦点
  const stopSearchAutofocus = () => {
    searchAutofocusStopped = true;
  };
  document.addEventListener('pointerdown', stopSearchAutofocus, { once: true, capture: true });
  document.addEventListener('keydown', stopSearchAutofocus, { once: true, capture: true });
  // 时间窗覆盖到书签分析完成：地址栏焦点可能在首次加载期间被锁，越靠后的尝试越有机会成功
  [0, 80, 200, 400, 700, 1100, 1600, 2200, 3000, 4000].forEach(ms => setTimeout(focusSearch, ms));

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
  // 键盘：回车直接打开第一条（网格 / 列表通用）
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#ntGrid .nt-card, #ntGrid .nt-row-link');
      if (first) first.click();
      return;
    }
    // ↓：从搜索框进入结果列表（焦点交给网格，后续 j/k / ↑↓ 由全局键盘导航处理），
    // 让「输入关键词 → ↓ → Enter 打开」全程不需要鼠标
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const grid = $('#ntGrid');
      if (grid && typeof grid.focus === 'function') {
        try {
          grid.focus({ preventScroll: true });
        } catch (err) {
          grid.focus();
        }
      }
      kbMove(1);
    }
  });
  // 全局快捷键：/ 聚焦搜索；Esc 清空搜索；j/k 与方向键移动高亮，Enter 打开，e 编辑，Delete 删除
  document.addEventListener('keydown', e => {
    // 文件夹筛选弹窗打开时，键盘完全交给弹窗（焦点陷阱不可用时也能 Esc 关闭）
    if (folderModalOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFolderModal(true);
      }
      return;
    }
    if (e.key === 'Escape' && search) {
      search = '';
      searchInput.value = '';
      $('#ntClear').classList.add('hidden');
      render();
      return;
    }
    // 确认弹层打开时，键盘完全交给弹层的焦点陷阱（UI.focusTrap）
    const modal = $('#ntConfirmWrap');
    if (modal && !modal.classList.contains('hidden')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
      return;
    }
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      kbMove(1);
      return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      kbMove(-1);
      return;
    }
    if (e.key === 'Enter' && kbIndex >= 0) {
      const target = kbTarget();
      if (!target) return;
      // 焦点已在卡片链接上时交给浏览器原生激活，避免重复打开
      if (!e.shiftKey && e.target.closest && e.target.closest('a[href]')) return;
      e.preventDefault();
      if (e.shiftKey) {
        openInBackground(target.it.url);
        return;
      }
      const link = target.wrap.querySelector('a[href]');
      if (link) {
        suppressHoverAfterOpen(link);
        link.click();
      } else {
        openInBackground(target.it.url);
      }
      return;
    }
    if ((e.key === 'e' || e.key === 'E') && kbIndex >= 0) {
      const target = kbTarget();
      if (!target) return;
      e.preventDefault();
      openInlineEditor(target.it, target.wrap);
      return;
    }
    if (e.key === 'Delete' && kbIndex >= 0) {
      const target = kbTarget();
      if (!target) return;
      e.preventDefault();
      softDeleteBookmark(target.it);
      return;
    }
    if (e.key === 'Escape') kbClear();
  });
  $('#ntTags').addEventListener('click', e => {
    const t = e.target.closest('.nt-tag');
    if (!t) return;
    activeTag = t.dataset.tag === activeTag ? '' : t.dataset.tag; // 再点取消
    render();
  });
  $('#ntOpenPanel').addEventListener('click', openPanel);
  // 兜底入口：不经过侧边栏，直接以标签页打开管理界面
  $('#ntOpenInTab')?.addEventListener('click', openManagerTab);
  // 视图切换：卡片网格 / 紧凑列表
  const viewGridBtn = $('#ntViewGrid');
  const viewListBtn = $('#ntViewList');
  if (viewGridBtn) viewGridBtn.addEventListener('click', () => setView('grid'));
  if (viewListBtn) viewListBtn.addEventListener('click', () => setView('list'));
  // 文件夹筛选：入口是搜索框里的「筛选」，选择在弹窗里完成（与标签筛选、搜索并存，AND）
  const filterToggle = $('#ntFilterToggle');
  const folderModal = $('#ntFolderModal');
  const folderMenu = $('#ntFolderMenu');
  let releaseFolderTrap = null;
  const folderModalOpen = () => Boolean(folderModal && !folderModal.classList.contains('hidden'));

  function closeFolderModal(restoreFocus) {
    if (!folderModal || folderModal.classList.contains('hidden')) return;
    folderModal.classList.add('hidden');
    if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
    if (typeof releaseFolderTrap === 'function') {
      releaseFolderTrap();
      releaseFolderTrap = null;
    }
    if (restoreFocus && filterToggle) filterToggle.focus();
  }

  function openFolderModal() {
    if (!folderModal) return;
    folderModal.classList.remove('hidden');
    if (filterToggle) filterToggle.setAttribute('aria-expanded', 'true');
    if (window.UI && typeof UI.focusTrap === 'function') {
      releaseFolderTrap = UI.focusTrap(folderModal, {
        onEscape: () => closeFolderModal(true),
        autofocus: false
      });
    }
    const list = [...folderMenu.querySelectorAll('[role="option"]')];
    const target = list.find(option => option.getAttribute('aria-selected') === 'true') || list[0];
    if (target) {
      target.focus({ preventScroll: true });
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyFolder(value) {
    activeFolder = value || '';
    closeFolderModal(true);
    render();
  }

  if (filterToggle && folderModal && folderMenu) {
    filterToggle.addEventListener('click', () => {
      if (folderModalOpen()) closeFolderModal(true);
      else openFolderModal();
    });
    // 点遮罩关闭，点卡片内部不关
    folderModal.addEventListener('click', e => {
      if (e.target === folderModal) closeFolderModal(true);
    });
  }
  if (folderMenu) {
    const menuOptions = () => [...folderMenu.querySelectorAll('[role="option"]')];
    const focusFolderOption = index => {
      const options = menuOptions();
      if (!options.length) return;
      const next = Math.max(0, Math.min(index, options.length - 1));
      options[next].focus({ preventScroll: true });
    };
    folderMenu.addEventListener('click', e => {
      const option = e.target.closest('[role="option"]');
      if (option) applyFolder(option.dataset.value);
    });
    folderMenu.addEventListener('keydown', e => {
      const options = menuOptions();
      const index = options.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusFolderOption(index + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusFolderOption(index - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusFolderOption(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusFolderOption(options.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (options[index]) applyFolder(options[index].dataset.value);
      } else if (e.key === 'Escape') {
        // 焦点陷阱不可用时（UI 未加载）仍要能关掉弹窗
        e.preventDefault();
        closeFolderModal(true);
      }
    });
  }
  const folderClearBtn = $('#ntFolderClear');
  if (folderClearBtn) folderClearBtn.addEventListener('click', () => applyFolder(''));
  const folderCloseBtn = $('#ntFolderClose');
  if (folderCloseBtn) folderCloseBtn.addEventListener('click', () => closeFolderModal(true));
  const filterClearBtn = $('#ntFilterClear');
  if (filterClearBtn) filterClearBtn.addEventListener('click', clearAllFilters);

  // 头部整体吸顶：越过顶部后加毛玻璃与阴影提示已固定（IntersectionObserver，无滚动抖动）
  const head = $('#ntHead');
  if (head) {
    const sentinel = document.createElement('div');
    sentinel.className = 'nt-sticky-sentinel';
    head.parentNode.insertBefore(sentinel, head);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(
        entries => {
          head.classList.toggle('is-stuck', !(entries[0] && entries[0].isIntersecting));
        },
        { threshold: 0 }
      ).observe(sentinel);
    }
    // 头部高度写入 CSS 变量：键盘导航 scrollIntoView 时避免卡片被吸顶头部挡住
    const syncHeadHeight = () =>
      document.documentElement.style.setProperty(
        '--nt-head-h',
        `${Math.round(head.getBoundingClientRect().height)}px`
      );
    syncHeadHeight();
    if (typeof ResizeObserver === 'function') new ResizeObserver(syncHeadHeight).observe(head);
    else window.addEventListener('resize', syncHeadHeight);
  }

  $('#ntGrid').addEventListener('click', e => {
    suppressHoverAfterOpen(e.target.closest('.nt-card, .nt-row-link'));
  });
  $('#ntGrid').addEventListener('auxclick', e => {
    if (e.button === 1) suppressHoverAfterOpen(e.target.closest('.nt-card, .nt-row-link'));
  });

  $('#ntGrid').addEventListener(
    'error',
    e => {
      const img = e.target.closest && e.target.closest('.nt-fav-img');
      if (img) img.classList.add('is-error');
    },
    true
  );

  // 卡片操作按钮（事件委托）：复制 / 隐藏 / 编辑 / 删除
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
      const hiddenTask = setHiddenOptimistic(it, !wasHidden);
      if (!wasHidden) {
        showToast('已隐藏', 'ok', {
          label: '撤销',
          onClick: async () => {
            try {
              await setHiddenOptimistic(it, false);
              showToast('已取消隐藏', 'ok', undefined, { compact: true });
            } catch (err) {
              showToast('撤销失败：' + (err.message || err), 'danger');
            }
          }
        }, { compact: true });
      } else {
        showToast('已取消隐藏', 'ok', undefined, { compact: true });
      }
      hiddenTask.catch(err =>
        showToast((wasHidden ? '取消隐藏' : '隐藏') + '失败：' + (err.message || err), 'danger')
      );
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
      // 焦点陷阱 / Escape 收敛到共享原语（js/ui.js）；无 UI 时退回原生焦点管理
      const release = window.UI
        ? window.UI.focusTrap(wrap, { onEscape: () => done(false), autofocus: false })
        : null;
      const onKey = e => {
        if (e.key === 'Escape') {
          if (!window.UI) done(false); // 有 UI 时 Escape 由焦点陷阱的 onEscape 处理
          return;
        }
        if (e.key === 'Enter' && e.target !== yes && e.target !== no) done(true);
      };
      const onWrapClick = e => {
        if (e.target === wrap) done(false);
      };
      const done = v => {
        wrap.classList.add('hidden');
        yes.onclick = no.onclick = null;
        document.removeEventListener('keydown', onKey);
        wrap.removeEventListener('click', onWrapClick);
        // 关闭后归还焦点：UI.releaseTrap 内建 restore，无 UI 时手工归还
        if (release) release();
        else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
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
  function removeDeletedItemFromData(it) {
    if (!DATA) return;
    const itemId = String(it.id);
    DATA.items = DATA.items.filter(item => String(item.id) !== itemId);
    DATA.total = Math.max(0, Number(DATA.total || 0) - 1);
    if (DATA.itemById && typeof DATA.itemById.delete === 'function') DATA.itemById.delete(it.id);
    if (!it.hidden) {
      for (const tag of it.tags || []) {
        if (!DATA.tagStats || !DATA.tagStats[tag]) continue;
        DATA.tagStats[tag] -= 1;
        if (DATA.tagStats[tag] <= 0) delete DATA.tagStats[tag];
      }
    }
    const tree = DATA.folderTree;
    const byId = tree && tree.folderById;
    if (byId && typeof byId.get === 'function') {
      const visited = new Set();
      let node = byId.get(String(it.parentId));
      while (node && !visited.has(node.id)) {
        visited.add(node.id);
        node.totalCount = Math.max(0, Number(node.totalCount || 0) - 1);
        if (!it.hidden) node.visibleCount = Math.max(0, Number(node.visibleCount || 0) - 1);
        node = byId.get(String(node.parentId));
      }
    }
    folderTreeRef = null;
    folderSignature = '';
    folderRenderKey = '';
  }

  function clearDeleteViewState(id) {
    const itemId = String(id);
    pendingDeletes.delete(itemId);
    completedDeletes.delete(itemId);
  }

  // 重新分析期间也隐藏正在删除的条目，避免并发同步把它们渲染回来。
  function applyPendingDeletes() {
    if (!DATA || !pendingDeletes.size) return;
    for (const id of pendingDeletes) {
      const item =
        (DATA.itemById && DATA.itemById.get && DATA.itemById.get(id)) ||
        (DATA.items || []).find(entry => String(entry.id) === String(id));
      if (item) removeDeletedItemFromData(item);
      else if (completedDeletes.has(id)) {
        pendingDeletes.delete(id);
        completedDeletes.delete(id);
      }
    }
  }

  // 删除收尾（回收站确认 + 标签清理）不阻塞列表反馈，但「撤销」必须先等它落地：
  // 否则后台仍把记录视为 deletionPending，会以「书签删除仍在进行」拒绝恢复。
  function trackDeleteFinalize(id, task) {
    const itemId = String(id);
    finalizeDeletes.set(itemId, task);
    const clear = () => {
      if (finalizeDeletes.get(itemId) === task) finalizeDeletes.delete(itemId);
      clearDeleteViewState(itemId);
    };
    task.then(clear, clear);
  }

  async function waitDeleteFinalize(id) {
    const task = finalizeDeletes.get(String(id));
    if (!task) return;
    try {
      await task;
    } catch {
      /* 收尾失败时按未完成处理，恢复失败原因由后台给出 */
    }
  }

  function setHiddenOptimistic(it, nextHidden) {
    const itemId = String(it.id);
    const pending = pendingHidden.get(itemId);
    if (pending) return pending.then(() => setHiddenOptimistic(it, nextHidden));
    const previous = !!it.hidden;
    it.hidden = nextHidden;
    render();
    const task = window.BM.toggleHidden(it.id)
      .then(actual => {
        if (actual !== nextHidden) {
          it.hidden = actual;
          render();
        }
        return actual;
      })
      .catch(error => {
        it.hidden = previous;
        render();
        throw error;
      });
    let tracked;
    tracked = task.finally(() => {
      if (pendingHidden.get(itemId) === tracked) pendingHidden.delete(itemId);
    });
    pendingHidden.set(itemId, tracked);
    return tracked;
  }

  async function softDeleteBookmark(it) {
    try {
      const ok = await confirmDialog({
        title: '移入回收站？',
        message: `「${esc(it.title)}」将移入回收站，30 天内可恢复。`,
        confirmText: '移入回收站'
      });
      if (!ok) return;

      // 先更新当前视图，避免等待回收站消息和 Chrome 书签 API 时卡住界面。
      // 失败时重新分析原生书签树，把乐观移除的条目恢复回来。
      pendingDeletes.add(String(it.id));
      const liveItem =
        (DATA && DATA.itemById && DATA.itemById.get && DATA.itemById.get(String(it.id))) ||
        (DATA && DATA.items || []).find(entry => String(entry.id) === String(it.id));
      if (liveItem) removeDeletedItemFromData(liveItem);
      render();

      // 拿一下父级信息（回收站需要 parentId/title 等）
      const bm = it.parentId ? null : await chrome.bookmarks.get(it.id).catch(() => null);
      const trashItem = {
        id: it.id,
        title: it.title,
        url: it.url,
        parentId: it.parentId || (bm && bm[0] ? bm[0].parentId : undefined)
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
      completedDeletes.add(String(it.id));
      showToast('已移入回收站', 'ok', {
        label: '撤销',
        onClick: async () => {
          try {
            // 等删除收尾完成，避免撤销被后台判为「删除进行中」而静默失败
            await waitDeleteFinalize(it.id);
            clearDeleteViewState(it.id);
            const r = await window.BM.restoreTrashItems([{ id: it.id }]);
            if (r.restored) {
              showToast('已恢复书签 ✓', 'ok', undefined, { compact: true });
            } else {
              // 带上后台给出的具体原因，不再一律说「可能已被永久删除」
              const reason = (r.failed[0] && r.failed[0].error) || '该记录可能已被永久删除';
              showToast('恢复失败：' + reason, true);
            }
            DATA = await window.BMAnalyzer.analyze();
            applyPendingDeletes();
            render();
          } catch (err) {
            showToast('恢复失败：' + (err.message || err), true);
          }
        }
      }, { compact: true });
      // 删除收尾不阻塞列表反馈：撤销只需等「回收站确认」落地（后台据此判定删除已完成），
      // 标签清理继续在后台收尾，不拖住撤销。
      const confirmDelete = (async () => {
        try {
          await window.BM.completeTrashDelete([it.id], []);
        } catch {
          /* 保留保护记录 */
        }
      })();
      trackDeleteFinalize(it.id, confirmDelete);
      void confirmDelete.then(async () => {
        try {
          await window.BM.setTags(it.id, []);
        } catch {
          /* noop */
        }
      });
    } catch (e) {
      // 回收站预写或原生删除失败时，原书签仍可能存在；重新分析可恢复完整索引。
      clearDeleteViewState(it.id);
      try {
        DATA = await window.BMAnalyzer.analyze();
        applyPendingDeletes();
        render();
      } catch {
        /* 回滚失败时保留当前视图，错误提示仍会告知用户 */
      }
      showToast('删除失败：' + (e.message || e), true);
    }
  }

  // Toast 简易提示（可附带撤销等动作按钮）
  // 兼容旧签名 showToast(msg, danger, action)，并支持分级字符串 'ok' | 'info' | 'warn' | 'danger'
  function showToast(msg, level, action, options) {
    const compact = !!(options && options.compact);
    const toastOptions = compact ? { compact: true } : undefined;
    const kind =
      level === true
        ? 'danger'
        : typeof level === 'string' && ['ok', 'info', 'warn', 'danger'].indexOf(level) >= 0
          ? level
          : level
            ? 'danger'
            : 'ok';
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast(msg, kind, action, toastOptions);
      return;
    }
    const t = document.createElement('div');
    t.className = 'nt-toast' + (kind === 'ok' ? '' : ' ' + kind) + (compact ? ' compact' : '');
    const alert = kind === 'danger' || kind === 'warn';
    t.setAttribute('role', alert ? 'alert' : 'status');
    t.setAttribute('aria-live', alert ? 'assertive' : 'polite');
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
    const hold = compact ? (action ? 5200 : 1700) : action ? 8000 : 2200;
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
            <button type="button" class="nt-edit-btn ghost nt-edit-ai" data-edit-act="ai" data-tip="AI 从固定标签池中挑 1-3 个标签（需在设置页配置 AI 服务）">${ICON('sparkles')}<span class="nt-edit-ai-label">AI 打标</span></button>
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
        applyPendingDeletes();
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
    // 视图模式在其它标签页切换时跟随（不重复写回 storage）
    if (changes[NT_VIEW_KEY]) {
      setView(changes[NT_VIEW_KEY].newValue, { persist: false });
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
        applyPendingDeletes();
        render();
      } catch (e) {
        /* 忽略同步失败 */
      }
    }, 300);
  });

  // 初始化：加载配置 + 分析书签
  (async function init() {
    // 统一 tooltip（data-tip）由共享原语 js/ui.js 绑定
    if (window.UI) UI.initTooltip();
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
    // 视图模式（卡片网格 / 紧凑列表，默认卡片）
    try {
      const r = await chrome.storage.local.get(NT_VIEW_KEY);
      setView(r[NT_VIEW_KEY], { persist: false, rerender: false });
    } catch (e) {
      /* 默认卡片视图 */
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
      applyPendingDeletes();
      render();
      // 兜底：早期尝试全部失败时（例如窗口尚未激活），数据就绪后再聚焦一次；
      // 若已聚焦成功或用户已开始操作，focusSearch 内部会直接返回，不会抢焦点
      focusSearch();
    } catch (e) {
      const loading = $('#ntLoading');
      if (loading) loading.classList.add('hidden');
      $('#ntEmpty').classList.remove('hidden');
      $('#ntEmptyTitle').textContent = '读取书签失败';
      $('#ntEmptyDesc').textContent = (e && e.message) || String(e);
      console.error('[书签管家] newtab 初始化失败', e);
    }
    // 首屏已展示后再做一次标签拉取。初始化任务若仍在后台队列中，完成后会在此继续。
    void tagConfigurationTask.then(async result => {
      if (result.failed) return;
      const changed = await window.BM.pullTagsFromCloud();
      if (!changed || !DATA) return;
      window.BM.invalidateTags && window.BM.invalidateTags();
      DATA = await window.BMAnalyzer.analyze();
      applyPendingDeletes();
      render();
    }).catch(() => {});
  })();
})();
