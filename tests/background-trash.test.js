import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backgroundCode = readFileSync(join(__dirname, '..', 'js', 'background.js'), 'utf-8');

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
  let trash = initialTrash.slice();
  const localData = { ...(options.localData || {}), bmTrash: trash };
  const setTrash = value => {
    trash = value;
    localData.bmTrash = value;
  };
  const storageSet = vi.fn().mockImplementation(value => {
    if (Object.prototype.hasOwnProperty.call(value, 'bmTrash')) setTrash(value.bmTrash);
    Object.assign(localData, value);
    return Promise.resolve();
  });
  const storageGet = options.localGet || vi.fn().mockImplementation(() => Promise.resolve({ ...localData }));
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
      local: {
        get: storageGet,
        set: storageSet
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
  it('浏览器收藏在后台写入匹配的默认标签，不触发待保存记录', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['GitHub', '其他'], bmTags: {} }
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
        bmTags: { 'browser-created': ['GitHub'] }
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
      localData: { bmFixedTags: ['GitHub', '其他'], bmTags: {} }
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
      localData: { bmFixedTags: ['GitHub', '其他'], bmTags: {} }
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
      localData: { bmFixedTags: ['GitHub', '其他'], bmTags: {} }
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
        bmTags: { 'star-created': ['GitHub'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('后台标签事务与原生收藏交错时保留双方标签', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['GitHub', '工作', '其他'], bmTags: {} }
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
          'star-created': ['GitHub']
        }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });

  it('Chrome 原生导入结束后合并默认打标，只写入一次标签表', async () => {
    const previousChrome = globalThis.chrome;
    const harness = createBackgroundHarness([], {
      localData: { bmFixedTags: ['GitHub', '其他'], bmTags: {} }
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
        bmTags: { 'import-one': ['GitHub'], 'import-two': ['其他'] }
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
      return Promise.resolve({ bmFixedTags: ['GitHub', '其他'], bmTags: {} });
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
      releaseConfig({ bmFixedTags: ['GitHub', '其他'], bmTags: {} });
      await creation;

      expect(harness.chrome.storage.local.set).toHaveBeenCalledOnce();
      expect(harness.chrome.storage.local.set).toHaveBeenCalledWith({
        bmTags: { 'import-late': ['GitHub'] }
      });
    } finally {
      restoreGlobal('chrome', previousChrome);
    }
  });
});
