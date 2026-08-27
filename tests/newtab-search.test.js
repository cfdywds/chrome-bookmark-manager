import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const newtabSource = readFileSync(join(__dirname, '..', 'js', 'newtab.js'), 'utf-8').replace(/\r\n/g, '\n');

function getFunctionSource(name) {
  const start = newtabSource.indexOf(`function ${name}(`);
  const end = newtabSource.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return newtabSource.slice(start, end + 4).replace(`function ${name}`, 'function');
}

describe('新标签页搜索', () => {
  it('初始化时主动拉取已有的云端标签', () => {
    expect(newtabSource).toContain('await window.BM.pullTagsFromCloud()');
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
    const ICON = () => '';
    const cardHtml = eval(`(${getFunctionSource('cardHtml')})`);

    const html = cardHtml({
      id: 'unsafe', title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', tags: []
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('aria-disabled="true"');
  });
});
