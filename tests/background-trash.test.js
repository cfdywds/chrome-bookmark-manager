import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backgroundCode = readFileSync(join(__dirname, '..', 'js', 'background.js'), 'utf-8');
const legacyDefaultFixedTags = [
  'AI', '前端', '后端', '移动端', 'JAVA', 'Python', '数据库', '运维', '安全', '设计',
  '学习', '教程', '工具', '效率', '工作', '资讯', '阅读', '视频', '娱乐', '生活', '社交', '博客',
  'linux.do', 'GitHub', '掘金', '知乎', 'V2EX', '中转站', 'Telegram', '微信公众号'
];

function restoreGlobal(name, previous) {
  if (previous === undefined) delete globalThis[name];
  else globalThis[name] = previous;
}

function createBackgroundHarness(initialTrash, options) {
  options = options || {};
  const messageListeners = [];
  const bookmarkCreatedListeners = [];
  const bookmarkImportBeganListeners = [];
  const bookmarkImportEndedListeners = [];
  const storageChangeListeners = [];
  let trash = initialTrash.slice();
  const localData = { ...(options.localData || {}), bmTrash: trash };
  const syncData = { ...(options.syncData || {}) };
  const setTrash = value => {
    trash = value;
    localData.bmTrash = value;
  };
  const storageSet = vi.fn().mockImplementation(value => {
    const changes = {};
    Object.keys(value).forEach(key => {
      changes[key] = { oldValue: localData[key], newValue: value[key] };
    });
    if (Object.prototype.hasOwnProperty.call(value, 'bmTrash')) setTrash(value.bmTrash);
    Object.assign(localData, value);
    storageChangeListeners.forEach(listener => listener(changes, 'local'));
    return Promise.resolve();
  });
  const storageGet = options.localGet || vi.fn().mockImplementation(() => Promise.resolve({ ...localData }));
  const syncSet = vi.fn().mockImplementation(value => {
    Object.assign(syncData, value);
    return Promise.resolve();
  });
  const syncGet = options.syncGet || vi.fn().mockImplementation(keys => {
    if (typeof keys === 'string') return Promise.resolve({ [keys]: syncData[keys] });
    if (Array.isArray(keys)) return Promise.resolve(Object.fromEntries(keys.map(key => [key, syncData[key]])));
    return Promise.resolve({ ...syncData });
  });
  const chrome = {
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      open: vi.fn()
    },
    runtime: {
      onMessage: { addListener: listener => messageListeners.push(listener) },
      onStartup: { addListener: vi.fn() }
    },
    bookmarks: {
      onCreated: { addListener: listener => bookmarkCreatedListeners.push(listener) },
      onChanged: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      onMoved: { addListener: vi.fn() },
      onImportBegan: { addListener: listener => bookmarkImportBeganListeners.push(listener) },
      onImportEnded: { addListener: listener => bookmarkImportEndedListeners.push(listener) },
      create: options.create || vi.fn().mockResolvedValue({ id: 'restored' }),
      get: options.get || vi.fn().mockRejectedValue(new Error('Bookmark not found')),
      search: options.search || vi.fn().mockResolvedValue([]),
      getTree: options.getTree || vi.fn().mockResolvedValue([{ children: [{ id: 'bar' }] }])
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    storage: {
      onChanged: { addListener: listener => storageChangeListeners.push(listener) },
      local: {
        get: storageGet,
        set: storageSet
      },
      sync: {
        get: syncGet,
        set: syncSet
      },
      session: {
        get: options.sessionGet || vi.fn().mockResolvedValue(options.sessionData || {}),
        remove: vi.fn(),
        set: vi.fn()
      }
    }
  };
  const send = message => new Promise((resolve, reject) => {
    let waiting = false;
    for (const listener of messageListeners) {
      const result = listener(message, {}, response => resolve(response));
      if (result === true) waiting = true;
    }
    if (!waiting) reject(new Error('没有消息处理器'));
  });
  return {
    chrome,
    send,
    getTrash: () => trash,
    setTrash,
    storageSet,
    syncSet,
    triggerBookmarkCreated: (id, bookmark) => Promise.all(bookmarkCreatedListeners.map(listener => listener(id, bookmark))),
    triggerBookmarkImportBegan: () => bookmarkImportBeganListeners.forEach(listener => listener()),
    triggerBookmarkImportEnded: () => bookmarkImportEndedListeners.forEach(listener => listener())
  };
}

describe('后台回收站写入队列', () => {
  it('恢复与新增入站并发时保留新增记录', async () => {
    const previousChrome = globalThis.chrome;
    let resolveCreate;
    const create = vi.fn(() => new Promise(resolve => { resolveCreate = resolve; }));
    const harness = createBackgroundHarness([
      { id: 'old', title: '旧书签', url: 'https://example.com/old', parentId: 'folder', deletedAt: 1 }
    ], { create });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const restore = harness.send({
        type: 'bmTrashMutation', action: 'restore', ids: ['old']
      });
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
      const add = harness.send({
        type: 'bmTrashMutation', action: 'add', items: [{
          id: 'new', title: '新书签', url: 'https://example.com/new'
        }]
      });
      resolveCreate({ id: 'restored-old' });

      await expect(restore).resolves.toMatchObject({ ok: true, restored: 1 });
      await expect(add).resolves.toMatchObject({ ok: true, added: 1 });
      expect(harness.getTrash().map(item => item.id)).toEqual(['new']);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('创建后写入失败时保留恢复标记，重试不会重复创建', async () => {
    const previousChrome = globalThis.chrome;
    const createdBookmarks = [];
    const create = vi.fn(info => {
      const created = { id: 'restored-one', ...info, dateAdded: Date.now() + 1 };
      createdBookmarks.push(created);
      return Promise.resolve(created);
    });
    const search = vi.fn().mockImplementation(() => Promise.resolve(createdBookmarks));
    const harness = createBackgroundHarness([
      { id: 'one', title: '示例', url: 'https://example.com/one', parentId: 'folder', deletedAt: 1 }
    ], { create, search });
    let failRemoval = true;
    harness.storageSet.mockImplementation(value => {
      if (Array.isArray(value.bmTrash) && value.bmTrash.length === 0 && failRemoval) {
        failRemoval = false;
        return Promise.reject(new Error('存储空间不足'));
      }
      if (Object.prototype.hasOwnProperty.call(value, 'bmTrash')) harness.setTrash(value.bmTrash);
      return Promise.resolve();
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const first = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(first).toMatchObject({ ok: true, restored: 0, persistenceError: '存储空间不足' });
      expect(create).toHaveBeenCalledOnce();
      expect(harness.getTrash()).toEqual([expect.objectContaining({ id: 'one', restoreStartedAt: expect.any(Number) })]);

      const second = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(second).toMatchObject({ ok: true, restored: 1 });
      expect(create).toHaveBeenCalledOnce();
      expect(harness.getTrash()).toEqual([]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('恢复标记的书签查询失败时保留记录且不重复创建', async () => {
    const previousChrome = globalThis.chrome;
    const create = vi.fn().mockResolvedValue({ id: 'unexpected' });
    const search = vi.fn().mockRejectedValue(new Error('书签查询暂不可用'));
    const harness = createBackgroundHarness([{
      id: 'one',
      title: '示例',
      url: 'https://example.com/one',
      parentId: 'folder',
      deletedAt: 1,
      restoreStartedAt: Date.now() - 1000
    }], { create, search });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const result = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(result).toMatchObject({
        ok: true,
        restored: 0,
        total: 1,
        failed: [{ id: 'one', error: '书签查询暂不可用' }]
      });
      expect(create).not.toHaveBeenCalled();
      expect(harness.getTrash()).toEqual([expect.objectContaining({
        id: 'one',
        restoreStartedAt: expect.any(Number)
      })]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('原书签仍存在时只清理残留回收站记录，不创建重复项', async () => {
    const previousChrome = globalThis.chrome;
    const trash = {
      id: 'one',
      title: '示例',
      url: 'https://example.com/one',
      parentId: 'folder'
    };
    const original = {
      ...trash,
      title: '用户修改后的标题',
      url: 'https://example.com/updated'
    };
    const create = vi.fn().mockResolvedValue({ id: 'unexpected' });
    const get = vi.fn().mockResolvedValue([original]);
    const harness = createBackgroundHarness([{
      ...trash,
      deletedAt: 1
    }], { create, get });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const result = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(result).toMatchObject({ ok: true, restored: 1, fallback: 0, failed: [] });
      expect(get).toHaveBeenCalledWith('one');
      expect(create).not.toHaveBeenCalled();
      expect(harness.getTrash()).toEqual([]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('删除仍在进行时恢复会保留记录，等待删除结果收尾', async () => {
    const previousChrome = globalThis.chrome;
    const trash = {
      id: 'one',
      title: '示例',
      url: 'https://example.com/one',
      parentId: 'folder',
      deletedAt: 1
    };
    const create = vi.fn().mockResolvedValue({ id: 'unexpected' });
    const get = vi.fn().mockResolvedValue([{ ...trash }]);
    const harness = createBackgroundHarness([], { create, get });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.send({
        type: 'bmTrashMutation',
        action: 'add',
        deletionPending: true,
        items: [trash]
      });
      const result = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(result).toMatchObject({
        ok: true,
        restored: 0,
        failed: [{ id: 'one', error: '书签删除仍在进行，请稍后重试' }]
      });
      expect(create).not.toHaveBeenCalled();
      expect(harness.getTrash()).toEqual([expect.objectContaining({
        id: 'one',
        deletionPending: true
      })]);
      expect(harness.getTrash()[0].restoreStartedAt).toBeUndefined();
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('没有活跃删除心跳的旧进行中记录会安全收敛', async () => {
    const previousChrome = globalThis.chrome;
    const trash = {
      id: 'one',
      title: '示例',
      url: 'https://example.com/one',
      parentId: 'folder',
      deletedAt: 1,
      deletionPending: true,
      deletionPendingAt: Date.now() - 60000
    };
    const create = vi.fn().mockResolvedValue({ id: 'unexpected' });
    const get = vi.fn().mockResolvedValue([{ ...trash }]);
    const harness = createBackgroundHarness([trash], { create, get });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const result = await harness.send({ type: 'bmTrashMutation', action: 'restore', ids: ['one'] });

      expect(result).toMatchObject({ ok: true, restored: 1, failed: [] });
      expect(create).not.toHaveBeenCalled();
      expect(harness.getTrash()).toEqual([]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('批量收尾会确认成功删除项并移除失败项的回收站记录', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([
      { id: 'removed', url: 'https://example.com/removed', deletionPending: true },
      { id: 'failed', url: 'https://example.com/failed', deletionPending: true },
      { id: 'unchanged', url: 'https://example.com/unchanged' }
    ]);
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const result = await harness.send({
        type: 'bmTrashMutation',
        action: 'completeDelete',
        removedIds: ['removed'],
        failedIds: ['failed']
      });

      expect(result).toMatchObject({ ok: true, completed: 1, discarded: 1 });
      expect(harness.getTrash()).toEqual([
        expect.objectContaining({ id: 'removed', deletionPending: false }),
        expect.objectContaining({ id: 'unchanged' })
      ]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('单次删除超过回收站上限时拒绝写入，避免丢失恢复记录', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([]);
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const items = Array.from({ length: 5001 }, (_unused, index) => ({
        id: String(index),
        title: '书签 ' + index,
        url: 'https://example.com/' + index
      }));
      const result = await harness.send({
        type: 'bmTrashMutation',
        action: 'add',
        deletionPending: true,
        items
      });

      expect(result).toMatchObject({ ok: false, error: '单次删除超过回收站上限，请分批处理' });
      expect(harness.getTrash()).toEqual([]);
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });
});
describe('浏览器收藏接管', () => {
  it('按高置信域名语义静默打标', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['工作', '设计', '论坛', '代码', '运维', '工具', '其他'],
        bmTags: {}
      }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await Promise.all([
        harness.triggerBookmarkCreated('design', { parentId: 'bar', url: 'https://figma.com/design/example', title: '设计稿' }),
        harness.triggerBookmarkCreated('forum', { parentId: 'bar', url: 'https://community.discourse.org/t/topic/1', title: '话题' }),
        harness.triggerBookmarkCreated('repo', { parentId: 'bar', url: 'https://github.com/openai/codex', title: '仓库' }),
        harness.triggerBookmarkCreated('network', { parentId: 'bar', url: 'https://login.tailscale.com/admin', title: '组网服务' })
      ]);

      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: {
        design: ['设计', '工作'],
        forum: ['论坛'],
        repo: ['代码'],
        network: ['运维', '工具']
      } });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('旧默认标签池也会即时获得新语义标签', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: legacyDefaultFixedTags, bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('repo', {
        parentId: 'bar', url: 'https://github.com/example/repo', title: '仓库'
      });

      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { repo: ['代码'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('未打开设置页时也兼容旧域名分组配置', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['工作', '其他'],
        bmDomainGroups: { 'corp.example': '工作' },
        bmTags: {}
      }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('legacy-group', {
        parentId: 'bar', url: 'https://docs.corp.example/guide', title: '内部文档'
      });

      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { 'legacy-group': ['工作'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('后台与前台一致，只使用固定标签池前 50 项', async () => {
    const previousChrome = globalThis.chrome;
    const fixedTags = Array.from({ length: 51 }, (_, index) => '标签' + (index + 1));
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: fixedTags,
        bmTagRules: { domain: { late: ['标签51'] }, keyword: {} },
        bmTags: {}
      }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('limit', {
        parentId: 'bar', url: 'https://late.example/path', title: '普通内容'
      });

      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { limit: ['其他'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('命中用户自定义规则时静默打标且不调用 AI', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn();
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['工作', '代码', '其他'],
        bmTagRules: { domain: { corp: ['工作', '代码'] }, keyword: {} },
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('custom', {
        parentId: 'bar', url: 'https://docs.corp.example/guide?代码=1#代码', title: '内部文档'
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { custom: ['工作', '代码'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('后台自动打标保留规则指定的最多 6 个标签', async () => {
    const previousChrome = globalThis.chrome;
    const ruleTags = Array.from({ length: 6 }, (_, index) => '标签' + (index + 1));
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: [...ruleTags, '其他'],
        bmTagRules: { domain: { corp: ruleTags }, keyword: {} },
        bmTags: {}
      }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('custom-six', {
        parentId: 'bar', url: 'https://docs.corp.example/guide', title: '内部文档'
      });

      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { 'custom-six': ruleTags } });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('显式开启后为规则未知的普通收藏静默调用 AI，并移除 URL 参数', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    let resolveFetch;
    const fetch = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['学习', '其他'],
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      const creation = harness.triggerBookmarkCreated('unknown', {
        parentId: 'bar', url: 'https://example.org/article?utm_source=bookmark#chapter', title: '专题内容'
      });

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(harness.storageSet).toHaveBeenCalledWith({ bmTags: { unknown: ['其他'] } });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.messages[1].content).toContain('https://example.org/article');
      expect(body.messages[1].content).not.toContain('utm_source=bookmark');
      resolveFetch({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: '{"results":[{"id":"unknown","tags":["学习"]}]}' } }] })
      });
      await creation;
      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { unknown: ['学习'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('后台 AI 跳过登录入口并回退本地标签', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn();
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['学习', '其他'],
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('login', {
        parentId: 'bar', url: 'https://accounts.example.org/login', title: '账户登录'
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { login: ['其他'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('后台 AI 请求失败时保留本地规则结果', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn().mockRejectedValue(new Error('网络中断'));
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['学习', '其他'],
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('fallback', {
        parentId: 'bar', url: 'https://example.org/course', title: '学习课程'
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { fallback: ['学习'] } });
    } finally {
      warn.mockRestore();
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('等待 AI 时用户手动改标，陈旧 AI 结果不会覆盖人工标签', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    let resolveFetch;
    const fetch = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['AI', '工作', '设计', '学习', '工具', '其他'],
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      const creation = harness.triggerBookmarkCreated('edited', {
        parentId: 'bar', url: 'https://example.org/item', title: '未知内容'
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      await harness.send({
        type: 'bmTagMutation',
        changes: { edited: ['工作', '设计', '学习', '工具'] }
      });
      resolveFetch({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: '{"results":[{"id":"edited","tags":["AI"]}]}' } }] })
      });
      await creation;

      expect(harness.storageSet).toHaveBeenLastCalledWith({
        bmTags: { edited: ['工作', '设计', '学习', '工具'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('原生批量导入不触发后台 AI', async () => {
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const fetch = vi.fn();
    const harness = createBackgroundHarness([], {
      localData: {
        bmFixedTags: ['学习', '其他'],
        bmTags: {},
        bmAutoAiTag: true,
        bmSettings: { apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'test' }
      }
    });
    globalThis.chrome = harness.chrome;
    globalThis.fetch = fetch;

    try {
      new Function(backgroundCode)();
      harness.triggerBookmarkImportBegan();
      const creation = harness.triggerBookmarkCreated('imported', {
        parentId: 'bar', url: 'https://example.org/course', title: '学习课程'
      });
      harness.triggerBookmarkImportEnded();
      await creation;

      expect(fetch).not.toHaveBeenCalled();
      expect(harness.storageSet).toHaveBeenLastCalledWith({ bmTags: { imported: ['学习'] } });
    } finally {
      restoreGlobal('chrome', previousChrome);
      restoreGlobal('fetch', previousFetch);
    }
  });

  it('浏览器收藏在后台写入匹配的默认标签，不触发待保存记录', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('browser-created', {
        parentId: 'bar',
        url: 'https://github.com/example/project',
        title: '项目仓库'
      });

      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'browser-created': ['代码'] }
      });
      expect(harness.chrome.storage.session.set).not.toHaveBeenCalled();
      expect(harness.chrome.sidePanel.open).not.toHaveBeenCalled();
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('未命中标签规则时写入其他标签', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.triggerBookmarkCreated('browser-created', {
        parentId: 'bar',
        url: 'https://example.org/unknown',
        title: '未知网站'
      });

      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'browser-created': ['其他'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('插件内手动新增的书签不会被后台再次打标', async () => {
    const previousChrome = globalThis.chrome;
    const url = 'https://github.com/example/project';
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.send({
        type: 'bmSelfCreatingBookmark', action: 'reserve', parentId: 'bar', url
      });
      const created = harness.triggerBookmarkCreated('plugin-created', {
        parentId: 'bar',
        url,
        title: '项目仓库'
      });
      await harness.send({
        type: 'bmSelfCreatingBookmark', action: 'confirm', parentId: 'bar', url, bookmarkId: 'plugin-created'
      });
      await created;

      expect(harness.chrome.storage.local.set).not.toHaveBeenCalled();
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('插件创建和同 URL 原生收藏交错时，只跳过插件创建', async () => {
    const previousChrome = globalThis.chrome;
    const url = 'https://github.com/example/project';
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.send({
        type: 'bmSelfCreatingBookmark', action: 'reserve', parentId: 'bar', url
      });
      const pluginCreation = harness.triggerBookmarkCreated('plugin-created', {
        parentId: 'bar', url, title: '插件新增'
      });
      const browserCreation = harness.triggerBookmarkCreated('star-created', {
        parentId: 'bar', url, title: '浏览器收藏'
      });
      await harness.send({
        type: 'bmSelfCreatingBookmark', action: 'confirm', parentId: 'bar', url, bookmarkId: 'plugin-created'
      });
      await Promise.all([pluginCreation, browserCreation]);

      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'star-created': ['代码'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('后台标签事务与原生收藏交错时保留双方标签', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '工作', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      const browserCreation = harness.triggerBookmarkCreated('star-created', {
        parentId: 'bar', url: 'https://github.com/example/project', title: '项目仓库'
      });
      const manualMutation = harness.send({
        type: 'bmTagMutation', changes: { 'manual-created': ['工作'] }
      });
      await Promise.all([browserCreation, manualMutation]);

      expect(harness.chrome.storage.local.set).toHaveBeenLastCalledWith({
        bmTags: {
          'manual-created': ['工作'],
          'star-created': ['代码']
        }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('后台标签事务的 merge 模式保留已有标签', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['AI', '工具', '其他'], bmTags: { existing: ['工具'] } }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.send({
        type: 'bmTagMutation', changes: { existing: ['AI'] }, mode: 'merge'
      });

      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { existing: ['工具', 'AI'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('后台标签事务的 merge 模式在标签已满时保留已有标签', async () => {
    const previousChrome = globalThis.chrome;
    const existingTags = ['工具', '前端', '后端', '安全', '设计', '学习'];
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['AI', ...existingTags, '其他'], bmTags: { existing: existingTags } }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      await harness.send({
        type: 'bmTagMutation', changes: { existing: ['AI'] }, mode: 'merge'
      });

      expect(harness.chrome.storage.local.set).not.toHaveBeenCalled();
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('Chrome 原生导入结束后合并默认打标，只写入一次标签表', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['代码', '其他'], bmTags: {} }
    });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      harness.triggerBookmarkImportBegan();
      const first = harness.triggerBookmarkCreated('import-one', {
        parentId: 'bar', url: 'https://github.com/example/one', title: '仓库一'
      });
      const second = harness.triggerBookmarkCreated('import-two', {
        parentId: 'bar', url: 'https://example.org/two', title: '未知网址'
      });
      expect(harness.chrome.storage.local.set).not.toHaveBeenCalled();

      harness.triggerBookmarkImportEnded();
      await Promise.all([first, second]);

      expect(harness.chrome.storage.local.set).toHaveBeenCalledOnce();
      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'import-one': ['代码'], 'import-two': ['其他'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('原生导入会等待已派发的异步创建事件入队后再批量写入', async () => {
    const previousChrome = globalThis.chrome;
    let releaseConfig;
    let configReleased = false;
    const localGet = vi.fn(() => {
      if (!configReleased) return new Promise(resolve => { releaseConfig = resolve; });
      return Promise.resolve({ bmFixedTags: ['代码', '其他'], bmTags: {} });
    });
    const harness = createBackgroundHarness([], { localGet });
    globalThis.chrome = harness.chrome;

    try {
      new Function(backgroundCode)();
      harness.triggerBookmarkImportBegan();
      const creation = harness.triggerBookmarkCreated('import-late', {
        parentId: 'bar', url: 'https://github.com/example/late', title: '导入尾项'
      });
      await vi.waitFor(() => expect(localGet).toHaveBeenCalledOnce());
      harness.triggerBookmarkImportEnded();
      expect(harness.chrome.storage.local.set).not.toHaveBeenCalled();

      configReleased = true;
      releaseConfig({ bmFixedTags: ['代码', '其他'], bmTags: {} });
      await creation;

      expect(harness.chrome.storage.local.set).toHaveBeenCalledOnce();
      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'import-late': ['代码'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });
});

it('后台自动打标保留显式空标签池', async () => {
  const previousChrome = globalThis.chrome;
  const harness = createBackgroundHarness([], {
    localData: { bmFixedTags: [], bmTags: {} }
  });
  globalThis.chrome = harness.chrome;

  try {
    new Function(backgroundCode)();
    await harness.triggerBookmarkCreated('browser-created', {
      parentId: 'bar', url: 'https://github.com/example/project', title: '项目仓库'
    });

    expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
      bmTags: { 'browser-created': ['其他'] }
    });
  } finally {
    restoreGlobal('chrome', previousChrome);
  }
});
