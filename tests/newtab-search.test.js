import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const newtabSource = readFileSync(join(__dirname, '..', 'js', 'newtab.js'), 'utf-8').replace(/\r\n/g, '\n');
const newtabCss = readFileSync(join(__dirname, '..', 'css', 'newtab.css'), 'utf-8').replace(/\r\n/g, '\n');
const newtabHtml = readFileSync(join(__dirname, '..', 'newtab.html'), 'utf-8').replace(/\r\n/g, '\n');
const popupHtml = readFileSync(join(__dirname, '..', 'popup.html'), 'utf-8').replace(/\r\n/g, '\n');

function getFunctionSource(name) {
  const start = newtabSource.indexOf(`function ${name}(`);
  const end = newtabSource.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return newtabSource.slice(start, end + 4).replace(`function ${name}`, 'function');
}

describe('新标签页搜索', () => {
  it('侧边栏和新标签页都提供开源仓库入口', () => {
    const repositoryUrl = 'https://github.com/cfdywds/chrome-bookmark-manager';

    // 侧边栏入口在操作指南抽屉底部（顶栏按钮精简后迁入）
    expect(popupHtml).toContain(`href="${repositoryUrl}"`);
    expect(popupHtml).toContain('rel="noopener noreferrer"');
    expect(popupHtml).toContain('GitHub 开源仓库');
    expect(newtabHtml).toContain(`href="${repositoryUrl}"`);
    expect(newtabHtml).toContain('rel="noopener noreferrer"');
    expect(newtabHtml).toContain('aria-label="查看开源仓库"');
  });

  it('编辑 URL 后显式迁移标签同步记录', () => {
    expect(newtabSource).toContain('await window.BM.migrateTagSyncUrl(it.id, it.url, normalizedUrl);');
  });

  it('初始化时主动拉取已有的云端标签', () => {
    expect(newtabSource).toContain('await window.BM.pullTagsFromCloud()');
    expect(newtabSource).toContain('const tagConfigurationTask = window.BM.initializeSyncedTagConfiguration()');
    expect(newtabSource).toContain('await waitForInitialTagSync(tagConfigurationTask);');
    expect(newtabSource).toContain('tagConfigurationTask.then(async result =>');
    expect(newtabSource).not.toContain('window.BM.watchTagConfiguration');
    expect(newtabSource).not.toContain('window.BM.watchTagSync');
  });

  it('初始同步未返回时，在时限后继续初始化', async () => {
    vi.useFakeTimers();
    const INITIAL_TAG_SYNC_WAIT_MS = 1200;
    const task = new Promise(() => {});
    const waitForInitialTagSync = eval(`(${getFunctionSource('waitForInitialTagSync')})`);

    try {
      const waiting = waitForInitialTagSync(task);
      await vi.advanceTimersByTimeAsync(INITIAL_TAG_SYNC_WAIT_MS);
      await expect(waiting).resolves.toEqual({ timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('仅在输入搜索词时纳入匹配的隐藏书签', () => {
    const DATA = {
      items: [
        { id: 'visible-work', title: '公开工作资料', tags: ['工作'], dateAdded: 1 },
        { id: 'hidden-work', title: '隐藏工作资料', tags: ['工作'], hidden: true, dateAdded: 2 },
        { id: 'hidden-private', title: '隐藏私人资料', tags: ['私人'], hidden: true, dateAdded: 3 }
      ]
    };
    let activeTag = '';
    let search = '';
    const filtered = eval(`(${getFunctionSource('filtered')})`);

    expect(filtered().map(it => it.id)).toEqual(['visible-work']);

    activeTag = '工作';
    expect(filtered().map(it => it.id)).toEqual(['visible-work']);

    activeTag = '';
    search = '隐藏 工作';
    expect(filtered().map(it => it.id)).toEqual(['hidden-work']);

    search = '#工作';
    expect(filtered().map(it => it.id)).toEqual(['hidden-work', 'visible-work']);

    search = '#';
    expect(filtered().map(it => it.id)).toEqual(['visible-work']);
  });

  it('将隐藏搜索结果标记为已隐藏，并提供取消隐藏操作', () => {
    const esc = eval(`(${getFunctionSource('esc')})`);
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const faviconUrl = () => 'chrome-extension://test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=64';
    const ICON = () => '';
    const cardHtml = eval(`(${getFunctionSource('cardHtml')})`);

    const html = cardHtml({
      id: 'hidden', title: '隐藏书签', url: 'https://example.com/', tags: [], hidden: true
    });

    expect(html).toContain('class="nt-card-hidden">已隐藏</span>');
    expect(html).toContain('data-tip="取消隐藏"');
  });

  it('对标题进行 HTML 转义，并禁用非 HTTP(S) 链接', () => {
    const esc = eval(`(${getFunctionSource('esc')})`);
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const faviconUrl = () => '';
    const ICON = () => '';
    const cardHtml = eval(`(${getFunctionSource('cardHtml')})`);

    const html = cardHtml({
      id: 'unsafe', title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', tags: []
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('aria-disabled="true"');
  });

  it('仅为 HTTP(S) 网站生成扩展内 favicon 地址', () => {
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const chrome = {
      runtime: {
        getURL: path => `chrome-extension://test${path}`
      }
    };
    const faviconUrl = eval(`(${getFunctionSource('faviconUrl')})`);

    expect(faviconUrl('https://example.com/docs?a=1')).toBe(
      'chrome-extension://test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1&size=64'
    );
    expect(faviconUrl('javascript:alert(1)')).toBe('');
  });

  it('卡片包含网站图标回退内容和四个抽屉操作', () => {
    const esc = eval(`(${getFunctionSource('esc')})`);
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const faviconUrl = () => 'chrome-extension://test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=64';
    const ICON = () => '<svg></svg>';
    const cardHtml = eval(`(${getFunctionSource('cardHtml')})`);

    const html = cardHtml({
      id: 'example', title: 'Example', host: 'example.com', url: 'https://example.com/', tags: []
    });

    expect(html).toContain('class="nt-fav-fallback">E</span>');
    expect(html).toContain('class="nt-fav-img"');
    expect(html).toContain('aria-label="复制链接"');
    expect(html).toContain('aria-label="隐藏"');
    expect(html).toContain('aria-label="编辑"');
    expect(html).toContain('aria-label="删除"');
    expect((html.match(/data-nt-act=/g) || [])).toHaveLength(4);
  });

  it('卡片视图展开全部标签，不再折叠成 +N', () => {
    const esc = eval(`(${getFunctionSource('esc')})`);
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const faviconUrl = () => '';
    const ICON = () => '<svg></svg>';
    const cardHtml = eval(`(${getFunctionSource('cardHtml')})`);

    const html = cardHtml({
      id: 'many',
      title: '多标签站点',
      host: 'example.com',
      url: 'https://example.com/',
      tags: ['工作', '项目', '资料', '教程']
    });

    ['工作', '项目', '资料', '教程'].forEach(tag => {
      expect(html).toContain(`class="nt-tag-chip">#${tag}</span>`);
    });
    expect(html).not.toContain('nt-tag-chip more');
  });

  it('列表行单行承载标题/站点/目录/标签，并收敛标签与目录层级', () => {
    const esc = eval(`(${getFunctionSource('esc')})`);
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    const faviconUrl = () => '';
    const ICON = () => '<svg></svg>';
    const rowHtml = eval(`(${getFunctionSource('rowHtml')})`);

    const html = rowHtml({
      id: 'row',
      title: '列表书签',
      host: 'example.com',
      url: 'https://example.com/docs',
      path: ['书签栏', '资料'],
      tags: ['工作', '项目', '资料'],
      hidden: true
    });

    // 单行四列：标题 / 站点 / 目录 / 标签（列由 CSS 网格对齐，行内不再有第二行主信息）
    expect(html).toContain('class="nt-row-title">列表书签</span>');
    expect(html).toContain('class="nt-row-host">example.com</span>');
    // 目录去掉「书签栏」这类对每行都相同的根容器段，完整路径退到 tooltip
    expect(html).toContain('class="nt-row-folder" data-tip="书签栏 / 资料">资料</span>');
    expect(html).toContain('class="nt-row-meta"');
    expect(html).toContain('class="nt-row-tags"');
    // 标签列宽固定：最多 2 个 + 余数，避免撑破列宽导致跨行错位
    expect(html).toContain('class="nt-tag-chip">#工作</span>');
    expect(html).toContain('class="nt-tag-chip">#项目</span>');
    expect(html).toContain('class="nt-tag-chip more">+1</span>');
    expect(html).not.toContain('#资料');
    expect(html).toContain('class="nt-row-hidden">已隐藏</span>');
    expect(html).not.toContain('nt-row-body');
    expect(html).not.toContain('nt-row-loc');
  });

  it('复制动作保留书签的完整原始链接', async () => {
    const safeHttpUrl = url => /^https?:/i.test(url) ? url : '';
    let copied = '';
    const navigator = { clipboard: { writeText: async value => { copied = value; } } };
    const copyBookmarkUrl = eval(`(${getFunctionSource('copyBookmarkUrl')})`);
    const url = 'https://example.com/docs?token=abc#section';

    await expect(copyBookmarkUrl(url)).resolves.toBeUndefined();
    expect(copied).toBe(url);
    await expect(copyBookmarkUrl('javascript:alert(1)')).rejects.toThrow('无效书签链接');
  });

  it('极窄屏将抽屉操作改为两列，避免裁剪删除按钮', () => {
    expect(newtabCss).toContain('@media (max-width: 320px)');
    expect(newtabCss).toContain('grid-template-columns: repeat(2, 36px);');
  });

  it('浅色抽屉保持可辨识的复制成功态和键盘焦点环', () => {
    expect(newtabCss).toContain('color: #047857;');
    expect(newtabCss).toContain('outline: 2px solid var(--primary);');
  });

  it('卡片悬浮操作使用向面板色渐隐的纱罩，无描边盖板', () => {
    expect(newtabCss).toContain('background: linear-gradient(90deg, transparent, var(--panel) 42%);');
    expect(newtabCss).not.toMatch(/\.nt-actions[^}]*border-left/);
    expect(newtabCss).not.toMatch(/\.nt-actions[^}]*backdrop-filter/);
  });

  it('列表视图的操作栏默认收起，触屏设备保持可操作', () => {
    expect(newtabCss).toContain('.nt-grid.is-list .nt-actions {');
    expect(newtabCss).toContain('opacity: 0;');
    expect(newtabCss).toContain('.nt-grid.is-list .nt-card-wrap:hover .nt-actions');
    expect(newtabCss).toContain('.nt-grid.is-list .nt-actions {\n    opacity: 1;\n    pointer-events: auto;\n  }');
  });

  it('列表视图靠单行密度与列对齐换取「找书签」效率', () => {
    // 行高 28px（卡片 112px）：整块只有一条外框线 + 行分隔线，不再逐行叠卡片
    expect(newtabCss).toContain('.nt-grid.is-list .nt-card-wrap + .nt-card-wrap');
    expect(newtabCss).toMatch(/\.nt-grid\.is-list \.nt-card-wrap \{[^}]*min-height: 28px;/);
    // 列宽固定，跨行对齐才成立
    expect(newtabCss).toContain(
      'grid-template-columns: 16px minmax(0, 1fr) minmax(0, 190px) minmax(0, 158px) 150px;'
    );
    // 窄屏逐级收敛列，最后退成两行
    expect(newtabCss).toContain('@media (max-width: 1040px)');
    expect(newtabCss).toContain('@media (max-width: 900px)');
    expect(newtabCss).toContain('.nt-row-meta {\n    display: flex;');
    // 虚拟化占位高度必须跟着行高走，否则滚动条长度会跳
    expect(newtabCss).toContain('contain-intrinsic-size: auto 28px;');
    expect(newtabCss).toContain('contain-intrinsic-size: auto 52px;');
    // 空结果不留下一条空框线
    expect(newtabCss).toContain('.nt-grid.is-list:empty');
  });

  it('隐藏和删除成功提示使用轻量模式，并先更新当前列表', () => {
    expect(newtabSource).toContain("showToast('已隐藏', 'ok'");
    expect(newtabSource).toContain("showToast('已移入回收站', 'ok'");
    expect(newtabSource).toContain('removeDeletedItemFromData(liveItem);');
    expect(newtabSource).toContain('const toastOptions = compact ? { compact: true } : undefined;');
    expect(newtabCss).toContain('.toast.compact {');
  });

  it('窄屏保留仓库图标，并隐藏非关键的书签计数', () => {
    expect(newtabCss).toContain('.nt-source-link span { display: none; }');
    expect(newtabCss).toContain('@media (max-width: 420px)');
    expect(newtabCss).toContain('.nt-count { display: none; }');
    expect(newtabCss).toContain('min-width: 32px; min-height: 32px;');
  });

  it('打开书签后隐藏悬浮操作，直到鼠标移出卡片', () => {
    const activeClasses = new Set();
    let blurred = false;
    let leaveHandler = null;
    let leaveOptions = null;
    const wrap = {
      classList: {
        add: name => activeClasses.add(name),
        remove: name => activeClasses.delete(name)
      },
      addEventListener: (type, handler, options) => {
        expect(type).toBe('mouseleave');
        leaveHandler = handler;
        leaveOptions = options;
      }
    };
    const card = {
      hasAttribute: name => name === 'href',
      blur: () => { blurred = true; },
      closest: selector => selector === '.nt-card-wrap' ? wrap : null
    };
    const suppressHoverAfterOpen = eval(`(${getFunctionSource('suppressHoverAfterOpen')})`);

    suppressHoverAfterOpen(card);

    expect(blurred).toBe(true);
    expect(activeClasses.has('nt-card-opening')).toBe(true);
    expect(leaveOptions).toEqual({ once: true });
    leaveHandler();
    expect(activeClasses.has('nt-card-opening')).toBe(false);
  });

  it('目录下拉的引导线按层级生成，末枝才收束', () => {
    const folderGuideHtml = eval(`(${getFunctionSource('folderGuideHtml')})`);

    expect(folderGuideHtml([], false)).toBe('');
    expect(folderGuideHtml([true], false)).toBe('<i class="nt-folder-guide is-branch"></i>');
    expect(folderGuideHtml([false], true)).toBe('<i class="nt-folder-guide is-branch is-last"></i>');
    expect(folderGuideHtml([true, true], false)).toBe(
      '<i class="nt-folder-guide has-line"></i><i class="nt-folder-guide is-branch"></i>'
    );
    expect(folderGuideHtml([false, true], false)).toBe(
      '<i class="nt-folder-guide"></i><i class="nt-folder-guide is-branch"></i>'
    );
    expect(folderGuideHtml([true, false], true)).toBe(
      '<i class="nt-folder-guide has-line"></i><i class="nt-folder-guide is-branch is-last"></i>'
    );
    expect(folderGuideHtml([true, true], true)).toBe(
      '<i class="nt-folder-guide has-line"></i><i class="nt-folder-guide is-branch"></i>'
    );
  });
});
