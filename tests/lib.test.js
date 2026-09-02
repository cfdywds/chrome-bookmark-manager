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
  it('保留非默认端口', () => {
    expect(BM.urlKey('https://a.com:8443/x')).not.toBe(BM.urlKey('https://a.com/x'));
    expect(BM.urlKey('https://a.com:8443/x')).toBe(BM.urlKey('http://www.a.com:8443/x'));
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

describe('标签云同步 V2（URL 主键）', () => {
  it('用规范化 URL 而非来源设备书签 ID 投影和解析标签', () => {
    const projected = BM.projectTagsForSync(
      { source: ['AI'], duplicate: ['GitHub'] },
      [
        { id: 'source', url: 'https://www.github.com/openai/' },
        { id: 'duplicate', url: 'https://github.com/openai' }
      ]
    );

    expect(projected).toEqual({ 'github.com/openai': ['AI', 'GitHub'] });
    expect(BM.resolveSyncTags(projected, [
      { id: 'target', url: 'https://github.com/openai' }
    ])).toEqual({ target: ['AI', 'GitHub'] });
  });

  it('将 V2 格式写入分片，并忽略旧的 ID 索引格式', () => {
    const chunks = BM.serializeSyncTags({ 'github.com/openai': ['AI'] });
    expect(JSON.parse(chunks.bmSyncTag_p0)).toEqual({
      version: 2,
      tags: { 'github.com/openai': ['AI'] }
    });
    expect(BM.deserializeSyncTags(JSON.stringify({
      pool: ['AI'], map: { source: '0' }
    }))).toBeNull();
  });

  it('目标设备从同步的开关和 payload 首次拉取到本机书签 ID', async () => {
    const previousChrome = globalThis.chrome;
    const chunks = BM.serializeSyncTags({ 'github.com/openai': ['AI'] });
    const localData = { bmTags: {} };
    const localSet = vi.fn(async value => { Object.assign(localData, value); });
    const syncGet = vi.fn(async keys => {
      if (keys === BM.SYNC_ENABLED_KEY) return { [BM.SYNC_ENABLED_KEY]: true };
      if (keys === BM.SYNC_TAG_CNT) return { [BM.SYNC_TAG_CNT]: chunks.bmSyncTag_cnt };
      const out = {};
      (keys || []).forEach(key => { out[key] = chunks[key]; });
      return out;
    });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [
          { id: 'target-device-id', url: 'https://www.github.com/openai/' }
        ] }])
      },
      storage: {
        local: {
          get: vi.fn(async key => ({ [key]: localData[key] })),
          set: localSet
        },
        sync: { get: syncGet }
      }
    };

    try {
      await expect(BM.pullTagsFromCloud()).resolves.toBe(true);
      expect(localData.bmTags).toEqual({ 'target-device-id': ['AI'] });
      expect(localSet).toHaveBeenCalledWith({ bmTags: { 'target-device-id': ['AI'] } });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('云端写入失败时持久化可见的同步错误', async () => {
    const previousChrome = globalThis.chrome;
    const localData = { bmTags: { source: ['AI'] } };
    const localSet = vi.fn(async value => { Object.assign(localData, value); });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [
          { id: 'source', url: 'https://github.com/openai' }
        ] }])
      },
      storage: {
        local: {
          get: vi.fn(async key => ({ [key]: localData[key] })),
          set: localSet
        },
        sync: {
          get: vi.fn(async () => ({ [BM.SYNC_ENABLED_KEY]: true })),
          set: vi.fn().mockRejectedValue(new Error('同步配额不足'))
        }
      }
    };

    try {
      await expect(BM.pushTagsToCloud()).rejects.toThrow('同步配额不足');
      expect(localData[BM.SYNC_STATUS_KEY]).toMatchObject({ lastError: '同步配额不足' });
      expect(localSet).toHaveBeenCalledWith({
        [BM.SYNC_STATUS_KEY]: expect.objectContaining({ lastError: '同步配额不足' })
      });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

describe('标签配置云同步（版本化快照）', () => {
  it('保留显式空标签池和空规则，并按修订号比较快照', () => {
    const config = {
      version: 1,
      revision: { updatedAt: 100, deviceId: 'device-a' },
      fixedTags: [],
      tagRules: { domain: {}, keyword: {} }
    };

    const chunks = BM.serializeSyncConfig(config);

    expect(JSON.parse(chunks.bmSyncConfig_p0)).toEqual(config);
    expect(BM.deserializeSyncConfig(chunks.bmSyncConfig_p0)).toEqual(config);
    expect(BM.deserializeSyncConfig(JSON.stringify({ ...config, tagRules: [] }))).toBeNull();
    expect(BM.compareConfigRevision(config.revision, {
      updatedAt: 100, deviceId: 'device-b'
    })).toBeLessThan(0);
  });
  it('显式空标签池只保留兜底标签，不回退默认池', async () => {
    const previousChrome = globalThis.chrome;
    globalThis.chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({ bmFixedTags: [] }) } }
    };

    try {
      BM.invalidateFixedTags();
      await expect(BM.loadFixedTags()).resolves.toEqual(['其他']);
    } finally {
      BM.invalidateFixedTags();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('采用云端较新的标签池和规则而不读取 LLM 配置', async () => {
    const previousChrome = globalThis.chrome;
    const config = {
      version: 1,
      revision: { updatedAt: 100, deviceId: 'device-a' },
      fixedTags: ['工作'],
      tagRules: { domain: { github: ['工作'] }, keyword: {} }
    };
    const chunks = BM.serializeSyncConfig(config);
    const localData = {
      bmFixedTags: ['代码'],
      bmTagRules: { domain: {}, keyword: {} },
      bmSyncConfigRevision: { updatedAt: 10, deviceId: 'device-old' },
      bmSettings: { apiKey: 'secret-api-key' }
    };
    const syncData = { [BM.SYNC_ENABLED_KEY]: true, ...chunks };
    const localGet = vi.fn(async keys => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.map(key => [key, localData[key]]));
    });
    globalThis.chrome = {
      storage: {
        local: {
          get: localGet,
          set: vi.fn(async values => { Object.assign(localData, values); })
        },
        sync: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, syncData[key]]));
          })
        }
      }
    };

    try {
      await expect(BM.pullConfigFromCloud()).resolves.toBe(true);
      expect(localData.bmFixedTags).toEqual(['工作']);
      expect(localData.bmTagRules).toEqual({ domain: { github: ['工作'] }, keyword: {} });
      expect(localGet.mock.calls.flat()).not.toContain('bmSettings');
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('远端配置变更仅在更高修订已写入本地后通知界面', async () => {
    const previousChrome = globalThis.chrome;
    const cloud = {
      version: 1,
      revision: { updatedAt: 200, deviceId: 'device-remote' },
      fixedTags: ['远端'],
      tagRules: { domain: { github: ['远端'] }, keyword: {} }
    };
    const syncData = { [BM.SYNC_ENABLED_KEY]: true, ...BM.serializeSyncConfig(cloud) };
    const localData = {
      bmFixedTags: ['本地'],
      bmTagRules: { domain: {}, keyword: {} },
      bmSyncConfigRevision: { updatedAt: 100, deviceId: 'device-local' }
    };
    let listener;
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, localData[key]]));
          }),
          set: vi.fn(async values => { Object.assign(localData, values); })
        },
        sync: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, syncData[key]]));
          }),
          onChanged: { addListener: callback => { listener = callback; } }
        }
      }
    };
    const onChange = vi.fn();

    try {
      BM.watchTagConfiguration(onChange);
      listener({ [BM.SYNC_CONFIG_CNT]: { oldValue: 0, newValue: 1 } }, 'sync');

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      expect(localData.bmFixedTags).toEqual(['远端']);
      expect(localData.bmTagRules).toEqual({ domain: { github: ['远端'] }, keyword: {} });
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('首次启用时采用有效云端配置而不读取 LLM 配置', async () => {
    const previousChrome = globalThis.chrome;
    const cloud = {
      version: 1,
      revision: { updatedAt: 100, deviceId: 'device-a' },
      fixedTags: ['云端'],
      tagRules: { domain: { github: ['云端'] }, keyword: {} }
    };
    const chunks = BM.serializeSyncConfig(cloud);
    const localData = {
      bmFixedTags: ['离线'],
      bmTagRules: { domain: {}, keyword: {} },
      bmSyncConfigRevision: { updatedAt: 200, deviceId: 'device-local' },
      bmSettings: { apiKey: 'secret-api-key' }
    };
    const syncData = { [BM.SYNC_ENABLED_KEY]: true, ...chunks };
    const localGet = vi.fn(async keys => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.map(key => [key, localData[key]]));
    });
    globalThis.chrome = {
      storage: {
        local: {
          get: localGet,
          set: vi.fn(async values => { Object.assign(localData, values); })
        },
        sync: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, syncData[key]]));
          }),
          set: vi.fn(async values => { Object.assign(syncData, values); })
        }
      }
    };

    try {
      await expect(BM.initializeSyncedTagConfiguration()).resolves.toBe(true);
      expect(localData.bmFixedTags).toEqual(['云端']);
      expect(localData.bmTagRules).toEqual({ domain: { github: ['云端'] }, keyword: {} });
      expect(localGet.mock.calls.flat()).not.toContain('bmSettings');
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('读取云端配置失败时保留本地配置并记录同步错误', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmSyncEnabled: true,
      bmFixedTags: ['本地'],
      bmTagRules: { domain: { local: ['本地'] }, keyword: {} },
      bmSyncConfigRevision: { updatedAt: 100, deviceId: 'device-local' }
    };
    const syncSet = vi.fn();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, localData[key]]));
          }),
          set: vi.fn(async values => { Object.assign(localData, values); })
        },
        sync: {
          get: vi.fn(async key => {
            if (key === BM.SYNC_ENABLED_KEY) return { [BM.SYNC_ENABLED_KEY]: true };
            throw new Error('Sync 暂不可用');
          }),
          set: syncSet
        }
      }
    };

    try {
      await expect(BM.initializeSyncedTagConfiguration()).rejects.toThrow('Sync 暂不可用');
      expect(localData.bmFixedTags).toEqual(['本地']);
      expect(localData.bmTagRules).toEqual({ domain: { local: ['本地'] }, keyword: {} });
      expect(syncSet).not.toHaveBeenCalled();
      expect(localData[BM.SYNC_STATUS_KEY].lastError).toContain('Sync 暂不可用');
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('损坏的云端配置不覆盖本地配置并记录同步错误', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmSyncEnabled: true,
      bmFixedTags: ['本地'],
      bmTagRules: { domain: { local: ['本地'] }, keyword: {} },
      bmSyncConfigRevision: { updatedAt: 100, deviceId: 'device-local' }
    };
    const syncSet = vi.fn();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(wanted.map(key => [key, localData[key]]));
          }),
          set: vi.fn(async values => { Object.assign(localData, values); })
        },
        sync: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            if (wanted.includes(BM.SYNC_CONFIG_CNT)) {
              return { [BM.SYNC_CONFIG_CNT]: 1, [BM.SYNC_CONFIG_PREFIX + '0']: '{bad json' };
            }
            return { [BM.SYNC_ENABLED_KEY]: true };
          }),
          set: syncSet
        }
      }
    };

    try {
      await expect(BM.initializeSyncedTagConfiguration()).rejects.toThrow('标签同步配置格式无效');
      expect(localData.bmFixedTags).toEqual(['本地']);
      expect(localData.bmTagRules).toEqual({ domain: { local: ['本地'] }, keyword: {} });
      expect(syncSet).not.toHaveBeenCalled();
      expect(localData[BM.SYNC_STATUS_KEY].lastError).toContain('标签同步配置');
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });


  it('开启同步后仅上传固定标签和规则配置', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmFixedTags: ['本地'],
      bmTagRules: { domain: {}, keyword: {} },
      bmSettings: { apiKey: 'secret-api-key', model: 'private-model' }
    };
    const syncData = { [BM.SYNC_ENABLED_KEY]: true };
    const localSet = vi.fn(async values => { Object.assign(localData, values); });
    const syncSet = vi.fn(async values => { Object.assign(syncData, values); });
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            const out = {};
            wanted.forEach(key => { out[key] = localData[key]; });
            return out;
          }),
          set: localSet
        },
        sync: {
          get: vi.fn(async keys => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            const out = {};
            wanted.forEach(key => { out[key] = syncData[key]; });
            return out;
          }),
          set: syncSet
        }
      }
    };

    try {
      await expect(BM.saveSyncedTagConfiguration(['代码'], {
        domain: { github: ['代码'] }, keyword: {}
      })).resolves.toBe(true);
      const payload = JSON.parse(syncData.bmSyncConfig_p0);
      expect(localData.bmFixedTags).toEqual(['代码']);
      expect(localData.bmTagRules).toEqual({ domain: { github: ['代码'] }, keyword: {} });
      expect(payload).toMatchObject({
        fixedTags: ['代码'], tagRules: { domain: { github: ['代码'] }, keyword: {} }
      });
      expect(JSON.stringify(syncSet.mock.calls)).not.toContain('secret-api-key');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

describe('unionTagLists（同址标签取并集）', () => {
  it('去重并保持已有标签优先顺序', () => {
    expect(BM.unionTagLists([['前端', '后端'], ['前端', '数据库']]))
      .toEqual(['前端', '后端', '数据库']);
  });
  it('去除「其他」兜底标签', () => {
    expect(BM.unionTagLists([['其他', '前端'], ['其他']])).toEqual(['前端']);
  });
  it('单书签最多保留 6 个标签', () => {
    const big = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(BM.unionTagLists([big])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('空输入返回空数组', () => {
    expect(BM.unionTagLists([])).toEqual([]);
    expect(BM.unionTagLists()).toEqual([]);
  });
  it('规范化空白与折叠', () => {
    expect(BM.unionTagLists([['  前端  ', ' 前端'], [' 设计 ']])).toEqual(['前端', '设计']);
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

describe('inferDomainTags（高置信域名打标）', () => {
  it.each([
    ['https://figma.com/design/project', ['设计', '工作']],
    ['https://community.discourse.org/t/topic/123', ['论坛']],
    ['https://github.com/openai/codex', ['代码']],
    ['https://login.tailscale.com/admin', ['运维', '工具']]
  ])('%s → %j', (url, expected) => {
    expect(BM.inferDomainTags({ url })).toEqual(expected);
  });

  it('尊重用户自定义标签池，不写入池外规则标签', () => {
    expect(BM.inferDomainTags(
      { url: 'https://github.com/example/project' },
      ['GitHub', '其他']
    )).toEqual([]);
  });
});

describe('matchCustomTagRules（用户自定义规则）', () => {
  const rules = {
    domain: { corp: ['工作', '代码'], invalid: ['池外标签'] },
    keyword: { 教程: ['学习', '教程'], release: ['资讯'] }
  };
  const pool = ['工作', '代码', '学习', '教程', '资讯', '其他'];

  it('域名关键字大小写不敏感，并可映射多个池内标签', () => {
    expect(BM.matchCustomTagRules(
      { url: 'https://Docs.CORP.example/guide', title: '内部文档' }, rules, pool
    )).toEqual({ domain: ['工作', '代码'], keyword: [] });
  });

  it('标题和 URL 路径关键字命中，但 query 与 fragment 不参与', () => {
    expect(BM.matchCustomTagRules(
      { url: 'https://example.com/教程/start?release=1#release', title: '入门' }, rules, pool
    )).toEqual({ domain: [], keyword: ['学习', '教程'] });
    expect(BM.matchCustomTagRules(
      { url: 'https://example.com/article?release=1#教程', title: '普通文章' }, rules, pool
    )).toEqual({ domain: [], keyword: [] });
  });

  it('忽略固定标签池之外的规则标签', () => {
    expect(BM.matchCustomTagRules(
      { url: 'https://invalid.example/path', title: '内容' }, rules, pool
    )).toEqual({ domain: [], keyword: [] });
  });
});

describe('标签配置迁移', () => {
  it('升级旧默认池，并建立空的统一规则配置', async () => {
    const previousChrome = globalThis.chrome;
    const localData = { bmStorageVersion: 1, bmFixedTags: [...BM.LEGACY_DEFAULT_FIXED_TAGS] };
    const set = vi.fn(async values => { Object.assign(localData, values); });
    globalThis.chrome = { storage: { local: {
      get: vi.fn().mockResolvedValue(localData),
      set
    } } };

    try {
      await BM.migrateStorage();
      expect(set).toHaveBeenCalledWith({
        bmStorageVersion: 3,
        bmFixedTags: BM.DEFAULT_FIXED_TAGS,
        bmTagRules: { domain: {}, keyword: {} },
        bmDomainGroupsMigrated: true
      });
      expect(localData.bmFixedTags).toEqual(expect.arrayContaining(['代码', '论坛']));
      expect(localData.bmFixedTags).not.toEqual(expect.arrayContaining(['GitHub', 'linux.do', 'Tailscale']));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('保留真正的自定义标签池', () => {
    const custom = ['工作', '个人'];
    expect(BM.upgradeDefaultFixedTags(custom)).toBe(custom);
  });

  it('将旧域名分组迁入统一域名规则的首个标签', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmStorageVersion: 2,
      bmFixedTags: ['工作', '代码'],
      bmDomainGroups: { 'corp.example': '工作' }
    };
    const set = vi.fn(async values => { Object.assign(localData, values); });
    globalThis.chrome = { storage: { local: {
      get: vi.fn().mockResolvedValue(localData),
      set
    } } };

    try {
      await BM.migrateStorage();
      expect(localData.bmTagRules).toEqual({ domain: { 'corp.example': ['工作'] }, keyword: {} });
      expect(localData.bmDomainGroupsMigrated).toBe(true);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ bmStorageVersion: 3 }));
    } finally {
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('使用域名规则首个标签作为概览分类名', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmTagRules: { domain: { CORP: ['工作', '代码'] }, keyword: {} },
      bmDomainGroupsMigrated: true
    };
    globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue(localData) } } };

    try {
      BM.invalidateTagRules();
      await BM.loadTagRules();
      await BM.loadDomainGroups();
      expect(BM.matchDomainGroup('docs.corp.example')).toBe('工作');
      expect(BM.categorize('docs.corp.example', 'https://docs.corp.example/', '文档')).toBe('工作');
    } finally {
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('重叠域名规则按声明顺序保持概览分类与标签首项一致', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmFixedTags: ['工作', '代码'],
      bmTagRules: { domain: { corp: ['工作'], 'docs.corp.example': ['代码'] }, keyword: {} },
      bmDomainGroupsMigrated: true
    };
    globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue(localData) } } };

    try {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      await BM.loadDomainGroups();
      expect(BM.matchDomainGroup('docs.corp.example')).toBe('工作');
      expect(BM.inferHighConfidenceTags({ url: 'https://docs.corp.example/' })).toEqual(['工作', '代码']);
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('不让池外域名规则标签成为概览分类', async () => {
    const previousChrome = globalThis.chrome;
    const localData = {
      bmFixedTags: ['工作'],
      bmTagRules: { domain: { corp: ['失效标签'] }, keyword: {} },
      bmDomainGroupsMigrated: true
    };
    globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue(localData) } } };

    try {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      await BM.loadDomainGroups();
      expect(BM.matchDomainGroup('docs.corp.example')).toBe('');
      expect(BM.getAllCategoryNames()).not.toContain('失效标签');
      expect(BM.inferHighConfidenceTags({ url: 'https://docs.corp.example/' })).toEqual([]);
    } finally {
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
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

describe('detectSensitive（AI 隐私保护）', () => {
  it('识别明确的登录子域名、登录路径和金融服务', () => {
    expect(BM.detectSensitive('login.example.com', 'https://login.example.com/', '登录')).toEqual([
      { label: '登录入口', sev: 'high' }
    ]);
    expect(BM.detectSensitive('example.com', 'https://example.com/account/login.html', '登录')).toEqual([
      { label: '登录入口', sev: 'high' }
    ]);
    expect(BM.detectSensitive('bank.example.com', 'https://bank.example.com/', '网上银行'))
      .toContainEqual({ label: '金融 / 钱包服务', sev: 'high' });
  });

  it('只将实际 URL 参数视为访问凭据，不误判普通路径和后台页面', () => {
    expect(BM.detectSensitive('example.com', 'https://example.com/callback?access_token=secret', '回调'))
      .toContainEqual({ label: '含访问凭据参数', sev: 'high' });
    expect(BM.detectSensitive('example.com', 'https://example.com/#access_token=secret', '回调'))
      .toContainEqual({ label: '含访问凭据参数', sev: 'high' });
    expect(BM.detectSensitive('example.com', 'https://example.com/callback?%74oken=secret', '回调'))
      .toContainEqual({ label: '含访问凭据参数', sev: 'high' });
    expect(BM.detectSensitive('example.com', 'https://example.com/token/guide', 'Token 指南')).toEqual([]);
    expect(BM.detectSensitive('example.com', 'https://example.com/dashboard', '项目后台')).toEqual([]);
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

  it('AI 返回不会覆盖域名高置信标签', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: '{"results":[{"id":"repo","tags":["AI"]}]}' } }] })
    });

    try {
      const result = await BM.aiTag([
        { id: 'repo', title: 'Codex', url: 'https://github.com/openai/codex' }
      ], { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' });

      expect(result).toEqual({ repo: ['代码', 'AI'] });
      const request = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(request.messages[1].content).toContain('本地高置信标签=代码');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('LLM 失败时仍返回全部高置信域名规则标签', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('网络中断'));

    try {
      await expect(BM.aiTag([
        { id: 'repo', title: '仓库', url: 'https://github.com/example/repo' },
        { id: 'forum', title: '话题', url: 'https://community.discourse.org/t/topic/1' }
      ], { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' })).resolves.toEqual({
        repo: ['代码'],
        forum: ['论坛']
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('混合批次失败时先持久化规则命中项，再保留错误可见性', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('网络中断'));
    const persisted = [];

    try {
      await expect(BM.aiTagBatched([
        { id: 'repo', title: '仓库', url: 'https://github.com/example/repo' },
        { id: 'unknown', title: '未知', url: 'https://example.org/item' }
      ], { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }, {
        retries: 0,
        onBatch: async map => { persisted.push(map); }
      })).rejects.toThrow('网络请求失败');

      expect(persisted).toEqual([{ repo: ['代码'] }]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('LLM 输入边界', () => {
  it('导出的 AI 方法不会上传受 AI 隐私保护或非 HTTP(S) 的书签', async () => {
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const cfg = { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' };
    const items = [
      { id: 'bank', title: '网上银行', url: 'https://bank.example.com/login?account=user' },
      { id: 'credential', title: '回调', url: 'https://example.com/callback?access_token=secret' },
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

  it('普通 token 路径不触发保护，仍可发送给 AI', async () => {
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: '{"results":[{"id":"guide","category":"未分类"}]}' } }] })
    });
    globalThis.fetch = fetch;

    try {
      const result = await BM.aiClassify([
        { id: 'guide', title: 'Token 指南', url: 'https://example.com/token/guide' }
      ], { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' });

      expect(result).toEqual({ guide: '未分类' });
      expect(fetch).toHaveBeenCalledOnce();
      const request = JSON.parse(fetch.mock.calls[0][1].body);
      expect(request.messages[1].content).toContain('https://example.com/token/guide');
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
      expect(data.tagRules).toEqual({ domain: {}, keyword: {} });
      expect(backup.json).not.toContain('apiKey');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('导出 V4 紧凑结构，内联标签和隐藏状态并保留全部根目录与回收站', async () => {
    const previousChrome = globalThis.chrome;
    const tree = [{
      id: '0',
      children: [
        {
          id: 'bar', title: '书签栏', dateGroupModified: 1700000000000,
          children: [{
            id: 'folder', parentId: 'bar', index: 0, title: '项目', dateAdded: 1700000000000,
            children: [{
              id: 'bookmark', parentId: 'folder', index: 0, title: '项目主页',
              url: 'https://project.example/', dateAdded: 1700000000000
            }]
          }]
        },
        {
          id: 'other', title: '其他书签', dateGroupModified: 1700000000000,
          children: [{
            id: 'other-bookmark', parentId: 'other', index: 0, title: '归档',
            url: 'https://archive.example/', dateAdded: 1700000000000
          }]
        }
      ]
    }];
    const stored = {
      bmTags: { bookmark: ['项目'], 'other-bookmark': ['归档'] },
      bmHiddenIds: ['bookmark'],
      bmFixedTags: ['项目', '归档', '其他'],
      bmTagRules: { domain: { project: ['项目'] }, keyword: {} },
      bmTrash: [{
        id: 'deleted', title: '已删除', url: 'https://deleted.example/', parentId: 'folder',
        path: ['项目'], deletedAt: 1600000000000
      }]
    };
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue(tree) },
      storage: {
        local: {
          get: vi.fn(async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
            .filter(key => Object.prototype.hasOwnProperty.call(stored, key))
            .map(key => [key, stored[key]])))
        }
      }
    };
    BM.invalidateTags();
    BM.invalidateHiddenIds();
    BM.invalidateFixedTags();
    BM.invalidateTagRules();

    try {
      const backup = await BM.exportBookmarksJSON();
      const data = JSON.parse(backup.json);
      const legacyJson = JSON.stringify({
        app: 'bookmark-manager', version: 3, exportedAt: data.exportedAt,
        bookmarks: tree, trash: stored.bmTrash, tags: stored.bmTags,
        hiddenIds: stored.bmHiddenIds, fixedTags: stored.bmFixedTags, tagRules: stored.bmTagRules
      }, null, 2);

      expect(data).toMatchObject({
        app: 'bookmark-manager', version: 4,
        roots: [
          ['bar', '书签栏', [['项目', [['项目主页', 'https://project.example/', ['项目'], 1]], 'folder']]],
          ['other', '其他书签', [['归档', 'https://archive.example/', ['归档']]]]
        ],
        trash: [[
          `backup:${data.exportedAt}:deleted`, '已删除', 'https://deleted.example/', 'folder', 1600000000000, ['项目']
        ]]
      });
      expect(data.tags).toBeUndefined();
      expect(data.hiddenIds).toBeUndefined();
      expect(data.bookmarks).toBeUndefined();
      expect(backup.count).toBe(2);
      expect(backup.json).not.toContain('\n');
      expect(backup.json.length).toBeLessThan(legacyJson.length * 0.65);
    } finally {
      BM.invalidateTags();
      BM.invalidateHiddenIds();
      BM.invalidateFixedTags();
      BM.invalidateTagRules();
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
