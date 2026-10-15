import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('标准 Netscape HTML 书签互通', () => {
  let BM;

  beforeEach(async () => {
    vi.resetModules();
    // 注入最小浏览器 chrome mock
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn(),
        create: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue({})
        }
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({})
      }
    };
    await import('../js/lib.js');
    BM = globalThis.BM;
  });

  it('能导出符合 Netscape 规范的 HTML 字符串，并携带 TAGS 与时间戳', async () => {
    const fakeTree = [
      {
        id: '0',
        title: 'root',
        children: [
          {
            id: '1',
            title: '书签栏',
            dateAdded: 1720000000000,
            children: [
              {
                id: '101',
                title: 'GitHub',
                url: 'https://github.com',
                dateAdded: 1720000000000
              },
              {
                id: '102',
                title: '子文件夹',
                dateAdded: 1720000000000,
                children: [
                  {
                    id: '103',
                    title: '掘金',
                    url: 'https://juejin.cn',
                    dateAdded: 1720000000000
                  }
                ]
              }
            ]
          }
        ]
      }
    ];

    const fakeTags = {
      '101': ['开发', '开源'],
      '103': ['技术社区']
    };

    const { html, count } = BM.exportBookmarksHTML(fakeTree, fakeTags);
    expect(count).toBe(2);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<H1>Bookmarks</H1>');
    expect(html).toContain('<DT><H3 ADD_DATE="1720000000">书签栏</H3>');
    expect(html).toContain('<DT><A HREF="https://github.com" ADD_DATE="1720000000" TAGS="开发,开源">GitHub</A>');
    expect(html).toContain('<DT><A HREF="https://juejin.cn" ADD_DATE="1720000000" TAGS="技术社区">掘金</A>');
  });

  it('能健壮解析 Netscape HTML，提取文件夹、书签及 TAGS', () => {
    const sampleHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1720000000">工作常用</H3>
    <DL><p>
        <DT><A HREF="https://developer.mozilla.org" ADD_DATE="1720000000" TAGS="文档,MDN">MDN Web Docs</A>
        <DT><H3 ADD_DATE="1720000000">工具</H3>
        <DL><p>
            <DT><A HREF="https://caniuse.com" TAGS="前端兼容">Can I Use</A>
        </DL><p>
    </DL><p>
</DL><p>`;

    const parsed = BM.parseNetscapeHtml(sampleHtml);
    expect(parsed.length).toBe(1);
    const workFolder = parsed[0];
    expect(workFolder.title).toBe('工作常用');
    expect(workFolder.children.length).toBe(2);

    const mdn = workFolder.children[0];
    expect(mdn.type).toBe('bookmark');
    expect(mdn.title).toBe('MDN Web Docs');
    expect(mdn.url).toBe('https://developer.mozilla.org');
    expect(mdn.tags).toEqual(['文档', 'MDN']);

    const tools = workFolder.children[1];
    expect(tools.type).toBe('folder');
    expect(tools.title).toBe('工具');
    expect(tools.children[0].title).toBe('Can I Use');
    expect(tools.children[0].tags).toEqual(['前端兼容']);
  });
});
