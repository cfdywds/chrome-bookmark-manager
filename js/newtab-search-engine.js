// ===== 新标签页网页搜索 =====
(function () {
  'use strict';

  const STORAGE_KEY = 'bmNewtabSearchEngine';
  const DEFAULT_ENGINE = 'google';
  const ENGINES = Object.freeze({
    google: { label: 'Google', mark: 'G', icon: 'icons/engines/google.svg', template: 'https://www.google.com/search?q=%s' },
    bing: { label: 'Bing', mark: 'B', icon: 'icons/engines/bing.svg', template: 'https://www.bing.com/search?q=%s' },
    baidu: { label: '百度', mark: '百', icon: 'icons/engines/baidu.svg', template: 'https://www.baidu.com/s?wd=%s' },
    duckduckgo: { label: 'DuckDuckGo', mark: 'D', icon: 'icons/engines/duckduckgo.svg', template: 'https://duckduckgo.com/?q=%s' }
  });

  function buildSearchUrl(query, template) {
    const text = String(query == null ? '' : query).trim();
    const pattern = String(template == null ? '' : template).trim();
    if (!text || !/^https?:\/\//i.test(pattern) || !pattern.includes('%s')) return '';
    return pattern.replace(/%s/g, encodeURIComponent(text));
  }

  function normalizeEngineId(value) {
    return Object.prototype.hasOwnProperty.call(ENGINES, value) ? value : DEFAULT_ENGINE;
  }

  // 渲染官方 logo 图标；图片加载失败时回退为字母标
  function renderEngineIcon(logoEl, id) {
    const engine = ENGINES[id];
    if (!logoEl || logoEl.getAttribute('data-engine') === id) return;
    logoEl.setAttribute('data-engine', id);
    logoEl.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'nt-engine-icon';
    img.src = engine.icon;
    img.alt = '';
    img.draggable = false;
    img.addEventListener(
      'error',
      () => {
        logoEl.textContent = engine.mark;
      },
      { once: true }
    );
    logoEl.appendChild(img);
  }

  function updateEngineLogo(select) {
    const id = normalizeEngineId(select && select.value);
    const engine = ENGINES[id];
    const logo = document.getElementById('ntSearchEngineLogo');
    if (logo) {
      logo.className = 'nt-engine-logo ' + id;
      logo.title = engine.label;
      renderEngineIcon(logo, id);
    }
    const btn = document.getElementById('ntSearchEngineBtn');
    if (btn) btn.setAttribute('aria-label', '选择网页搜索引擎，当前 ' + engine.label);
    // 同步自绘菜单的选中态
    const menu = document.getElementById('ntSearchEngineMenu');
    if (menu) {
      menu.querySelectorAll('.nt-engine-option').forEach(item => {
        item.setAttribute('aria-selected', String(item.getAttribute('data-engine') === id));
      });
    }
  }

  function buildMenu(menu) {
    menu.innerHTML = Object.entries(ENGINES)
      .map(
        ([id, engine]) =>
          '<button type="button" class="nt-engine-option" role="option" data-engine="' +
          id +
          '" aria-selected="false">' +
          '<span class="nt-engine-logo ' +
          id +
          '" data-engine-logo="' +
          id +
          '" aria-hidden="true">' +
          '<img class="nt-engine-icon" src="' +
          engine.icon +
          '" alt="" draggable="false" />' +
          '</span>' +
          '<span class="nt-engine-name">' +
          engine.label +
          '</span>' +
          '<svg class="nt-engine-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<use href="icons/sprite.svg#i-check" /></svg>' +
          '</button>'
      )
      .join('');
    // 官方 logo 加载失败时回退为字母标
    menu.querySelectorAll('.nt-engine-icon').forEach(img => {
      img.addEventListener(
        'error',
        () => {
          const logo = img.closest('[data-engine-logo]');
          const id = logo && logo.getAttribute('data-engine-logo');
          if (logo && ENGINES[id]) logo.textContent = ENGINES[id].mark;
        },
        { once: true }
      );
    });
  }

  function ensureSelector() {
    const input = document.getElementById('ntSearch');
    if (!input) return null;
    let select = document.getElementById('ntSearchEngine');
    if (!select) {
      select = document.createElement('select');
      select.id = 'ntSearchEngine';
      select.className = 'nt-engine-select';
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      select.innerHTML = Object.entries(ENGINES)
        .map(([id, engine]) => '<option value="' + id + '">' + engine.label + '</option>')
        .join('');
    }
    let picker = document.getElementById('ntSearchEnginePicker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'ntSearchEnginePicker';
      picker.className = 'nt-engine-picker';
      input.parentNode.insertBefore(picker, input.parentNode.firstChild);
    }
    let btn = document.getElementById('ntSearchEngineBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'ntSearchEngineBtn';
      btn.className = 'nt-engine-btn';
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('data-tip', '点击切换网页搜索引擎');
      const logo = document.createElement('span');
      logo.id = 'ntSearchEngineLogo';
      logo.className = 'nt-engine-logo google';
      logo.setAttribute('aria-hidden', 'true');
      logo.textContent = 'G';
      btn.appendChild(logo);
    }
    let menu = document.getElementById('ntSearchEngineMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'ntSearchEngineMenu';
      menu.className = 'nt-engine-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', '选择网页搜索引擎');
      menu.hidden = true;
    }
    if (!picker.contains(btn)) picker.appendChild(btn);
    if (!picker.contains(select)) picker.appendChild(select);
    if (!picker.contains(menu)) picker.appendChild(menu);
    buildMenu(menu);
    updateEngineLogo(select);
    return select;
  }

  async function loadEngine(select) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      select.value = normalizeEngineId(stored[STORAGE_KEY]);
    } catch (e) {
      select.value = DEFAULT_ENGINE;
    }
    updateEngineLogo(select);
  }

  function submitSearch(input, select) {
    const engine = ENGINES[normalizeEngineId(select && select.value)];
    const url = buildSearchUrl(input.value, engine.template);
    if (!url) return false;
    window.location.assign(url);
    return true;
  }

  // ===== 自绘引擎菜单的交互（打开/关闭/键盘导航/选择）=====
  function setupMenu(input, select) {
    const picker = document.getElementById('ntSearchEnginePicker');
    const btn = document.getElementById('ntSearchEngineBtn');
    const menu = document.getElementById('ntSearchEngineMenu');
    if (!picker || !btn || !menu) return;

    const isOpen = () => !menu.hidden;
    const items = () => Array.from(menu.querySelectorAll('.nt-engine-option'));

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const current =
        menu.querySelector('.nt-engine-option[aria-selected="true"]') || items()[0];
      if (current) current.focus();
    }

    function closeMenu(refocusBtn) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (refocusBtn) btn.focus();
    }

    function choose(id) {
      select.value = normalizeEngineId(id);
      // 复用既有 change 流程：持久化 + 刷新 logo
      select.dispatchEvent(new Event('change'));
      closeMenu(false);
      // 选完直接回到搜索框，顺手就能输入
      input.focus();
    }

    btn.addEventListener('click', event => {
      event.stopPropagation();
      if (isOpen()) closeMenu(false);
      else openMenu();
    });

    btn.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu();
      }
    });

    menu.addEventListener('click', event => {
      const item = event.target.closest('.nt-engine-option');
      if (item) choose(item.getAttribute('data-engine'));
    });

    menu.addEventListener('keydown', event => {
      const list = items();
      const index = list.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        (list[index + 1] || list[0]).focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        (list[index - 1] || list[list.length - 1]).focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (event.key === 'Tab') {
        closeMenu(false);
      }
      // Enter / Space 落在 <button> 上自然触发 click，无需额外处理
    });

    // 点击菜单外部任意处收起
    document.addEventListener('pointerdown', event => {
      if (isOpen() && !picker.contains(event.target)) closeMenu(false);
    });
  }

  function init() {
    const input = document.getElementById('ntSearch');
    if (!input) return;
    const select = ensureSelector();
    if (!select) return;
    void loadEngine(select);
    setupMenu(input, select);
    select.addEventListener('change', () => {
      const value = normalizeEngineId(select.value);
      select.value = value;
      updateEngineLogo(select);
      try {
        const task = chrome.storage.local.set({ [STORAGE_KEY]: value });
        if (task && typeof task.catch === 'function') task.catch(() => {});
      } catch (e) {
        /* 保存失败不影响本次搜索 */
      }
    });
    // 捕获阶段先处理搜索框回车，保留 ArrowDown 后在书签列表中选择的路径。
    document.addEventListener(
      'keydown',
      event => {
        if (event.target !== input || event.key !== 'Enter' || event.isComposing) return;
        const query = input.value.trim();
        if (!query) return;
        if (submitSearch(input, select)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  }

  window.BMSearchEngine = { ENGINES, buildSearchUrl, normalizeEngineId };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
