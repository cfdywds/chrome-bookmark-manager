#!/usr/bin/env node
/**
 * 生成「现状快照」—— 把三个界面的运行后形态固化成可直接用浏览器打开的静态页面。
 *
 * 为什么需要它：
 *   1. Stitch 无法访问 chrome-extension:// 页面，必须先把界面变成可截图/可上传的形态；
 *   2. popup.html 的 #content 与 newtab.html 的 #ntGrid 在源码里都是空的 ——
 *      真实 DOM 由 popup.js(4891 行) / newtab.js(1496 行) 的模板字符串在运行时生成。
 *      直接上传源码 HTML 只会给 Stitch 一个空壳。
 *
 * 做法：复用真实源文件 + 真实 CSS（视觉 100% 一致），只把运行时 DOM 补回去。
 *   - 保留全部真实类名与嵌套结构，照搬 popup.js / newtab.js 的模板输出格式；
 *   - 内联雪碧图（file:// 下跨文件 <use href="*.svg#id"> 会被浏览器阻止）；
 *   - 去掉 <script>（快照是静态参考，不跑扩展逻辑）。
 *
 * 产物：docs/stitch/snapshots/*.html —— 只读参考，**不是产品代码**，不要接进扩展。
 * 用法：node docs/stitch/build-snapshots.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, 'snapshots');
mkdirSync(outDir, { recursive: true });

const read = p => readFileSync(join(root, p), 'utf8');
const strip = s => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// 1. 内联雪碧图
// ---------------------------------------------------------------------------
const spriteInner = read('icons/sprite.svg')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${spriteInner}</svg>`;

// ---------------------------------------------------------------------------
// 2. 通用变换
// ---------------------------------------------------------------------------
function transform(html) {
  return (
    html
      .replace(/\s*<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/\s*<script\b[^>]*\/>/g, '')
      // 跨文件雪碧图引用改为同文档引用（symbol 由 SPRITE 注入到 body 开头）
      .replace(/href="icons\/sprite\.svg#/g, 'href="#')
      // 资源路径：snapshots/ → 项目根
      .replace(/href="css\//g, 'href="../../../css/')
      .replace(/src="icons\//g, 'src="../../../icons/')
      .replace(/(<body[^>]*>)/, m => `${m}\n    ${SPRITE}`)
  );
}

// ---------------------------------------------------------------------------
// 3. 照搬 popup.js / newtab.js 的图标助手输出格式
// ---------------------------------------------------------------------------
const ico = (n, sm = true) =>
  `<svg class="ico${sm ? ' ico-sm' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;

// 与 newtab.js:229-231 相同的色相算法，保证 favicon 兜底底色一致
const hueOf = s => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};
// 真实扩展用 chrome.runtime.getURL('/_favicon/')；快照改用等效在线服务，
// 断网时 img 加载失败会自然露出同层的首字母兜底（与真实降级行为一致）。
const faviconOf = host => `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

// ---------------------------------------------------------------------------
// 4. 样例数据（真实感中文书签；仅用于快照，无隐私含义）
// ---------------------------------------------------------------------------
const TAGS = [
  { name: '代码', n: 18 },
  { name: '工具', n: 15 },
  { name: '学习', n: 12 },
  { name: '设计', n: 9 },
  { name: '文档', n: 8 },
  { name: '资讯', n: 7 },
  { name: '社区', n: 6 },
  { name: '运维', n: 4 },
];

const BOOKMARKS = [
  { t: 'GitHub · 代码托管平台', u: 'https://github.com/', h: 'github.com', p: '书签栏 / 开发', c: '代码', g: ['代码', '工具'] },
  { t: 'MDN Web Docs', u: 'https://developer.mozilla.org/zh-CN/', h: 'developer.mozilla.org', p: '书签栏 / 开发', c: '学习', g: ['学习', '文档'] },
  { t: 'Chrome 扩展开发文档', u: 'https://developer.chrome.com/docs/extensions', h: 'developer.chrome.com', p: '书签栏 / 开发', c: '文档', g: ['文档'] },
  { t: 'Figma · 协作设计工具', u: 'https://www.figma.com/', h: 'figma.com', p: '书签栏 / 设计', c: '设计', g: ['设计', '工具'] },
  { t: 'Tailwind CSS 文档', u: 'https://tailwindcss.com/docs', h: 'tailwindcss.com', p: '书签栏 / 开发', c: '文档', g: ['文档', '代码'] },
  { t: 'Can I use · 浏览器兼容性查询', u: 'https://caniuse.com/', h: 'caniuse.com', p: '书签栏 / 开发', c: '工具', g: ['工具', '学习'] },
  { t: 'DeepSeek 开放平台', u: 'https://platform.deepseek.com/', h: 'platform.deepseek.com', p: '书签栏 / AI', c: '工具', g: ['工具'] },
  { t: '掘金 · 开发者社区', u: 'https://juejin.cn/', h: 'juejin.cn', p: '书签栏 / 社区', c: '社区', g: ['社区', '学习'] },
  { t: 'V2EX · 创意工作者社区', u: 'https://v2ex.com/', h: 'v2ex.com', p: '书签栏 / 社区', c: '社区', g: ['社区'] },
  { t: '少数派 · 高效工作与品质生活', u: 'https://sspai.com/', h: 'sspai.com', p: '书签栏 / 资讯', c: '资讯', g: ['资讯'] },
  { t: '阿里云控制台', u: 'https://home.console.aliyun.com/', h: 'aliyun.com', p: '书签栏 / 运维', c: '运维', g: ['运维'] },
  { t: '中国大学 MOOC', u: 'https://www.icourse163.org/', h: 'icourse163.org', p: '书签栏 / 学习', c: '学习', g: ['学习'] },
];

const fav = it => `<span class="nt-fav" aria-hidden="true" style="--fav-hue: ${hueOf(it.h)}">
            <span class="nt-fav-fallback">${(it.h[0] || '?').toUpperCase()}</span>
            <img class="nt-fav-img" src="${faviconOf(it.h)}" alt="" loading="lazy" />
          </span>`;

// ---------------------------------------------------------------------------
// 5. popup 模板（照搬 popup.js:688-738 的输出格式）
// ---------------------------------------------------------------------------
const popupRow = it => `        <div class="row clickable draggable" data-id="${it.t}" tabindex="0" role="option" aria-selected="false" aria-label="${it.t}">
          <button class="drag-handle" type="button" draggable="true" data-tip="按住拖拽排序，或拖到分组标题上移动分组" aria-label="拖动 ${it.t}">${ico('drag')}</button>
          <label class="checkbox-slot"><input type="checkbox" class="checkbox sel" aria-label="选择 ${it.t}"></label>
          <div class="meta">
            <div class="title">${it.t}</div>
            <div class="url">${it.u}</div>
            <div class="loc"><span>${ico('folder')} ${it.p}</span> <span class="tag cat">${it.c}</span> ${it.g
  .map(g => `<button class="tag-chip" data-tip="按标签筛选" aria-label="按标签 #${g} 筛选">#${g}</button>`)
  .join(' ')}</div>
          </div>
          <button class="row-eye" data-tip="隐藏此书签（从日常视图排除）" aria-label="隐藏此书签">${ico('eye')}</button>
          <button class="row-ai" data-tip="AI 重新打标（覆盖标签）" aria-label="AI 打标 ${it.t}">${ico('sparkles')}</button>
          <button class="row-edit" data-tip="编辑书签" aria-label="编辑 ${it.t}">${ico('edit')}</button>
        </div>`;

const popupGroup = (name, items) => `      <div class="group" data-group="${name}">
        <div class="group-head" role="button" tabindex="0" aria-expanded="true">
          <div class="g-title">
            <span>${ico('tag')}</span>
            <span class="g-name" data-tip="${name}">${name}</span>
            <span class="badge">${items.length}</span>
          </div>
          <div class="actions"></div>
        </div>
        <div class="group-body">
${items.map(popupRow).join('\n')}
        </div>
      </div>`;

const popupOverview = () => `      <div class="kpi">
        <div class="card big"><b>128</b><span>书签总数</span></div>
        <div class="card"><b>24</b><span>标签</span></div>
        <div class="card"><b>7</b><span>待清理</span></div>
        <div class="card"><b>3</b><span>回收站</span></div>
      </div>
      <div class="search-hero">
        <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-search"/></svg>
        <input id="heroSearch" type="text" placeholder="搜索标题、网址、域名、标签" autocomplete="off" spellcheck="false" />
      </div>
      <div class="overview-entries" role="group" aria-label="快捷入口">
        <div class="entry-card" data-jump="clean" data-sub="repeat" role="button" tabindex="0" aria-label="重复书签：5">
          <span class="entry-icon danger">${ico('repeat')}</span>
          <span class="entry-title">重复书签</span>
          <span class="entry-count">5</span>
        </div>
        <div class="entry-card" data-jump="clean" data-sub="empty" role="button" tabindex="0" aria-label="空文件夹：2">
          <span class="entry-icon warn">${ico('folder')}</span>
          <span class="entry-title">空文件夹</span>
          <span class="entry-count">2</span>
        </div>
        <div class="entry-card" data-jump="trash" role="button" tabindex="0" aria-label="回收站：3">
          <span class="entry-icon">${ico('archive')}</span>
          <span class="entry-title">回收站</span>
          <span class="entry-count">3</span>
        </div>
      </div>
      <div class="tag-cloud-card">
        <div class="cloud-head">${ico('tag')} 热门标签 <button class="btn small ghost" data-tip="查看全部标签" aria-label="查看全部标签">更多</button></div>
        <div class="tag-cloud-wrap">${TAGS.map(
          t => `<button class="tag-cloud" data-tag="${t.name}" aria-pressed="false">#${t.name}<span class="cnt">${t.n}</span></button>`
        ).join('')}</div>
      </div>`;

const popupOrganize = () => {
  const groups = ['代码', '工具', '学习', '设计'].map(tag => ({
    tag,
    items: BOOKMARKS.filter(b => b.g.includes(tag)).slice(0, 3),
  }));
  return `      <div class="org-bar">
        <div class="org-seg" role="tablist" aria-label="组织视图">
          <button class="org-tab active" role="tab" aria-selected="true">${ico('tag')} 标签</button>
          <button class="org-tab" role="tab" aria-selected="false">${ico('folder')} 文件夹</button>
        </div>
        <div class="org-tools">
          <button class="org-btn" data-tip="目录树（浏览 / 跨层移动）" aria-label="打开目录树">${ico('folder')}目录树</button>
        </div>
      </div>
      <p class="org-hint">按标签浏览与筛选（一个书签可以有多个标签），点 #标签 快速过滤</p>
${groups.map(g => popupGroup(g.tag, g.items)).join('\n')}`;
};

// ---------------------------------------------------------------------------
// 6. newtab 模板（照搬 newtab.js:244-299 的输出格式）
// ---------------------------------------------------------------------------
const ntActions = () => `        <div class="nt-actions">
          <button type="button" class="nt-action" data-tip="复制链接" aria-label="复制链接">${ico('copy')}</button>
          <button type="button" class="nt-action" data-tip="隐藏" aria-label="隐藏">${ico('eye')}</button>
          <button type="button" class="nt-action" data-tip="编辑" aria-label="编辑">${ico('edit')}</button>
          <button type="button" class="nt-action danger" data-tip="删除（30 天内可恢复）" aria-label="删除">${ico('trash')}</button>
        </div>`;

const ntCard = it => `        <div class="nt-card-wrap" id="nt-card-${it.h}" role="option" aria-selected="false">
          <a class="nt-card" href="${it.u}" data-tip="${it.t}">
            ${fav(it)}
            <div class="nt-card-body">
              <div class="nt-card-title">${it.t}</div>
              <div class="nt-card-host">${it.h}</div>
              <div class="nt-card-tags">${it.g.map(g => `<span class="nt-tag-chip">#${g}</span>`).join('')}</div>
            </div>
          </a>
${ntActions()}
        </div>`;

const ntListRow = it => `        <div class="nt-card-wrap nt-row" id="nt-card-${it.h}" role="option" aria-selected="false">
          <a class="nt-row-link" href="${it.u}" data-tip="${it.t}">
            ${fav(it)}
            <span class="nt-row-title">${it.t}</span>
            <span class="nt-row-meta">
              <span class="nt-row-host">${it.h}</span>
              <span class="nt-row-folder" data-tip="${it.p}">${it.p.split(' / ').slice(-2).join(' / ')}</span>
              <span class="nt-row-tags">${it.g
                .slice(0, 2)
                .map(g => `<span class="nt-tag-chip">#${g}</span>`)
                .join('')}${it.g.length > 2 ? `<span class="nt-tag-chip more">+${it.g.length - 2}</span>` : ''}</span>
            </span>
          </a>
${ntActions()}
        </div>`;

const ntTagBar = () =>
  `<button class="nt-tag active" data-tag="" aria-pressed="true">全部 <span class="cnt">128</span></button>` +
  TAGS.map(t => `<button class="nt-tag" data-tag="${t.name}" aria-pressed="false">#${t.name} <span class="cnt">${t.n}</span></button>`).join('');

// ---------------------------------------------------------------------------
// 7. 设置页导航（照搬 options.js:1448-1475 的输出格式）
// ---------------------------------------------------------------------------
function optionsNav(html) {
  const ids = [...html.matchAll(/<section class="opt-section[^"]*" id="([^"]+)"/g)].map(m => m[1]);
  const items = ids.map(id => {
    const m = html.match(new RegExp(`id="${id}"[\\s\\S]*?<h2>([\\s\\S]*?)<`));
    return { id, label: m ? strip(m[1]) : id };
  });
  return (
    '<div class="opt-nav-title">设置分组</div>' +
    items.map(s => `<a class="opt-nav-link" href="#${s.id}" data-target="${s.id}">${s.label}</a>`).join('') +
    '<select id="optNavSelect" class="opt-nav-select" aria-label="跳转到设置分组">' +
    items.map(s => `<option value="${s.id}">${s.label}</option>`).join('') +
    '</select>'
  );
}

// ---------------------------------------------------------------------------
// 8. 小工具：切换激活态
// ---------------------------------------------------------------------------
function activateTab(html, tab) {
  return html.replace(
    /<button\s+class="tab(?: active)?"\s+role="tab"\s+aria-selected="(?:true|false)"\s+aria-controls="content"\s+data-tab="([a-z]+)"\s*>/g,
    (m, name) =>
      `<button class="tab${name === tab ? ' active' : ''}" role="tab" aria-selected="${name === tab}" aria-controls="content" data-tab="${name}">`
  );
}

function activateView(html, view) {
  return html
    .replace(/(id="ntViewGrid"[\s\S]*?class="nt-view-btn)(?: active)?(")/, (m, a, b) => `${a}${view === 'grid' ? ' active' : ''}${b}`)
    .replace(/(id="ntViewList"[\s\S]*?class="nt-view-btn)(?: active)?(")/, (m, a, b) => `${a}${view === 'list' ? ' active' : ''}${b}`);
}

// ---------------------------------------------------------------------------
// 9. 生成
// ---------------------------------------------------------------------------
const written = [];
const emit = (name, html) => {
  writeFileSync(join(outDir, name), html, 'utf8');
  written.push(name);
};

const popupSrc = transform(read('popup.html'));
const LOADING = '<div class="loading" role="status">正在扫描书签…</div>';
const VERSION_SPAN = '<span id="popupVersion" class="version-chip" data-tip="扩展版本号"></span>';

emit(
  'popup-overview.html',
  activateTab(popupSrc, 'overview')
    .replace(LOADING, popupOverview())
    .replace(VERSION_SPAN, VERSION_SPAN.replace('></span>', '>v1.0.1</span>'))
);

emit(
  'popup-organize.html',
  activateTab(popupSrc, 'organize')
    .replace(LOADING, popupOrganize())
    .replace(VERSION_SPAN, VERSION_SPAN.replace('></span>', '>v1.0.1</span>'))
);

const ntSrc = transform(read('newtab.html'))
  .replace(
    '<span class="nt-version" id="ntVersion" data-tip="扩展版本号"></span>',
    '<span class="nt-version" id="ntVersion" data-tip="扩展版本号">v1.0.1</span>'
  )
  .replace(
    '<span class="nt-count" id="ntCount"></span>',
    '<span class="nt-count" id="ntCount">共 128 个书签</span>'
  )
  .replace('<div class="nt-tags" id="ntTags"></div>', `<div class="nt-tags" id="ntTags">${ntTagBar()}</div>`)
  // 骨架屏只在初始化期间出现，快照里隐藏
  .replace(
    '<div class="nt-loading" id="ntLoading" aria-hidden="true">',
    '<div class="nt-loading hidden" id="ntLoading" aria-hidden="true">'
  );

const NT_GRID = '<div class="nt-grid" id="ntGrid" role="listbox" aria-label="书签列表" tabindex="0"></div>';

emit(
  'newtab-cards.html',
  activateView(ntSrc, 'grid').replace(
    NT_GRID,
    NT_GRID.replace('></div>', `>\n${BOOKMARKS.map(ntCard).join('\n')}\n      </div>`)
  )
);

emit(
  'newtab-list.html',
  activateView(ntSrc, 'list')
    .replace('class="nt-grid" id="ntGrid"', 'class="nt-grid is-list" id="ntGrid"')
    .replace(
      NT_GRID.replace('class="nt-grid"', 'class="nt-grid is-list"'),
      NT_GRID.replace('class="nt-grid"', 'class="nt-grid is-list"').replace(
        '></div>',
        `>\n${BOOKMARKS.map(ntListRow).join('\n')}\n      </div>`
      )
    )
);

const optionsSrc = transform(read('options.html'));
emit(
  'options.html',
  optionsSrc
    .replace('<b id="optVersion"></b>', '<b id="optVersion">v1.0.1</b>')
    .replace(
      '<nav id="optNav" class="opt-nav" aria-label="设置分组导航"></nav>',
      `<nav id="optNav" class="opt-nav" aria-label="设置分组导航">${optionsNav(optionsSrc)}</nav>`
    )
);

console.log(`已生成 ${written.length} 个快照 → docs/stitch/snapshots/`);
for (const f of written) console.log(`  · ${f}`);
