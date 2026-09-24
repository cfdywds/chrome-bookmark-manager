import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file), 'utf-8').replace(/\r\n/g, '\n');
// 归一化空白：断言只关心声明本身，不关心 prettier 的换行/缩进
const flat = source => source.replace(/\s+/g, ' ');

const popupHtml = read('popup.html');
const newtabHtml = read('newtab.html');
const optionsHtml = read('options.html');
const popupCss = read('css/popup.css');
const newtabCss = read('css/newtab.css');
const tokensCss = read('css/tokens.css');
const uiJs = read('js/ui.js');
const sprite = read('icons/sprite.svg');
const popupJs = read('js/popup.js');
const newtabJs = read('js/newtab.js');
const optionsJs = read('js/options.js');

// 取出 @media 查询块的顶层内容（支持一层嵌套）
function mediaBlocks(css, query) {
  const blocks = [];
  let cursor = 0;
  while ((cursor = css.indexOf(query, cursor)) >= 0) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(css.slice(open + 1, end));
    cursor = end;
  }
  return blocks;
}

// 列出块内 depth 0 上的选择器
function topLevelSelectors(block) {
  const selectors = [];
  let depth = 0;
  let buffer = '';
  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];
    if (char === '{') {
      if (depth === 0) selectors.push(buffer.trim());
      depth += 1;
      buffer = '';
    } else if (char === '}') {
      depth -= 1;
      buffer = '';
    } else if (depth === 0) {
      buffer += char;
    }
  }
  return selectors;
}

const SEMANTIC_TOKEN = /--(bg|panel|ink|ink-2|muted|line|line-2|primary|primary-2|primary-3|primary-soft|accent|pink|grad|grad-action|grad-brand|grad-soft|danger|danger-soft|warn|warn-soft|ok|ok-strong|ok-soft|shadow|shadow-sm|shadow-lg)\s*:/;

describe('设计 token 单一来源', () => {
  it('三个页面都先加载 tokens.css，再加载页面样式', () => {
    [popupHtml, newtabHtml, optionsHtml].forEach(html => {
      const tokens = html.indexOf('css/tokens.css');
      const popup = html.indexOf('css/popup.css');
      expect(tokens).toBeGreaterThan(-1);
      expect(popup).toBeGreaterThan(tokens);
      const newtab = html.indexOf('css/newtab.css');
      if (newtab > -1) expect(newtab).toBeGreaterThan(popup);
    });
  });

  it('调色板只在 tokens.css 定义，页面样式表不再重复定义语义变量', () => {
    expect(SEMANTIC_TOKEN.test(tokensCss)).toBe(true);
    expect(popupCss).not.toMatch(SEMANTIC_TOKEN);
    expect(newtabCss).not.toMatch(SEMANTIC_TOKEN);
  });

  it('新标签页显式主题在 tokens.css 中覆盖系统深色偏好', () => {
    expect(tokensCss).toContain(":root[data-nt-theme='light']");
    expect(tokensCss).toContain(":root[data-nt-theme='dark']");
    const dark = tokensCss.indexOf('@media (prefers-color-scheme: dark)');
    expect(dark).toBeGreaterThan(-1);
    expect(dark).toBeLessThan(tokensCss.indexOf(":root[data-nt-theme='light']"));
  });

  it('暗色模式只允许 :root 变量覆盖，不再写组件补丁选择器', () => {
    [tokensCss, popupCss, newtabCss].forEach(css => {
      mediaBlocks(css, '@media (prefers-color-scheme: dark)').forEach(block => {
        topLevelSelectors(block).forEach(selector => {
          expect(selector).toBe(':root');
        });
      });
    });
  });
});

describe('图标单一来源', () => {
  it('雪碧图覆盖所有被引用的图标 id', () => {
    const referenced = new Set();
    [popupHtml, newtabHtml, optionsHtml, popupJs, newtabJs, optionsJs].forEach(source => {
      [...source.matchAll(/sprite\.svg#(i-[a-z-]+)/g)].forEach(match => referenced.add(match[1]));
    });
    // popup.js 里 ICON('x') / ICON_SM('x') 的动态引用
    [...popupJs.matchAll(/ICON(?:_SM)?\('([a-z-]+)'\)/g)].forEach(match =>
      referenced.add(`i-${match[1]}`)
    );

    expect(referenced.size).toBeGreaterThan(20);
    [...referenced].forEach(id => expect(sprite).toContain(`id="${id}"`));
  });

  it('popup.html 不再内嵌 symbol 雪碧图', () => {
    expect(popupHtml).not.toContain('<symbol');
    expect(popupHtml).not.toMatch(/href="#i-/);
  });

  it('三个页面都加载 js/ui.js，且早于页面自身脚本', () => {
    const scripts = html => [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
    expect(scripts(popupHtml)).toEqual(['js/lib.js', 'js/ui.js', 'js/analyzer.js', 'js/popup-modals.js', 'js/popup-dnd.js', 'js/popup.js']);
    expect(scripts(newtabHtml)).toEqual(['js/lib.js', 'js/ui.js', 'js/analyzer.js', 'js/newtab.js', 'js/newtab-search-engine.js']);
    expect(scripts(optionsHtml)).toEqual(['js/lib.js', 'js/ui.js', 'js/options.js']);
  });
});

describe('交互规范', () => {
  it('共享 UI 原语提供焦点陷阱 / tooltip / 分级 toast / 快捷键注册表', () => {
    ['focusTrap', 'releaseTrap', 'onEscape', 'initTooltip', 'toast', 'registerShortcut', 'shortcutHtml'].forEach(
      name => expect(uiJs).toContain(`${name}: `)
    );
    expect(uiJs).toContain("danger: 'danger'");
    expect(uiJs).toContain('warn:');
    expect(uiJs).toContain('is-open');
  });

  it('弹层与抽屉接入 focusTrap，Esc 逻辑收敛到 UI 栈', () => {
    expect(popupJs).toContain('UI.focusTrap');
    expect(popupJs).toContain('UI.releaseTrap');
    expect(newtabJs).toContain('UI.focusTrap');
    expect(popupJs).not.toContain("wrap.addEventListener('keydown', onWrapClick)");
  });

  it('帮助抽屉的快捷键表由注册表生成，不再手写静态文案', () => {
    expect(popupHtml).toContain('id="helpShortcuts"');
    expect(popupHtml).not.toContain('<b>/</b> 聚焦搜索框');
    expect(popupJs).toContain('UI.registerShortcut');
    expect(popupJs).toContain('#helpShortcuts');
  });

  it('三个页面初始化统一 tooltip，并迁移到 data-tip', () => {
    [popupJs, newtabJs, optionsJs].forEach(source => expect(source).toContain('initTooltip'));
    expect(popupHtml).not.toMatch(/<(button|a)\b[^>]*\stitle=/);
    expect(popupHtml).toContain('data-tip="新增书签"');
  });

  it('侧边栏列表支持 aria-activedescendant 与选项语义', () => {
    expect(popupJs).toContain('aria-activedescendant');
    expect(popupJs).toContain('aria-selected');
    // #content 本身是 role="tabpanel"，不能被运行时改写成 listbox
    expect(popupJs).toContain('if (list === content())');
    expect(popupJs).toContain("list.setAttribute('role', 'listbox')");
  });

  it('有弹层 / 抽屉打开时页面级 Esc 让位给共享陷阱', () => {
    expect(popupJs).toContain('UI.hasOpenTrap');
    expect(uiJs).toContain('hasOpenTrap');
  });

  it('弹层打开时页面级快捷键全部让位（不只是 Esc）', () => {
    // 守卫必须位于 typing 分支之前，否则 j/k 会把焦点从弹层偷回背景列表
    expect(flat(popupJs)).toMatch(
      /if \(window\.UI && typeof UI\.hasOpenTrap === 'function' && UI\.hasOpenTrap\(\)\) return; if \(typing\) return;/
    );
    // 高亮时只有无陷阱才把焦点交给列表容器
    expect(flat(popupJs)).toContain(
      'if (!trapOpen && typeof list.focus === \'function\' && !list.contains(document.activeElement))'
    );
  });

  it('新标签页网格用 listbox / option 语义承载键盘高亮', () => {
    // aria-activedescendant 必须指向合法角色，否则屏幕阅读器不会播报当前卡片
    expect(newtabHtml).toContain('role="listbox"');
    expect(newtabHtml).toContain('aria-label="书签列表"');
    expect(newtabHtml).toContain('tabindex="0"');
    expect(newtabJs).toContain('role="option"');
    expect(newtabJs).toContain('aria-selected');
    expect(newtabJs).not.toContain('aria-current');
    // 卡片 / 行链接的完整标题提示统一走 data-tip，不再保留原生 title
    expect(newtabJs).not.toContain('title="${esc(it.title)}"');
    expect(newtabJs).toContain('data-tip="${esc(it.title)}"');
  });

  it('popup toast 渲染委托给共享 UI 原语，并保留淡出样式', () => {
    expect(popupJs).toContain('window.UI.toast(msg, type, action)');
    expect(flat(popupCss)).toContain('.toast-out {');
    // #toasts 是穿透层，动作按钮必须能接收鼠标点击
    expect(flat(popupCss)).toContain('pointer-events: auto;');
  });

  it('newtab toast 复用共享 UI 原语，统一自动消失时长与动作按钮行为', () => {
    expect(newtabJs).toContain("if (window.UI && typeof UI.toast === 'function')");
    expect(newtabJs).toContain('UI.toast(msg, kind, action, toastOptions);');
    expect(uiJs).toContain("compact ? (action ? 5200 : 1700) : action ? 10000 : 2500");
  });

  it('文件夹下拉签名包含父级与标题，重命名 / 跨层移动后不会残留旧结构', () => {
    expect(flat(newtabJs)).toContain("node.id + '/' + node.parentId + '/' + node.title + '/' + node.totalCount + '/' + node.visibleCount");
    expect(flat(newtabJs)).toContain("(node.childFolders || []).map(child => child.id).join('|')");
    expect(flat(newtabJs)).toContain("folderSignature = roots.map(node => node.id).join('|')");
    // 树对象未变时跳过全量拼接，避免每次输入防抖都做一次 O(n) 字符串拼接
    expect(newtabJs).toContain('if (tree !== folderTreeRef)');
  });

  it('危险操作集中到 options 页面底部，popup 不再提供备份和清空回收站入口', () => {
    expect(optionsHtml).toContain('id="backupExport"');
    expect(optionsHtml).toContain('id="backupImport"');
    expect(optionsHtml).toContain('id="trashClear"');
    expect(optionsHtml).toContain('id="confirmWrap"');
    expect(popupJs).not.toContain('data-action="backup-export"');
    expect(popupJs).not.toContain('data-action="backup-import"');
    expect(popupJs).not.toContain("action === 'trash-clear'");
    expect(optionsJs).not.toContain('window.confirm');
  });

  it('清理改造前遗留的未使用 CSS 选择器', () => {
    ['.act-card', '.wizard-card', '.backup-card', '.page-hint', '.plan-prefix', '.org-switch'].forEach(
      selector => expect(popupCss).not.toContain(selector)
    );
  });
});

describe('P2 结构与信息架构', () => {
  it('侧边栏提供搜索范围 chips，并保留 #标签 语法入口', () => {
    expect(popupHtml).toContain('id="searchScope"');
    ['all', 'title', 'tag', 'url'].forEach(scope =>
      expect(popupHtml).toContain(`data-scope="${scope}"`)
    );
    expect(popupJs).toContain('SEARCH_SCOPE');
  });

  it('批量栏改为悬浮 pill，并保留全选 / 反选能力', () => {
    expect(popupHtml).toContain('class="bulk-bar pill hidden"');
    expect(flat(popupCss)).toContain('.bulk-bar.pill {');
    expect(popupJs).toContain('has-bulk');
  });

  it('概览用卡片式快捷入口替代内嵌长列表', () => {
    expect(popupJs).toContain('overview-entries');
    expect(popupJs).toContain('entry-card');
    expect(flat(popupCss)).toContain('.entry-card');
    // 计数为 0 的卡片没有动作，不能渲染成可聚焦的伪按钮
    expect(flat(popupJs)).toContain(
      "const a11y = done ? ' aria-disabled=\"true\"' : ' role=\"button\" tabindex=\"0\"';"
    );
  });

  it('组织页提供副标题提示（降低理解成本）', () => {
    expect(popupJs).toContain('orgHintHtml');
    expect(popupJs).toContain('class="org-hint"');
    expect(flat(popupCss)).toContain('.org-hint {');
  });

  it('拖拽可发现性：把手 + 投放高亮 + 落位动画', () => {
    expect(popupJs).toContain('drag-handle');
    expect(popupJs).toContain('drop-target');
    expect(flat(popupCss)).toContain('.drag-handle');
    expect(flat(popupCss)).toContain('flip-in');
    // 把手是 button，必须显式 draggable 才能启动原生拖拽（否则书签排序 / 跨组移动失效）
    expect(popupJs).toContain('class="drag-handle" type="button" draggable="true"');
  });

  it('拖拽把手统一样式：行首同一类名，组织页常驻', () => {
    // 文件夹行与书签行共用 .drag-handle，旧的 .row-drag 双轨样式已移除
    expect(flat(popupCss)).not.toContain('.row-drag');
    expect(flat(popupJs)).not.toContain('row-drag');
    // 组织页（#orgBody）两类行把手常驻；其它页仍靠 :hover / 键盘高亮显示
    expect(flat(popupCss)).toContain('#orgBody .row .drag-handle');
    expect(flat(popupCss)).toContain('.row:hover .drag-handle');
    // 文件夹行把手必须在行首：紧跟在复选框区之后、文件夹图标之前
    const row = popupJs.slice(popupJs.indexOf('function folderRow(f)'), popupJs.indexOf('function folderRowEdit'));
    expect(row.indexOf('class="drag-handle"')).toBeGreaterThan(-1);
    expect(row.indexOf('class="drag-handle"')).toBeLessThan(row.indexOf('FOLDER_ICON_SM'));
  });

  it('提示气泡单轨：help-dot 不再用 CSS ::after 复制一套', () => {
    expect(flat(popupCss)).not.toContain('.help-dot[data-tip]::after');
    expect(flat(popupCss)).not.toContain('.help-dot[data-tip]:hover::after');
  });

  it('提示卡边框走主题 token，暗色下不再残留浅蓝硬编码', () => {
    expect(tokensCss).toContain('--hint-line: var(--c-hint-line-l)');
    expect(popupCss).not.toContain('#cfe3f9');
    // newtab 显式主题也会覆盖系统偏好，两个显式主题块必须各自定义该 token
    expect(tokensCss).toContain(':root[data-nt-theme=\'light\']');
    expect(flat(tokensCss).split(":root[data-nt-theme='light']")[1]).toContain(
      '--hint-line: var(--c-hint-line-l);'
    );
    expect(flat(tokensCss).split(":root[data-nt-theme='dark']")[1]).toContain(
      '--hint-line: var(--c-hint-line-d);'
    );
  });

  it('新标签页提供紧凑列表视图、弹窗式文件夹筛选与一键清除筛选', () => {
    expect(newtabHtml).toContain('id="ntViewList"');
    expect(newtabHtml).toContain('id="ntFilterToggle"');
    // 文件夹筛选改为弹窗：不再有内嵌筛选卡片与原生 select 兜底
    expect(newtabHtml).toContain('id="ntFolderModal"');
    expect(newtabHtml).toContain('id="ntFolderSummary"');
    expect(newtabHtml).toContain('id="ntFolderMenu"');
    expect(newtabHtml).toContain('id="ntFolderClear"');
    expect(newtabHtml).toContain('id="ntFolderClose"');
    expect(newtabHtml).not.toContain('id="ntFilterBar"');
    expect(newtabHtml).not.toContain('id="ntFolderTrigger"');
    // 搜索框内的一键清除入口
    expect(newtabHtml).toContain('id="ntFilterClear"');
    expect(newtabJs).toContain('clearAllFilters');
    expect(newtabJs).toContain('hasActiveFilters');
    expect(newtabJs).toContain('openFolderModal');
    expect(newtabJs).toContain('applyFolder');
    expect(newtabJs).toContain('bmNewtabView');
    expect(flat(newtabCss)).toContain('content-visibility: auto');
    expect(newtabJs).toContain('nt-tag-chip');
    expect(flat(newtabCss)).toContain('.nt-folder-option[aria-selected=\'true\']');
    expect(flat(newtabCss)).toContain('.nt-folder-options');
    expect(flat(newtabCss)).toContain('.nt-filter-clear');
    expect(flat(newtabCss)).toContain('.nt-row-meta');
  });

  it('列表行撑满行高，各列垂直居中', () => {
    const rule = flat(newtabCss).match(/\.nt-row-link\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    // 行容器高度由 min-height 决定、没有确定高度，百分比高度会让内容贴顶
    expect(rule[1]).toContain('align-self: stretch');
    expect(rule[1]).not.toContain('height: 100%');
    expect(flat(newtabCss)).toMatch(/\.nt-grid\.is-list \.nt-card-wrap \{[^}]*min-height: 28px/);
  });

  it('新标签页下滑后固定标签栏，并保持标签正常换行', () => {
    expect(flat(newtabCss)).toContain('.nt-head { position: sticky;');
    expect(flat(newtabJs)).toContain("head.classList.toggle('is-stuck'");
    expect(flat(newtabCss)).toContain('.nt-head.is-stuck .nt-tags { flex-wrap: wrap;');
    expect(flat(newtabCss)).not.toContain('.nt-head.is-stuck .nt-tags { flex-wrap: nowrap;');
  });

  it('新标签页键盘导航可完整操作卡片', () => {
    expect(newtabJs).toContain('kb-active');
    expect(newtabJs).toContain('aria-activedescendant');
  });

  it('设置页提供锚点导航、分组状态摘要与危险区', () => {
    expect(optionsHtml).toContain('id="optNav"');
    expect(optionsHtml).toContain('danger-zone');
    expect(optionsJs).toContain('section-status');
  });

  it('保存反馈在共享原语缺失时退回内联提示，不静默丢反馈', () => {
    expect(optionsJs).toContain("else setMsg(message, level === 'danger' ? 'err' : 'ok');");
  });

  it('三页版本号统一取自 manifest，格式为 v<version>', () => {
    expect(popupHtml).toContain('id="popupVersion"');
    [popupJs, newtabJs, optionsJs].forEach(source =>
      expect(source).toContain("'v' + chrome.runtime.getManifest().version")
    );
  });
});

describe('字体 / 字号 token 与主题映射同步（UI 移植 P0）', () => {
  it('tokens.css 提供唯一的字体族与五档字号阶梯', () => {
    expect(flat(tokensCss)).toContain(
      "--font-sans: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;"
    );
    expect(tokensCss).toContain('--font-mono:');
    [
      '--fs-meta: 12px;',
      '--fs-title: 14px;',
      '--fs-body: 15px;',
      '--fs-section: 18px;',
      '--fs-display: 24px;'
    ].forEach(decl => expect(flat(tokensCss)).toContain(decl));

    // 字形字号（emoji 插画 / favicon 兜底字母 / 图标字形）与文本阶梯分离：
    // 它们与容器尺寸成对出现，不随文本整体缩放，但同样只在 tokens.css 定义一次
    [
      '--fs-glyph-fav-xs',
      '--fs-glyph-badge',
      '--fs-glyph-brand',
      '--fs-glyph-search',
      '--fs-glyph-fav',
      '--fs-glyph-brand-lg',
      '--fs-glyph-err',
      '--fs-glyph-empty',
      '--fs-glyph-empty-lg'
    ].forEach(name => expect(flat(tokensCss)).toContain(name + ':'));

    // 回归防线：组件样式表不得再出现裸 px 字号。历史上有 69 处散落硬编码，
    // 导致只改 token 时界面一部分变大、一部分不变，阶梯形同虚设。
    [popupCss, newtabCss].forEach(css => {
      expect(css.match(/font-size:\s*[\d.]+px/g) || []).toEqual([]);
    });

    // 窄 side panel（340–380px）下顶栏搜索框只有约 162px 可用宽，
    // placeholder 必须留在 meta 档，否则「搜索标题、网址、域名、标签」会被截尾；
    // 大搜索框 .lg 宽度充裕，显式还原成 title 档保持与输入文字同档。
    expect(flat(popupCss)).toMatch(
      /\.search-box input::placeholder \{[^}]*font-size: var\(--fs-meta\)/
    );
    expect(flat(popupCss)).toMatch(
      /\.search-box\.lg input::placeholder \{[^}]*font-size: var\(--fs-title\)/
    );
    // 概览入口卡片低于 210px 时，「空文件夹」会被压成每行一个字（竖排），
    // 因此窄宽度必须退成单列而不是继续挤两列。
    expect(flat(popupCss)).toContain('repeat(auto-fit, minmax(210px, 1fr))');
    // 页面样式表不再各写一份字体栈（历史分叉：newtab 用 BlinkMacSystemFont）
    [popupCss, newtabCss].forEach(css => {
      expect(css).not.toContain('BlinkMacSystemFont');
      expect(css).not.toContain('-apple-system');
      expect(css).not.toContain('ui-monospace');
    });
  });

  it('toast 文字色在四个主题映射块中同步定义', () => {
    const flatTokens = flat(tokensCss);
    // 默认亮色块 + data-nt-theme=light 各一次，系统深色块 + data-nt-theme=dark 各一次
    expect(flatTokens.match(/--toast-ink: var\(--c-toast-ink-l\);/g)).toHaveLength(2);
    expect(flatTokens.match(/--toast-ink: var\(--c-toast-ink-d\);/g)).toHaveLength(2);
    expect(flatTokens.match(/--toast-muted: var\(--c-toast-muted-l\);/g)).toHaveLength(2);
    expect(flatTokens.match(/--toast-muted: var\(--c-toast-muted-d\);/g)).toHaveLength(2);
  });

  it('实底前景色（on-solid / on-grad）在四个主题映射块中同步定义', () => {
    const flatTokens = flat(tokensCss);
    [
      ['--on-solid', '--c-on-solid-l'],
      ['--on-solid', '--c-on-solid-d'],
      ['--on-grad', '--c-on-grad-l'],
      ['--on-grad', '--c-on-grad-d']
    ].forEach(([semantic, scale]) => {
      const pattern = new RegExp(`${semantic}: var\\(${scale}\\);`, 'g');
      expect(flatTokens.match(pattern)).toHaveLength(2);
    });
    // 深色语义色偏浅，其上的前景必须是深墨字，白字只有 2.6:1
    expect(tokensCss).toContain('--c-on-solid-d: #0f1117;');
    expect(flat(tokensCss)).not.toContain('--c-on-solid-d: #ffffff;');
  });

  it('警告色与深色品牌渐变满足 WCAG AA', () => {
    // warn on warn-soft 由 4.48:1 提升到 6.3:1
    expect(tokensCss).toContain('--c-warn-l: #92400e;');
    expect(tokensCss).not.toContain('--c-warn-l: #b45309;');
    // 深色渐变起点不得浅于 #2563eb，否则白字对比跌破 4.5:1
    expect(flat(tokensCss)).not.toContain('linear-gradient(135deg, #3b82f6');
  });
});

describe('触屏（无 hover）下行内操作必须仍然可达', () => {
  it('popup 的行操作按钮与拖拽把手在 hover: none 下常驻且可点', () => {
    // 这三颗按钮默认 opacity: 0 + pointer-events: none；触屏既没有 hover 可触发，
    // 又因为 pointer-events: none 收不到点击（进不了 :focus-within），必须有兜底。
    const touch = mediaBlocks(popupCss, '@media (hover: none)').join('\n');
    expect(touch).not.toBe('');
    ['.row > .row-eye', '.row > .row-ai', '.row > .row-edit'].forEach(selector => {
      expect(touch).toContain(selector);
    });
    expect(touch).toContain('pointer-events: auto');
    // 拖拽把手（书签行 / 文件夹行已统一为 .drag-handle）同样默认隐藏
    expect(touch).toContain('.drag-handle');
  });

  it('默认态确实是隐藏的，触屏兜底才有意义（反向断言）', () => {
    const flatPopup = flat(popupCss);
    const combined = String.raw`\.row > \.row-eye, \.row > \.row-ai, \.row > \.row-edit \{`;
    expect(flatPopup).toMatch(new RegExp(`${combined}[^}]*opacity: 0;`));
    expect(flatPopup).toMatch(new RegExp(`${combined}[^}]*pointer-events: none;`));
  });

  it('newtab 的操作条有同样的触屏兜底（两页策略一致）', () => {
    const touch = mediaBlocks(newtabCss, '@media (hover: none)').join('\n');
    expect(touch).toContain('.nt-actions');
    expect(touch).toContain('pointer-events: auto');
  });
});
