import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const newtabSource = readFileSync(join(__dirname, '..', 'js', 'newtab.js'), 'utf-8').replace(/\r\n/g, '\n');
const newtabCss = readFileSync(join(__dirname, '..', 'css', 'newtab.css'), 'utf-8').replace(/\r\n/g, '\n');

function getFunctionSource(name) {
  const start = newtabSource.indexOf(`function ${name}(`);
  const end = newtabSource.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return newtabSource.slice(start, end + 4).replace(`function ${name}`, 'function');
}

describe('新标签页搜索', () => {
  it('初始化时主动拉取已有的云端标签', () => {
    expect(newtabSource).toContain('await window.BM.pullTagsFromCloud()');
    expect(newtabSource).toContain('await window.BM.initializeSyncedTagConfiguration()');
    expect(newtabSource.indexOf('await window.BM.initializeSyncedTagConfiguration()'))
      .toBeLessThan(newtabSource.indexOf('await window.BM.pullTagsFromCloud()'));
    expect(newtabSource).toContain('if (tagConfigurationSyncReady)');
    expect(newtabSource).toContain('window.BM.watchTagConfiguration');
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
    expect(html).toContain('title="取消隐藏"');
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

  it('抽屉使用半透明灰色背景，并为深色主题保留对应层次', () => {
    expect(newtabCss).toContain('background: rgba(231, 234, 242, .58);');
    expect(newtabCss).toContain('background: rgba(35, 38, 51, .58);');
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
});
