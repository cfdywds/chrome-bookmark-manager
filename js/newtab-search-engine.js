// ===== 新标签页网页搜索 =====
(function () {
  'use strict';

  const STORAGE_KEY = 'bmNewtabSearchEngine';
  const DEFAULT_ENGINE = 'google';
  const ENGINES = Object.freeze({
    google: { label: 'Google', template: 'https://www.google.com/search?q=%s' },
    bing: { label: 'Bing', template: 'https://www.bing.com/search?q=%s' },
    baidu: { label: '百度', template: 'https://www.baidu.com/s?wd=%s' },
    duckduckgo: { label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' }
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

  function injectStyles() {
    if (document.getElementById('ntSearchEngineStyles')) return;
    const style = document.createElement('style');
    style.id = 'ntSearchEngineStyles';
    style.textContent =
      '.nt-engine-select{height:32px;max-width:118px;margin-right:6px;padding:0 24px 0 8px;border:1px solid var(--line,#d8dee9);border-radius:8px;background:var(--panel,#fff);color:var(--text,#1f2937);font:inherit;font-size:12px;cursor:pointer}.nt-engine-select:focus{outline:2px solid color-mix(in srgb,var(--primary,#3b82f6) 35%,transparent);outline-offset:1px}@media(max-width:560px){.nt-engine-select{max-width:92px;font-size:11px;padding-left:5px;padding-right:16px}}';
    document.head.appendChild(style);
  }

  function ensureSelector() {
    const input = document.getElementById('ntSearch');
    if (!input) return null;
    let select = document.getElementById('ntSearchEngine');
    if (!select) {
      select = document.createElement('select');
      select.id = 'ntSearchEngine';
      select.className = 'nt-engine-select';
      select.setAttribute('aria-label', '选择网页搜索引擎');
      select.innerHTML = Object.entries(ENGINES)
        .map(([id, engine]) => '<option value="' + id + '">' + engine.label + '</option>')
        .join('');
      input.insertAdjacentElement('afterend', select);
    }
    return select;
  }

  async function loadEngine(select) {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      select.value = normalizeEngineId(stored[STORAGE_KEY]);
    } catch (e) {
      select.value = DEFAULT_ENGINE;
    }
  }

  function submitSearch(input, select) {
    const engine = ENGINES[normalizeEngineId(select && select.value)];
    const url = buildSearchUrl(input.value, engine.template);
    if (!url) return false;
    window.location.assign(url);
    return true;
  }

  function init() {
    const input = document.getElementById('ntSearch');
    if (!input) return;
    injectStyles();
    const select = ensureSelector();
    if (!select) return;
    void loadEngine(select);
    select.addEventListener('change', () => {
      const value = normalizeEngineId(select.value);
      select.value = value;
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
