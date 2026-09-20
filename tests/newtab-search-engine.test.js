import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '..', 'js', 'newtab-search-engine.js'), 'utf-8').replace(/\r\n/g, '\n');
const newtabHtml = readFileSync(join(__dirname, '..', 'newtab.html'), 'utf-8').replace(/\r\n/g, '\n');

function getFunctionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n  }', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return source.slice(start, end + 4).replace(`function ${name}`, 'function');
}

describe('新标签页搜索引擎', () => {
  it('将关键词编码后填入安全的 HTTP(S) 搜索模板', () => {
    const buildSearchUrl = eval(`(${getFunctionSource('buildSearchUrl')})`);

    expect(buildSearchUrl('书签 管家', 'https://www.google.com/search?q=%s')).toBe(
      'https://www.google.com/search?q=%E4%B9%A6%E7%AD%BE%20%E7%AE%A1%E5%AE%B6'
    );
    expect(buildSearchUrl('a&b', 'https://www.baidu.com/s?wd=%s')).toBe(
      'https://www.baidu.com/s?wd=a%26b'
    );
  });

  it('拒绝空关键词、非 HTTP(S) 模板和缺少占位符的模板', () => {
    const buildSearchUrl = eval(`(${getFunctionSource('buildSearchUrl')})`);

    expect(buildSearchUrl('', 'https://www.google.com/search?q=%s')).toBe('');
    expect(buildSearchUrl('test', 'javascript:alert(1)%s')).toBe('');
    expect(buildSearchUrl('test', 'https://www.google.com/search?q=test')).toBe('');
  });

  it('新标签页加载搜索引擎脚本并提供引擎选择器', () => {
    expect(newtabHtml).toContain('id="ntSearchEngine"');
    expect(newtabHtml).toContain('<script src="js/newtab-search-engine.js"></script>');
  });
});
