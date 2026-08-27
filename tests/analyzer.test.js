import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const analyzerCode = readFileSync(join(__dirname, '..', 'js', 'analyzer.js'), 'utf-8');
const libCode = readFileSync(join(__dirname, '..', 'js', 'lib.js'), 'utf-8');

function restoreGlobal(name, previous) {
  if (previous === undefined) delete globalThis[name];
  else globalThis[name] = previous;
}

describe('分析引擎', () => {
  it('协议或 hash 路由不同的 URL 不会被判定为精确重复', async () => {
    const previousWindow = globalThis.window;
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const previousAnalyzer = globalThis.BMAnalyzer;
    const firstUrl = 'https://example.com/page';
    const secondUrl = 'http://example.com/page';
    const hashRouteOne = 'https://lanhuapp.com/web/#/item/project/product?id=one';
    const hashRouteTwo = 'https://lanhuapp.com/web/#/item/project/product?id=two';
    globalThis.window = globalThis;
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{
          id: 'root',
          children: [
            { id: 'one', title: '页面一', url: firstUrl, parentId: 'root' },
            { id: 'two', title: '页面二', url: secondUrl, parentId: 'root' },
            { id: 'three', title: '蓝湖页面一', url: hashRouteOne, parentId: 'root' },
            { id: 'four', title: '蓝湖页面二', url: hashRouteTwo, parentId: 'root' }
          ]
        }])
      },
      storage: { local: { get: vi.fn().mockResolvedValue({}) } }
    };

    try {
      new Function(libCode)();
      new Function(analyzerCode)();
      const result = await globalThis.BMAnalyzer.analyze();

      expect(result.itemsByUrl.get(firstUrl).map(item => item.id)).toEqual(['one']);
      expect(result.itemsByUrl.get(secondUrl).map(item => item.id)).toEqual(['two']);
      expect(result.itemsByUrl.get(hashRouteOne).map(item => item.id)).toEqual(['three']);
      expect(result.itemsByUrl.get(hashRouteTwo).map(item => item.id)).toEqual(['four']);
      expect(result.exactDuplicates).toEqual([]);
    } finally {
      restoreGlobal('window', previousWindow);
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('BM', previousBM);
      restoreGlobal('BMAnalyzer', previousAnalyzer);
    }
  });

  it('一次遍历识别所有嵌套空文件夹', async () => {
    const previousWindow = globalThis.window;
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const previousAnalyzer = globalThis.BMAnalyzer;
    globalThis.window = globalThis;
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([
          {
            id: 'root',
            children: [
              {
                id: 'bookmarks-bar',
                title: '书签栏',
                children: [
                  {
                    id: 'empty-top',
                    title: '空目录',
                    children: [{ id: 'empty-child', title: '子目录', children: [] }]
                  },
                  {
                    id: 'used',
                    title: '有书签',
                    children: [{ id: 'bookmark', title: '示例', url: 'https://example.com/' }]
                  }
                ]
              },
              {
                id: 'other-bookmarks',
                title: '其他书签',
                children: []
              }
            ]
          }
        ])
      }
    };
    globalThis.BM = {
      loadDomainGroups: vi.fn(),
      loadTags: vi.fn(),
      loadFixedTags: vi.fn(),
      loadHiddenIds: vi.fn(),
      getRegisteredDomain: host => host,
      urlKey: url => url,
      categorize: () => '未分类',
      detectSensitive: () => [],
      getTags: () => ({}),
      isHidden: () => false,
      routeKeyOf: () => '(首页)',
      FALLBACK_TAG: '其他'
    };

    try {
      new Function(analyzerCode)();
      const result = await globalThis.BMAnalyzer.analyze();

      expect(result.emptyFolders.map(folder => folder.id).sort()).toEqual([
        'empty-child',
        'empty-top'
      ]);
    } finally {
      restoreGlobal('window', previousWindow);
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('BM', previousBM);
      restoreGlobal('BMAnalyzer', previousAnalyzer);
    }
  });

  it('并行加载配置并在单轮聚合中保持各类统计结果', async () => {
    const previousWindow = globalThis.window;
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const previousAnalyzer = globalThis.BMAnalyzer;
    const resolvers = [];
    const deferredLoad = vi.fn(() => new Promise(resolve => resolvers.push(resolve)));
    globalThis.window = globalThis;
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([
          {
            id: 'root',
            children: [{
              id: 'work',
              title: '工作',
              children: [
                { id: 'a', title: 'A', url: 'https://example.com/team/a', parentId: 'work' },
                { id: 'a-copy', title: 'A 副本', url: 'https://example.com/team/a', parentId: 'work' },
                { id: 'b', title: 'B', url: 'https://example.com/team/b', parentId: 'work' },
                { id: 'hidden', title: '隐藏', url: 'https://example.com/team/a', parentId: 'work' },
                { id: 'sensitive', title: '敏感', url: 'https://secret.example.com/login', parentId: 'work' }
              ]
            }]
          }
        ])
      }
    };
    globalThis.BM = {
      loadDomainGroups: deferredLoad,
      loadTags: deferredLoad,
      loadFixedTags: deferredLoad,
      loadHiddenIds: deferredLoad,
      getRegisteredDomain: host => host.replace(/^secret\./, ''),
      urlKey: url => url,
      categorize: host => host === 'secret.example.com' ? '敏感' : '工作',
      detectSensitive: (_host, _url, title) => title === '敏感' ? [{ label: '登录', sev: 'high' }] : [],
      getTags: () => ({
        a: ['开发'],
        'a-copy': ['开发'],
        b: ['工具', '其他'],
        hidden: ['开发', '私密']
      }),
      isHidden: id => id === 'hidden',
      routeKeyOf: url => new URL(url).pathname.split('/').filter(Boolean)[0] || '(首页)',
      FALLBACK_TAG: '其他'
    };

    try {
      new Function(analyzerCode)();
      const analysis = globalThis.BMAnalyzer.analyze();
      await vi.waitFor(() => expect(deferredLoad).toHaveBeenCalledTimes(4));
      resolvers.splice(0).forEach(resolve => resolve());
      const result = await analysis;

      expect(result.exactDuplicates).toHaveLength(1);
      expect(result.exactDuplicates[0].items.map(item => item.id)).toEqual(['a', 'a-copy']);
      expect(result.categories.工作).toHaveLength(4);
      expect(result.tagStats).toEqual({ 开发: 2, 工具: 1 });
      expect(result.sensitive.map(item => item.id)).toEqual(['sensitive']);
      expect(result.tagView.hiddenItemCount).toBe(1);
      expect(result.tagView.visibleItems.map(item => item.id)).toEqual(['a', 'a-copy', 'b', 'sensitive']);
      expect(result.tagView.tagItemsByName.get('开发').map(item => item.id)).toEqual(['a', 'a-copy', 'hidden']);
      expect(result.tagView.visibleTagItemsByName.get('开发').map(item => item.id)).toEqual(['a', 'a-copy']);
      expect(result.tagView.allTagStats).toEqual({ 开发: 3, 工具: 1, 私密: 1 });
      expect(result.tagView.fallbackTaggedItemCount).toBe(1);
      expect(result.tagView.visibleFallbackTaggedItemCount).toBe(1);
    } finally {
      restoreGlobal('window', previousWindow);
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('BM', previousBM);
      restoreGlobal('BMAnalyzer', previousAnalyzer);
    }
  });

  it('复用未变化书签的元数据，并在配置变化时失效', async () => {
    const previousWindow = globalThis.window;
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const previousAnalyzer = globalThis.BMAnalyzer;
    const domainGroups = {};
    const tree = [{
      id: 'root',
      children: [{ id: 'bookmark', title: '示例', url: 'https://example.com/team/a', parentId: 'root' }]
    }];
    const getBookmarkMetadata = vi.fn((url, title) => ({
      host: 'example.com',
      domain: 'example.com',
      key: 'example.com/team/a',
      route: 'team',
      category: domainGroups['example.com'] || '未分类',
      sensitive: [],
      searchText: (url + ' ' + title).toLowerCase()
    }));
    globalThis.window = globalThis;
    globalThis.chrome = { bookmarks: { getTree: vi.fn().mockResolvedValue(tree) } };
    globalThis.BM = {
      loadDomainGroups: vi.fn(),
      loadTags: vi.fn(),
      loadFixedTags: vi.fn(),
      loadHiddenIds: vi.fn(),
      getDomainGroups: () => domainGroups,
      getBookmarkMetadata,
      getTags: () => ({}),
      isHidden: () => false,
      FALLBACK_TAG: '其他'
    };

    try {
      new Function(analyzerCode)();
      const first = await globalThis.BMAnalyzer.analyze();
      const second = await globalThis.BMAnalyzer.analyze();
      domainGroups['example.com'] = '示例站点';
      const third = await globalThis.BMAnalyzer.analyze();

      expect(getBookmarkMetadata).toHaveBeenCalledTimes(2);
      expect(first.itemById.get('bookmark')).toMatchObject({ id: 'bookmark', title: '示例' });
      expect(first.itemsByUrl.get('https://example.com/team/a')).toHaveLength(1);
      expect(second.items[0].category).toBe('未分类');
      expect(third.items[0].category).toBe('示例站点');
    } finally {
      restoreGlobal('window', previousWindow);
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('BM', previousBM);
      restoreGlobal('BMAnalyzer', previousAnalyzer);
    }
  });

  it('大型书签列表分批让出主线程，同时保留完整结果', async () => {
    const previousWindow = globalThis.window;
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const previousAnalyzer = globalThis.BMAnalyzer;
    const previousSetTimeout = globalThis.setTimeout;
    let yields = 0;
    const children = Array.from({ length: 251 }, (_, index) => ({
      id: String(index), title: '书签 ' + index, url: 'https://example.com/team/' + index, parentId: 'root'
    }));
    globalThis.window = globalThis;
    globalThis.setTimeout = callback => { yields++; callback(); return 0; };
    globalThis.chrome = { bookmarks: { getTree: vi.fn().mockResolvedValue([{ id: 'root', children }]) } };
    globalThis.BM = {
      loadDomainGroups: vi.fn(),
      loadTags: vi.fn(),
      loadFixedTags: vi.fn(),
      loadHiddenIds: vi.fn(),
      getDomainGroups: () => ({}),
      getBookmarkMetadata: vi.fn((url, title) => ({
        host: 'example.com', domain: 'example.com', key: url, route: 'team',
        category: '未分类', sensitive: [], searchText: (url + ' ' + title).toLowerCase()
      })),
      getTags: () => ({}),
      isHidden: () => false,
      FALLBACK_TAG: '其他'
    };

    try {
      new Function(analyzerCode)();
      const result = await globalThis.BMAnalyzer.analyze();

      expect(result.total).toBe(251);
      expect(result.items).toHaveLength(251);
      expect(yields).toBe(1);
    } finally {
      restoreGlobal('window', previousWindow);
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('BM', previousBM);
      restoreGlobal('BMAnalyzer', previousAnalyzer);
      restoreGlobal('setTimeout', previousSetTimeout);
    }
  });
});
