// ===== 书签管家 · lib.js 纯函数单元测试（vitest）=====
// lib.js 是 IIFE 挂载到 globalThis.BM 的经典脚本，通过读取文件 + eval 加载，
// 不依赖任何 chrome.* API，可直接在 Node 中测试。
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let BM;

beforeAll(() => {
  const code = readFileSync(join(__dirname, '..', 'js', 'lib.js'), 'utf-8');
  eval(code); // 挂载 globalThis.BM
  BM = globalThis.BM;
  expect(BM).toBeDefined();
});

describe('urlKey（精确重复判定键）', () => {
  it('忽略协议差异', () => {
    expect(BM.urlKey('https://a.com/x')).toBe(BM.urlKey('http://a.com/x'));
  });
  it('忽略 www. 前缀', () => {
    expect(BM.urlKey('https://www.a.com/x')).toBe(BM.urlKey('https://a.com/x'));
  });
  it('忽略末尾斜杠', () => {
    expect(BM.urlKey('https://a.com/x/')).toBe(BM.urlKey('https://a.com/x'));
  });
  it('忽略普通 fragment', () => {
    expect(BM.urlKey('https://a.com/x#top')).toBe(BM.urlKey('https://a.com/x'));
    expect(BM.urlKey('https://a.com/x#top')).toBe(BM.urlKey('https://a.com/x#section-2'));
  });
  it('保留 hash 路由以区分不同页面', () => {
    const first = 'https://lanhuapp.com/web/#/item/project/product?id=one';
    const second = 'https://lanhuapp.com/web/#/item/project/product?id=two';
    expect(BM.urlKey(first)).not.toBe(BM.urlKey(second));
    expect(BM.urlKey(first)).toBe(BM.urlKey('http://www.lanhuapp.com/web/#/item/project/product?id=one'));
  });
  it('保留 hashbang 路由', () => {
    expect(BM.urlKey('https://example.com/#!/project?id=one'))
      .not.toBe(BM.urlKey('https://example.com/#!/project?id=two'));
  });
  it('区分不同 path', () => {
    expect(BM.urlKey('https://a.com/x')).not.toBe(BM.urlKey('https://a.com/y'));
  });
  it('区分不同 query', () => {
    expect(BM.urlKey('https://a.com/x?a=1')).not.toBe(BM.urlKey('https://a.com/x?a=2'));
  });
});

describe('getRegisteredDomain（eTLD+1）', () => {
  it('普通域名取最后两级', () => {
    expect(BM.getRegisteredDomain('www.example.com')).toBe('example.com');
  });
  it('多级公共后缀（co.uk）取三级', () => {
    expect(BM.getRegisteredDomain('blog.news.bbc.co.uk')).toBe('bbc.co.uk');
  });
  it('中国域名（com.cn）', () => {
    expect(BM.getRegisteredDomain('www.example.com.cn')).toBe('example.com.cn');
  });
  it('IP / 无后缀回退', () => {
    expect(BM.getRegisteredDomain('localhost')).toBe('localhost');
  });
});

describe('categorize（本地分类规则）', () => {
  it('GitHub → 开发 / 编程', () => {
    expect(BM.categorize('github.com', 'https://github.com/user/repo', 'Repo')).toBe('开发 / 编程');
  });
  it('bilibili → 视频 / 影音', () => {
    expect(BM.categorize('www.bilibili.com', 'https://www.bilibili.com/video/BV1xx', '视频')).toBe('视频 / 影音');
  });
  it('DeepSeek → AI / 人工智能', () => {
    expect(BM.categorize('chat.deepseek.com', 'https://chat.deepseek.com/', 'DeepSeek')).toBe('AI / 人工智能');
  });
  it('mail.qq.com → 邮箱 / 通信（消解泛域冲突）', () => {
    expect(BM.categorize('mail.qq.com', 'https://mail.qq.com/', 'QQ邮箱')).toBe('邮箱 / 通信');
  });
  it('y.qq.com → 音乐 / 音频（同域多义用子域）', () => {
    expect(BM.categorize('y.qq.com', 'https://y.qq.com/', 'QQ音乐')).toBe('音乐 / 音频');
  });
  it('未命中 → 未分类', () => {
    expect(BM.categorize('qzxvbnmkljhgfds.me', 'https://qzxvbnmkljhgfds.me/p-42', '占位页面内容')).toBe('未分类');
  });
  it('26 个分类数量正确', () => {
    expect(BM.getCategoryNames().length).toBe(26);
  });
  it('预编译匹配器与逐关键词匹配在全部规则上等价', () => {
    const originalCategorize = (host, url, title) => {
      const hay = (host + ' ' + url + ' ' + title).toLowerCase();
      for (const rule of BM.CATEGORY_RULES) {
        if (rule.keys.some(key => hay.includes(key.toLowerCase()))) return rule.cat;
      }
      return '未分类';
    };

    for (const rule of BM.CATEGORY_RULES) {
      for (const key of rule.keys) {
        const title = '示例 ' + key;
        expect(BM.categorize('example.test', 'https://example.test/path', title))
          .toBe(originalCategorize('example.test', 'https://example.test/path', title));
      }
    }
  });
});

describe('normalizeHttpUrl（书签与外部链接边界）', () => {
  it('补全省略的 HTTPS 协议并保留标准 URL', () => {
    expect(BM.normalizeHttpUrl('example.com/docs?q=1').href).toBe('https://example.com/docs?q=1');
    expect(BM.normalizeHttpUrl('http://localhost:11434/v1').href).toBe('http://localhost:11434/v1');
  });

  it('拒绝可执行和非 Web 协议', () => {
    expect(() => BM.normalizeHttpUrl('javascript:alert(1)')).toThrow('仅支持 http 或 https 网址');
    expect(() => BM.normalizeHttpUrl('data:text/html,hello')).toThrow('仅支持 http 或 https 网址');
    expect(BM.isHttpUrl('chrome://extensions')).toBe(false);
  });
});

describe('LLM 端点边界', () => {
  it('为单一 HTTPS API 域名生成可选权限模式', () => {
    expect(BM.getLlmHostPermission('https://api.example.com/v1')).toBe('https://api.example.com/*');
    expect(BM.getLlmHostPermission('http://localhost:11434/v1')).toBe('http://localhost/*');
  });

  it('仅允许回环地址使用 HTTP', () => {
    expect(BM.normalizeLlmBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(() => BM.normalizeLlmBaseUrl('http://api.example.com/v1')).toThrow('必须使用 HTTPS');
  });

  it('申请权限时不会把端口写入 Chrome 匹配模式', async () => {
    const previousChrome = globalThis.chrome;
    const request = vi.fn().mockResolvedValue(true);
    globalThis.chrome = { permissions: { request } };

    try {
      await BM.requestLlmHostPermission('http://localhost:11434/v1');
      expect(request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

describe('sanitizeUrlForAI（LLM 数据最小化）', () => {
  it('移除所有 query 与 fragment，而不依赖敏感参数名单', () => {
    expect(BM.sanitizeUrlForAI('https://example.com/path?email=a%40b.com&token=secret#section'))
      .toBe('https://example.com/path');
  });
});

describe('parseAiCategories（LLM 返回容错解析）', () => {
  const items = [{ id: '1' }, { id: '2' }];
  it('标准 results 数组格式', () => {
    const map = BM.parseAiCategories('{"results":[{"id":"1","category":"游戏"},{"id":"2","category":"购物 / 电商"}]}', items);
    expect(map['1']).toBe('游戏');
    expect(map['2']).toBe('购物 / 电商');
  });
  it('代码围栏包裹', () => {
    const map = BM.parseAiCategories('```json\n{"1":"AI / 人工智能","2":"未分类"}\n```', items);
    expect(map['1']).toBe('AI / 人工智能');
  });
  it('分类名近似匹配（子串）', () => {
    const map = BM.parseAiCategories('{"results":[{"id":"1","category":"游戏攻略"}]}', items);
    expect(map['1']).toBe('游戏');
  });
  it('过滤不在白名单中的 id', () => {
    const map = BM.parseAiCategories('{"results":[{"id":"999","category":"游戏"}]}', items);
    expect(map['999']).toBeUndefined();
  });
  it('非法 JSON 抛错', () => {
    expect(() => BM.parseAiCategories('not json at all', items)).toThrow();
  });
});

describe('detectSensitive（敏感检测）', () => {
  it('银行域名 → high', () => {
    const hits = BM.detectSensitive('bank.example.com', 'https://bank.example.com/', '网上银行');
    expect(hits.some(h => h.sev === 'high')).toBe(true);
  });
  it('普通站点 → 空', () => {
    expect(BM.detectSensitive('example.com', 'https://example.com/', '首页')).toEqual([]);
  });
});

describe('aiTagBatched（分批打标）', () => {
  it('后续批次失败时，已成功批次会先交给持久化回调', async () => {
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: '{"results":[{"id":"one","tags":["工具"]}]}' } }] })
      })
      .mockRejectedValue(new Error('网络中断'));
    globalThis.fetch = fetch;
    const persisted = [];

    try {
      await expect(BM.aiTagBatched([
        { id: 'one', title: '第一个', url: 'https://example.com/one' },
        { id: 'two', title: '第二个', url: 'https://example.com/two' }
      ], {
        apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test'
      }, {
        batchSize: 1,
        retries: 0,
        onBatch: async map => { persisted.push(map); }
      })).rejects.toThrow('网络请求失败');

      expect(persisted).toEqual([{ one: ['工具'] }]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('LLM 输入边界', () => {
  it('导出的 AI 方法不会上传高敏感或非 HTTP(S) 书签', async () => {
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const cfg = { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' };
    const items = [
      { id: 'bank', title: '网上银行', url: 'https://bank.example.com/login?account=user' },
      { id: 'script', title: '脚本', url: 'javascript:alert(1)' }
    ];

    try {
      await expect(BM.aiTag(items, cfg)).resolves.toEqual({});
      await expect(BM.aiClassify(items, cfg)).resolves.toEqual({});
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('restoreTrashItems（批量恢复）', () => {
  it('委托后台恢复，并把完成进度回传给调用方', async () => {
    const previousChrome = globalThis.chrome;
    const trash = [
      { id: 'one', title: '原位置', url: 'https://example.com/one', parentId: 'folder' },
      { id: 'two', title: '回退位置', url: 'https://example.com/two', parentId: 'missing' }
    ];
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true, restored: 2, fallback: 1, failed: [], total: 2
    });
    globalThis.chrome = {
      runtime: { sendMessage },
      storage: { local: { get: vi.fn() } }
    };

    try {
      const onProgress = vi.fn();
      const result = await BM.restoreTrashItems(trash, { onProgress });

      expect(result).toMatchObject({ restored: 2, fallback: 1, failed: [] });
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'bmTrashMutation', action: 'restore', ids: ['one', 'two']
      });
      expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2, restored: 2 });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('后台服务不可用时明确失败，不降级为本地读改写', async () => {
    const previousChrome = globalThis.chrome;
    const trash = [{ id: 'one', title: '示例', url: 'https://example.com/one', parentId: 'folder' }];
    globalThis.chrome = {
      storage: { local: { get: vi.fn(), set: vi.fn() } }
    };

    try {
      await expect(BM.restoreTrashItems(trash)).rejects.toThrow('后台服务不可用');
      expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled();
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

describe('exportBookmarksJSON（敏感配置排除）', () => {
  it('不导出 LLM 配置或 API Key', async () => {
    const previousChrome = globalThis.chrome;
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue([{ children: [] }]) },
      storage: { local: { get: vi.fn().mockResolvedValue({}) } }
    };

    try {
      const backup = await BM.exportBookmarksJSON();
      const data = JSON.parse(backup.json);
      expect(data.settings).toBeUndefined();
      expect(backup.json).not.toContain('apiKey');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

describe('getBookmarkMetadata（单次书签元数据解析）', () => {
  it('与原有 URL、分类和敏感检测函数保持一致', () => {
    const url = 'https://www.github.com/index.html/?tab=code#readme';
    const title = 'GitHub 项目';
    const metadata = BM.getBookmarkMetadata(url, title);

    expect(metadata.host).toBe('www.github.com');
    expect(metadata.domain).toBe(BM.getRegisteredDomain(metadata.host));
    expect(metadata.key).toBe(BM.urlKey(url));
    expect(metadata.route).toBe(BM.routeKeyOf(url));
    expect(metadata.category).toBe(BM.categorize(metadata.host, url, title));
    expect(metadata.sensitive).toEqual(BM.detectSensitive(metadata.host, url, title));
    expect(metadata.searchText).toBe((metadata.host + ' ' + url + ' ' + title).toLowerCase());
  });

  it('无效 URL 沿用旧函数的回退结果', () => {
    const url = 'not a valid url';
    const metadata = BM.getBookmarkMetadata(url, '示例');

    expect(metadata.key).toBe(BM.urlKey(url));
    expect(metadata.route).toBe(BM.routeKeyOf(url));
    expect(metadata.category).toBe(BM.categorize('', url, '示例'));
  });

  it('hash 路由键与 urlKey 保持一致', () => {
    const first = BM.getBookmarkMetadata(
      'https://lanhuapp.com/web/#/item/project/product?id=one',
      '页面一'
    );
    const second = BM.getBookmarkMetadata(
      'https://lanhuapp.com/web/#/item/project/product?id=two',
      '页面二'
    );

    expect(first.key).toBe(BM.urlKey('https://lanhuapp.com/web/#/item/project/product?id=one'));
    expect(first.key).not.toBe(second.key);
    expect(first.route).toBe(BM.routeKeyOf('https://lanhuapp.com/web/#/item/project/product?id=one'));
    expect(first.route).not.toBe(second.route);
  });
});

describe('PROVIDERS（服务商预设，DRY 共享）', () => {
  it('包含全部 7 个服务商', () => {
    expect(Object.keys(BM.PROVIDERS).sort()).toEqual(
      ['custom', 'deepseek', 'gemini', 'grok', 'groq', 'ollama', 'openai']
    );
  });
  it('DeepSeek 预设完整', () => {
    expect(BM.PROVIDERS.deepseek).toMatchObject({ model: 'deepseek-chat' });
    expect(BM.PROVIDERS.deepseek.base).toContain('api.deepseek.com');
  });
});
