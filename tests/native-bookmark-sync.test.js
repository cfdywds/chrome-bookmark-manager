import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backgroundCode = readFileSync(join(__dirname, '..', 'js', 'background.js'), 'utf8');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createTree(bookmarks) {
  return [{
    id: '0',
    title: '',
    children: [
      { id: '1', title: '书签栏', children: bookmarks || [] },
      { id: '2', title: '其他书签', children: [] }
    ]
  }];
}

function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (String(node.id) === String(id)) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function nextBookmarkId(tree) {
  let maximum = 99;
  (function walk(nodes) {
    (nodes || []).forEach(node => {
      const id = Number(node && node.id);
      if (Number.isInteger(id)) maximum = Math.max(maximum, id);
      walk(node && node.children);
    });
  })(tree);
  return maximum + 1;
}

function createHarness(tree, initialLocal, options = {}) {
  let nextId = nextBookmarkId(tree);
  const messageListeners = [];
  const storageListeners = [];
  const bookmarkCreatedListeners = [];
  const bookmarkChangedListeners = [];
  const bookmarkRemovedListeners = [];
  const installedListeners = [];
  const startupListeners = [];
  const alarmListeners = [];
  const alarms = new Map();
  const localData = { ...(initialLocal || {}) };
  const localSet = vi.fn(async values => {
    const changes = {};
    Object.entries(values).forEach(([key, value]) => {
      changes[key] = { oldValue: localData[key], newValue: value };
      localData[key] = value;
    });
    storageListeners.forEach(listener => listener(changes, 'local'));
  });
  const localRemove = vi.fn(async keys => {
    const names = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    names.forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(localData, key)) return;
      changes[key] = { oldValue: localData[key], newValue: undefined };
      delete localData[key];
    });
    if (Object.keys(changes).length) storageListeners.forEach(listener => listener(changes, 'local'));
  });
  const chrome = {
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(), open: vi.fn() },
    runtime: {
      onMessage: { addListener: listener => messageListeners.push(listener) },
      onInstalled: { addListener: listener => installedListeners.push(listener) },
      onStartup: { addListener: listener => startupListeners.push(listener) }
    },
    bookmarks: {
      getTree: vi.fn(async () => clone(tree)),
      getChildren: vi.fn(async id => clone((findNode(tree, id) || {}).children || [])),
      create: vi.fn(async info => {
        const parent = findNode(tree, info.parentId);
        if (!parent) throw new Error('父目录不存在');
        if (options.maxBookmarkTitleLength && String(info.title || '').length > options.maxBookmarkTitleLength) {
          throw new Error('书签标题过长');
        }
        const node = {
          id: String(nextId++),
          parentId: String(info.parentId),
          title: info.title || ''
        };
        if (info.url) node.url = info.url;
        else node.children = [];
        if (options.dropNativeSyncChunks && node.title.startsWith('BMN1|S|')) return clone(node);
        parent.children = parent.children || [];
        parent.children.push(node);
        return clone(node);
      }),
      update: vi.fn(async (id, changes) => {
        const node = findNode(tree, id);
        if (!node) throw new Error('书签不存在');
        Object.assign(node, changes);
        return clone(node);
      }),
      remove: vi.fn(async id => {
        const node = findNode(tree, id);
        const parent = node && findNode(tree, node.parentId);
        if (!node || !parent) throw new Error('书签不存在');
        parent.children = parent.children.filter(child => String(child.id) !== String(id));
      }),
      get: vi.fn().mockRejectedValue(new Error('Bookmark not found')),
      search: vi.fn().mockResolvedValue([]),
      onCreated: { addListener: listener => bookmarkCreatedListeners.push(listener) },
      onChanged: { addListener: listener => bookmarkChangedListeners.push(listener) },
      onRemoved: { addListener: listener => bookmarkRemovedListeners.push(listener) },
      onMoved: { addListener: vi.fn() },
      onImportBegan: { addListener: vi.fn() },
      onImportEnded: { addListener: vi.fn() }
    },
    alarms: {
      create: vi.fn((name, info) => {
        alarms.set(name, { name, ...(info || {}) });
      }),
      clear: vi.fn(async name => alarms.delete(name)),
      getAll: vi.fn(async () => [...alarms.values()]),
      onAlarm: { addListener: listener => alarmListeners.push(listener) }
    },
    storage: {
      onChanged: { addListener: listener => storageListeners.push(listener) },
      local: {
        get: vi.fn(async keys => {
          if (typeof keys === 'string') return { [keys]: localData[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, localData[key]]));
          return { ...localData };
        }),
        set: localSet,
        remove: localRemove
      },
      sync: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue() },
      session: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() }
    }
  };
  return {
    chrome,
    localData,
    tree,
    localSet,
    emitBookmarkChanged(id, changes) {
      bookmarkChangedListeners.forEach(listener => listener(id, changes));
    },
    triggerBookmarkCreated(id, bookmark) {
      return Promise.all(bookmarkCreatedListeners.map(listener => listener(id, bookmark)));
    },
    emitBookmarkRemoved(id, node) {
      bookmarkRemovedListeners.forEach(listener => listener(id, { node }));
    },
    emitInstalled() {
      installedListeners.forEach(listener => listener());
    },
    emitStartup() {
      startupListeners.forEach(listener => listener());
    },
    emitAlarm(name) {
      alarmListeners.forEach(listener => listener({ name }));
    },
    send(message) {
      return new Promise((resolve, reject) => {
        let pending = false;
        messageListeners.forEach(listener => {
          if (listener(message, {}, resolve) === true) pending = true;
        });
        if (!pending) reject(new Error('没有消息处理器'));
      });
    }
  };
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

function syncRoot(tree) {
  return findNode(tree, '2').children.find(node => node.title === '书签管家同步数据（请勿修改）');
}

let previousChrome;

beforeEach(() => {
  previousChrome = globalThis.chrome;
});

describe('原生书签标签同步', () => {
  it('消息处理失败时先响应调用方，再异步记录诊断信息', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([]));
    const readLocal = source.chrome.storage.local.get.getMockImplementation();
    source.chrome.storage.local.get.mockImplementation(async keys => {
      if (Array.isArray(keys) && keys.includes('bmNativeTagSyncState')) {
        throw new Error('存储不可用');
      }
      return readLocal(keys);
    });
    source.chrome.storage.local.set.mockImplementationOnce(() => new Promise(() => {}));
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();
    let timeoutId;

    try {
      const response = source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('消息响应被诊断写入阻塞')), 100);
      });
      await expect(Promise.race([response, timeout]))
        .resolves.toMatchObject({ ok: false, error: '存储不可用' });
      clearTimeout(timeoutId);
      expect(source.chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        bmTagSyncStatus: expect.objectContaining({ lastError: '存储不可用' })
      }));
    } finally {
      clearTimeout(timeoutId);
      vi.clearAllTimers();
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('只在历史传输错误仍未变化时清理状态', async () => {
    const closedMessage =
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';
    const source = createHarness(createTree([]), {
      bmTagSyncStatus: { lastError: closedMessage, at: 1, errorKind: 'transport' }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({
        type: 'bmNativeTagSync', action: 'clearTransportError',
        status: { lastError: closedMessage, at: 1, errorKind: 'transport' }
      })).resolves.toMatchObject({ ok: true, changed: true });
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });

      source.localData.bmTagSyncStatus = { lastError: '新的真实错误', at: 2 };
      await expect(source.send({
        type: 'bmNativeTagSync', action: 'clearTransportError',
        status: { lastError: closedMessage, at: 1, errorKind: 'transport' }
      })).resolves.toMatchObject({ ok: true, changed: false });
      expect(source.localData.bmTagSyncStatus).toEqual({ lastError: '新的真实错误', at: 2 });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('兼容清理旧版本留下的 Chrome 固定通道错误', async () => {
    const closedMessage =
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';
    const source = createHarness(createTree([]), {
      bmTagSyncStatus: { lastError: closedMessage, at: 1 }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({
        type: 'bmNativeTagSync', action: 'clearTransportError',
        status: { lastError: closedMessage, at: 1, errorKind: 'legacy-transport' }
      })).resolves.toMatchObject({ ok: true, changed: true });
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('受 Chrome 书签标题长度限制时仍会写入全部同步分片', async () => {
    const bookmarks = Array.from({ length: 96 }, (_value, index) => {
      const id = `source-${index}`;
      const token = ((index + 1) * 2654435761 >>> 0).toString(36);
      return {
        id,
        parentId: '1',
        title: `Bookmark ${index}`,
        url: `https://${token}.example.com/${index}/${token}`
      };
    });
    const tags = Object.fromEntries(bookmarks.map(bookmark => [bookmark.id, [`标签-${bookmark.id}`]]));
    const source = createHarness(createTree(bookmarks), {
      bmTags: tags,
      bmFixedTags: [],
      bmTagRules: { domain: {}, keyword: {} }
    }, { maxBookmarkTitleLength: 255 });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true }))
        .resolves.toMatchObject({ ok: true, changed: true });
      const device = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|'));
      expect(device.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
      expect(source.chrome.bookmarks.create.mock.calls.every(([info]) => info.title.length <= 255)).toBe(true);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  }, 15000);

  it('分片未实际落盘时不会把同步状态标记为成功', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI'],
      bmTagRules: { domain: {}, keyword: {} },
      bmTagSyncStatus: { lastError: '', at: 1, lastSuccessAt: 1 }
    }, { dropNativeSyncChunks: true });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true }))
        .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/写入后验证失败/) });
      await vi.waitFor(
        () => expect(source.localData.bmTagSyncStatus.lastError).toMatch(/写入后验证失败/),
        { timeout: 10000 }
      );
      expect(source.localData.bmTagSyncStatus.lastSuccessAt).toBeUndefined();
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('已有同步版本的重新发布失败后，其他设备仍可读取旧数据', async () => {
    const writeOptions = {};
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI'],
      bmTagRules: { domain: {}, keyword: {} }
    }, writeOptions);
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      writeOptions.dropNativeSyncChunks = true;
      await source.chrome.storage.local.set({ bmTags: { source: ['工作'] } });
      await vi.waitFor(
        () => expect(source.localData.bmTagSyncStatus.lastError).toMatch(/写入后验证失败/),
        { timeout: 10000 }
      );

      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: [],
        bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [
        { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
      ];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await expect(target.send({ type: 'bmNativeTagSync', action: 'hydrate' }))
        .resolves.toMatchObject({ ok: true, changed: true });
      expect(target.localData.bmTags).toEqual({ target: ['AI'] });
    } finally {
      warn.mockRestore();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('安装时同步目录稍后到达，后台重试后会导入标签', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(source.localData.bmNativeTagSyncRecords).toMatchObject({
        'openai.com/research': { tags: ['AI'] }
      });
      const target = createHarness(createTree([
        { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
      ]), { bmTags: {}, bmNativeTagSyncEnabled: true });
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      target.emitInstalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(target.chrome.bookmarks.getTree).toHaveBeenCalledOnce();
      target.tree[0].children[1].children.push(clone(syncRoot(source.tree)));
      expect(syncRoot(target.tree)).toBeTruthy();
      target.emitAlarm('bm-native-sync-hydration');

      await vi.waitFor(
        () => expect(target.localData.bmTags).toEqual({ target: ['AI'] }),
        { timeout: 5000 }
      );
      expect(target.chrome.bookmarks.getTree.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('首台设备种子后，另一台设备无需相同扩展 ID 即可读取标签和配置', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://www.openai.com/research/' }
    ]), {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI', '工作'],
      bmTagRules: { domain: { openai: ['AI'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true }))
        .resolves.toMatchObject({ ok: true, changed: true });
      const root = syncRoot(source.tree);
      expect(root).toBeTruthy();
      expect(root.children.every(node => !node.url)).toBe(true);
      expect(source.localData.bmNativeTagSyncRecords).toMatchObject({
        'openai.com/research': { tags: ['AI'], revision: expect.any(Array) }
      });

      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: ['离线'],
        bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await expect(target.send({ type: 'bmNativeTagSync', action: 'hydrate' }))
        .resolves.toMatchObject({ ok: true, changed: true });
      await settle();

      expect(target.localData.bmNativeTagSyncEnabled).toBe(true);
      expect(target.localData.bmTags).toEqual({ target: ['AI'] });
      expect(target.localData.bmFixedTags).toEqual(['AI', '工作']);
      expect(target.localData.bmTagRules).toEqual({ domain: { openai: ['AI'] }, keyword: {} });
      expect(syncRoot(target.tree).children.filter(node => node.title.startsWith('BMN1|D|'))).toHaveLength(1);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('设置页保存配置后，带旧快照的水合只应用标签而不覆盖本地配置', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['远端标签'] },
      bmFixedTags: ['远端配置'],
      bmTagRules: { domain: { openai: ['远端配置'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: ['刚保存的本地配置'],
        bmTagRules: { domain: { local: ['刚保存的本地配置'] }, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await expect(target.send({
        type: 'bmNativeTagSync', action: 'hydrate',
        configSnapshot: {
          fixedTags: ['设置页刚加载时的旧配置'],
          tagRules: { domain: {}, keyword: {} }
        }
      })).resolves.toMatchObject({ ok: true, changed: true });

      expect(target.localData.bmTags).toEqual({ target: ['远端标签'] });
      expect(target.localData.bmFixedTags).toEqual(['刚保存的本地配置']);
      expect(target.localData.bmTagRules).toEqual({
        domain: { local: ['刚保存的本地配置'] }, keyword: {}
      });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('水合写入前到达的配置保存请求会在水合之后落盘', async () => {
    let releaseHydrationWrite;
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['远端标签'] },
      bmFixedTags: ['远端配置'],
      bmTagRules: { domain: { openai: ['远端配置'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: ['加载时配置'],
        bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const originalGet = target.chrome.storage.local.get.getMockImplementation();
      let stateReadCount = 0;
      target.chrome.storage.local.get.mockImplementation(async keys => {
        const wantsState = Array.isArray(keys) && keys.includes('bmNativeTagSyncState');
        if (wantsState && ++stateReadCount === 2) {
          await new Promise(resolve => { releaseHydrationWrite = resolve; });
        }
        return originalGet(keys);
      });
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      const hydration = target.send({
        type: 'bmNativeTagSync', action: 'hydrate',
        configSnapshot: { fixedTags: ['加载时配置'], tagRules: { domain: {}, keyword: {} } }
      });
      await vi.waitFor(() => expect(releaseHydrationWrite).toEqual(expect.any(Function)));
      await target.chrome.storage.local.set({
        bmNativeTagSyncConfigRequest: {
          id: 'config-user-save', fixedTags: ['刚保存的本地配置'],
          tagRules: { domain: { local: ['刚保存的本地配置'] }, keyword: {} }
        }
      });
      releaseHydrationWrite();
      await hydration;

      await vi.waitFor(() => expect(target.localData.bmFixedTags).toEqual(['刚保存的本地配置']));
      expect(target.localData.bmTagRules).toEqual({
        domain: { local: ['刚保存的本地配置'] }, keyword: {}
      });
      expect(target.localData.bmTags).toEqual({ target: ['远端标签'] });
      expect(target.localData.bmNativeTagSyncConfigRequest).toBeUndefined();
      expect(target.chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
        bmFixedTags: ['远端配置']
      }));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('水合进入配置写入窗口后到达的保存请求不会闪写远端配置', async () => {
    let releaseLatestConfigRead;
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['远端标签'] },
      bmFixedTags: ['远端配置'],
      bmTagRules: { domain: { openai: ['远端配置'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: ['加载时配置'],
        bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const originalGet = target.chrome.storage.local.get.getMockImplementation();
      target.chrome.storage.local.get.mockImplementation(async keys => {
        const isLatestConfigRead = Array.isArray(keys) && keys.length === 3 &&
          keys.includes('bmFixedTags') && keys.includes('bmTagRules') &&
          keys.includes('bmNativeTagSyncConfigRequest');
        if (isLatestConfigRead && !releaseLatestConfigRead) {
          await new Promise(resolve => { releaseLatestConfigRead = resolve; });
        }
        return originalGet(keys);
      });
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      const hydration = target.send({
        type: 'bmNativeTagSync', action: 'hydrate',
        configSnapshot: { fixedTags: ['加载时配置'], tagRules: { domain: {}, keyword: {} } }
      });
      await vi.waitFor(() => expect(releaseLatestConfigRead).toEqual(expect.any(Function)));
      await target.chrome.storage.local.set({
        bmNativeTagSyncConfigRequest: {
          id: 'config-user-input', fixedTags: ['用户正在输入'],
          tagRules: { domain: { local: ['用户正在输入'] }, keyword: {} }
        }
      });
      releaseLatestConfigRead();
      await hydration;

      await vi.waitFor(() => expect(target.localData.bmFixedTags).toEqual(['用户正在输入']));
      expect(target.localData.bmTags).toEqual({ target: ['远端标签'] });
      expect(target.chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
        bmFixedTags: ['远端配置']
      }));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('一次配置保存请求只发布一个配置修订', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const configWritesBefore = source.chrome.storage.local.set.mock.calls.filter(([values]) =>
        Object.prototype.hasOwnProperty.call(values, 'bmNativeTagSyncConfig')
      ).length;
      await source.chrome.storage.local.set({
        bmNativeTagSyncConfigRequest: {
          id: 'config-single-revision', fixedTags: ['AI', '工作'],
          tagRules: { domain: { openai: ['AI'] }, keyword: {} }
        }
      });

      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncConfigRequest).toBeUndefined());
      await settle();
      const configWritesAfter = source.chrome.storage.local.set.mock.calls.filter(([values]) =>
        Object.prototype.hasOwnProperty.call(values, 'bmNativeTagSyncConfig')
      ).length;
      expect(configWritesAfter - configWritesBefore).toBe(1);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('同步目录先到时，远端书签不会被本机默认标签覆盖', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['工作'] },
      bmFixedTags: ['AI', '工作'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI', '工作'], bmTagRules: { domain: {}, keyword: {} }
      });
      // Chrome 同步时，保留目录可能先到；普通书签随后才触发 onCreated。
      target.tree[0].children[0].children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      const remoteBookmark = {
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      };
      target.tree[0].children[0].children.push(remoteBookmark);
      await target.triggerBookmarkCreated('target', remoteBookmark);

      expect(target.localData.bmTags).toEqual({ target: ['工作'] });
      // 等待 onCreated 的防抖水合完成，避免其计时器落到后续测试的全局 chrome 上。
      await new Promise(resolve => setTimeout(resolve, 900));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('同步分片未完整到达时，延后默认打标直到远端标签可读取', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['工作'] },
      bmFixedTags: ['AI', '工作'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI', '工作'], bmTagRules: { domain: {}, keyword: {} }
      });
      const completeDeviceChildren = clone(syncRoot(source.tree).children[0].children);
      const targetDevice = syncRoot(target.tree).children[0];
      targetDevice.children = targetDevice.children.filter(node => !node.title.startsWith('BMN1|S|'));
      target.tree[0].children[0].children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      const remoteBookmark = {
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      };
      target.tree[0].children[0].children.push(remoteBookmark);
      await target.triggerBookmarkCreated('target', remoteBookmark);
      expect(target.localData.bmTags).toEqual({});

      targetDevice.children = completeDeviceChildren;
      await vi.waitFor(
        () => expect(target.localData.bmTags).toEqual({ target: ['工作'] }),
        { timeout: 5000 }
      );
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('同步分片稍后到达且没有新事件时，后台重试后会自动恢复', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机'] },
        bmFixedTags: ['AI'],
        bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const device = syncRoot(target.tree).children[0];
      const completeChildren = clone(device.children);
      device.children = device.children.filter(node => !node.title.startsWith('BMN1|S|'));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await expect(target.send({ type: 'bmNativeTagSync', action: 'hydrate' }))
        .resolves.toMatchObject({ ok: true, changed: false });
      expect(target.localData.bmTags).toEqual({ target: ['本机'] });
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/分片/);

      device.children = completeChildren;
      target.emitAlarm('bm-native-sync-hydration');
      await vi.waitFor(
        () => expect(target.localData.bmTags).toEqual({ target: ['AI'] }),
        { timeout: 5000 }
      );
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('Service Worker 重启后由持久闹钟完成最后一次恢复', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机'] },
        bmFixedTags: ['AI'],
        bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const device = syncRoot(target.tree).children[0];
      const completeChildren = clone(device.children);
      device.children = device.children.filter(node => !node.title.startsWith('BMN1|S|'));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      await vi.runAllTimersAsync();
      expect(target.chrome.alarms.create).toHaveBeenCalledWith(
        'bm-native-sync-hydration-1',
        { when: expect.any(Number) }
      );

      device.children = completeChildren;
      const restarted = createHarness(target.tree, target.localData);
      globalThis.chrome = restarted.chrome;
      new Function(backgroundCode)();
      restarted.emitAlarm('bm-native-sync-hydration');

      await vi.waitFor(() => expect(restarted.localData.bmTags).toEqual({ target: ['AI'] }));
      expect(restarted.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('现有同步目录只有设备层时会立即播种本机标签', async () => {
    const tree = createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(syncRoot(source.tree).children.some(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|'))
      )).toBe(true);
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['AI']);
      expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', lastSuccessAt: expect.any(Number)
      });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('最终重试会忽略始终没有发布头的孤立设备目录', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      syncRoot(source.tree).children.push({
        id: 'orphan-device', parentId: syncRoot(source.tree).id,
        title: 'BMN1|D|orphan-device', children: []
      });
      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', waitingForData: true, waitingDeviceCount: 1, directoryReady: false
      });
      expect(target.localData.bmTagSyncStatus).not.toHaveProperty('lastSuccessAt');
      await vi.runAllTimersAsync();
      target.emitAlarm('bm-native-sync-hydration');

      await vi.waitFor(
        () => expect(target.localData.bmTags).toEqual({ target: ['AI'] }),
        { timeout: 5000 }
      );
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('空设备目录等待期间不会为新书签抢先默认打标', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([]), {
      bmTags: {}, bmFixedTags: ['代码'],
      bmTagRules: { domain: { github: ['代码'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      syncRoot(source.tree).children.push({
        id: 'late-device', parentId: syncRoot(source.tree).id,
        title: 'BMN1|D|late-device', children: []
      });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['代码'],
        bmTagRules: { domain: { github: ['代码'] }, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      const bookmark = {
        id: 'target', parentId: '1', title: 'Repo', url: 'https://github.com/example/repo'
      };
      target.tree[0].children[0].children.push(bookmark);
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.triggerBookmarkCreated(bookmark.id, bookmark);
      expect(target.localData.bmTags).toEqual({});
      expect(target.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', waitingForData: true, waitingDeviceCount: 1
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('同一分桶出现重复 Head 时只读取最新提交', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const device = syncRoot(source.tree).children[0];
      const currentHead = device.children.find(node =>
        node.title.startsWith('BMN1|H|') && !node.title.startsWith('BMN1|H|config|')
      );
      const bucket = currentHead.title.split('|')[2];
      device.children.push({
        id: 'stale-head', parentId: device.id,
        title: `BMN1|H|${bucket}|0-old|1|stale-checksum`
      });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(target.localData.bmTags).toEqual({ target: ['AI'] });
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('本机缓存遇到全空设备目录时会立即重建提交头和分片', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const root = syncRoot(source.tree);
      root.children.forEach(device => { device.children = []; });
      for (let index = 0; index < 4; index++) {
        root.children.push({
          id: 'empty-device-' + index, parentId: root.id,
          title: 'BMN1|D|empty-device-' + index, children: []
        });
      }

      await source.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      const device = root.children.find(node => node.title ===
        'BMN1|D|' + source.localData.bmNativeTagSyncState.deviceId);
      expect(device.children.some(node => node.title.startsWith('BMN1|H|config|'))).toBe(true);
      expect(device.children.some(node => node.title.startsWith('BMN1|S|config|'))).toBe(true);
      expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', waitingForData: true, waitingDeviceCount: 4, directoryReady: false
      });
      expect(source.localData.bmTagSyncStatus).not.toHaveProperty('lastSuccessAt');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('明确启用时会把全空设备目录中的本机标签立即写入提交', async () => {
    const tree = createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] },
        { id: 'remote-device-1', parentId: 'sync-root', title: 'BMN1|D|remote-device-1', children: [] },
        { id: 'remote-device-2', parentId: 'sync-root', title: 'BMN1|D|remote-device-2', children: [] },
        { id: 'remote-device-3', parentId: 'sync-root', title: 'BMN1|D|remote-device-3', children: [] },
        { id: 'remote-device-4', parentId: 'sync-root', title: 'BMN1|D|remote-device-4', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: { source: ['AI', '工作'] },
      bmFixedTags: ['AI', '工作'],
      bmTagRules: { domain: {}, keyword: {} },
      bmNativeTagSyncState: { deviceId: 'local-device' }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true }))
        .resolves.toMatchObject({ ok: true, changed: true });

      const localDevice = findNode(source.tree, 'local-device');
      expect(localDevice.children.some(node => node.title.startsWith('BMN1|H|config|'))).toBe(true);
      expect(localDevice.children.some(node => node.title.startsWith('BMN1|H|') &&
        !node.title.startsWith('BMN1|H|config|'))).toBe(true);
      expect(localDevice.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['AI', '工作']);
      expect(source.localData.bmNativeTagSyncState.seeded).toBe(true);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('扩展重载后的已开启空目录会自动写入本机候选种子', async () => {
    const tree = createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI'],
      bmTagRules: { domain: {}, keyword: {} },
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seedAfterIncomplete: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'hydrate' }))
        .resolves.toMatchObject({ ok: true });

      const localDevice = findNode(source.tree, 'local-device');
      expect(localDevice.children.some(node => node.title.startsWith('BMN1|H|'))).toBe(true);
      expect(localDevice.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research']).toMatchObject({
        revision: [1, 0, 'candidate'], provisional: true
      });
      expect(source.localData.bmNativeTagSyncState.seedRequestId).toBe('');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('低优先级本机种子不会压过随后抵达的远端设备目录', async () => {
    const remote = createHarness(createTree([
      { id: 'remote-bookmark', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { 'remote-bookmark': ['远端标签'] },
      bmFixedTags: ['远端配置'],
      bmTagRules: { domain: { openai: ['远端配置'] }, keyword: {} }
    });
    globalThis.chrome = remote.chrome;
    new Function(backgroundCode)();

    try {
      await remote.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const delayedRemoteDevice = clone(syncRoot(remote.tree).children.find(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|'))
      ));
      const tree = createTree([
        { id: 'local-bookmark', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
      ]);
      tree[0].children[1].children.push({
        id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
          { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] }
        ]
      });
      const local = createHarness(tree, {
        bmTags: { 'local-bookmark': ['本机标签'] },
        bmFixedTags: ['本机配置'],
        bmTagRules: { domain: { local: ['本机配置'] }, keyword: {} },
        bmNativeTagSyncState: { deviceId: 'local-device' }
      });
      globalThis.chrome = local.chrome;
      new Function(backgroundCode)();

      await local.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(local.localData.bmNativeTagSyncRecords['openai.com/research'].revision[0]).toBe(1);

      syncRoot(local.tree).children.push(delayedRemoteDevice);
      await local.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(local.localData.bmTags).toEqual({ 'local-bookmark': ['远端标签'] });
      expect(local.localData.bmFixedTags).toEqual(['远端配置']);
      expect(local.localData.bmTagRules).toEqual({
        domain: { openai: ['远端配置'] }, keyword: {}
      });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('两台低优先级种子相遇时合并数据而不按设备 ID 丢弃后到设备', async () => {
    const remoteTree = createTree([
      { id: 'remote-bookmark', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    remoteTree[0].children[1].children.push({
      id: 'remote-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'a-device', parentId: 'remote-root', title: 'BMN1|D|a-device', children: [] }
      ]
    });
    const remote = createHarness(remoteTree, {
      bmTags: { 'remote-bookmark': ['远端标签'] },
      bmFixedTags: ['远端配置'],
      bmTagRules: { domain: { openai: ['远端配置'] }, keyword: {} },
      bmNativeTagSyncState: { deviceId: 'a-device' }
    });
    globalThis.chrome = remote.chrome;
    new Function(backgroundCode)();

    try {
      await remote.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const delayedRemoteDevice = clone(findNode(remote.tree, 'a-device'));
      const localTree = createTree([
        { id: 'local-bookmark', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
      ]);
      localTree[0].children[1].children.push({
        id: 'local-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
          { id: 'z-device', parentId: 'local-root', title: 'BMN1|D|z-device', children: [] }
        ]
      });
      const local = createHarness(localTree, {
        bmTags: { 'local-bookmark': ['本机标签'] },
        bmFixedTags: ['本机配置'],
        bmTagRules: { domain: { local: ['本机配置'] }, keyword: {} },
        bmNativeTagSyncState: { deviceId: 'z-device' }
      });
      globalThis.chrome = local.chrome;
      new Function(backgroundCode)();

      await local.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(local.localData.bmNativeTagSyncRecords['openai.com/research']).toMatchObject({
        revision: [1, 0, 'candidate'], provisional: true
      });

      syncRoot(local.tree).children.push(delayedRemoteDevice);
      await local.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(local.localData.bmTags).toEqual({
        'local-bookmark': ['本机标签', '远端标签']
      });
      expect(local.localData.bmFixedTags).toEqual(['本机配置', '远端配置']);
      expect(local.localData.bmTagRules).toEqual({
        domain: { local: ['本机配置'], openai: ['远端配置'] }, keyword: {}
      });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('已启用但同步目录只剩空设备时会立即写入 presence 提交', async () => {
    const tree = createTree([]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] },
        { id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seeded: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true }))
        .resolves.toMatchObject({ ok: true, changed: true });
      const device = findNode(source.tree, 'local-device');
      expect(device.children.some(node => node.title.startsWith('BMN1|H|presence|'))).toBe(true);
      expect(device.children.some(node => node.title.startsWith('BMN1|S|presence|'))).toBe(true);
      expect(source.localData.bmNativeTagSyncState).toMatchObject({
        presence: true,
        presenceDeviceIds: ['local-device', 'remote-device']
      });
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('设置闹钟会读取当前开关并初始化空同步目录', async () => {
    const tree = createTree([]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seeded: true },
      bmTagSyncStatus: { lastError: '', pending: true, target: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      source.emitAlarm('bm-native-sync-setting');
      await vi.waitFor(() => {
        const device = findNode(source.tree, 'local-device');
        expect(device.children.some(node => node.title.startsWith('BMN1|H|presence|'))).toBe(true);
      });
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('设置请求写入存储后会立即初始化同步目录，不依赖闹钟触发', async () => {
    const source = createHarness(createTree([]), { bmTags: {} });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: true,
        bmNativeTagSyncRequest: { id: 'storage-request', target: true, at: 1 },
        bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'storage-request' }
      });
      await vi.waitFor(() => expect(syncRoot(source.tree)).toBeTruthy());
      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncCompletedRequest).toBe('storage-request'));
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '', lastSuccessAt: expect.any(Number) });
      expect(source.localSet).toHaveBeenCalledWith(expect.objectContaining({
        bmTagSyncStatus: expect.objectContaining({ phase: 'creating-directory', step: 3, totalSteps: 5 })
      }));
      expect(source.chrome.alarms.create).toHaveBeenCalledWith(
        'bm-native-sync-setting-storage-request',
        expect.objectContaining({ when: expect.any(Number), periodInMinutes: 0.5 })
      );
      expect(source.chrome.alarms.clear).toHaveBeenCalledWith('bm-native-sync-setting-storage-request');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('无等待唤醒消息会在书签读取完成前确认接收', async () => {
    let resolveTree;
    const source = createHarness(createTree([]), { bmTags: {} });
    source.chrome.bookmarks.getTree.mockImplementationOnce(() => new Promise(resolve => {
      resolveTree = resolve;
    }));
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: true,
        bmNativeTagSyncRequest: { id: 'wake-request', target: true, at: 1 },
        bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'wake-request' }
      });
      await vi.waitFor(() => expect(resolveTree).toEqual(expect.any(Function)));

      await expect(source.send({ type: 'bmNativeTagSync', action: 'wakePendingSetting' }))
        .resolves.toEqual({ ok: true, accepted: true });
      resolveTree(clone(source.tree));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('Service Worker 重载后会补跑未触发的同步设置闹钟', async () => {
    const tree = createTree([]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seeded: true },
      bmTagSyncStatus: { lastError: '', pending: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      // 模拟 alarm 唤醒一个带 pending 的新 Service Worker：启动恢复和闹钟只能执行一次。
      source.emitAlarm('bm-native-sync-setting');
      await vi.waitFor(() => {
        const device = findNode(source.tree, 'local-device');
        expect(device.children.some(node => node.title.startsWith('BMN1|H|presence|'))).toBe(true);
        expect(device.children.some(node => node.title.startsWith('BMN1|S|presence|'))).toBe(true);
      });
      await settle();
      expect(source.chrome.bookmarks.getTree).toHaveBeenCalledTimes(4);
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '', lastSuccessAt: expect.any(Number) });
      expect(source.localData.bmTagSyncStatus).not.toHaveProperty('pending');
      expect(source.chrome.alarms.clear).toHaveBeenCalledWith('bm-native-sync-setting-legacy--on');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('开启任务执行中切换关闭时不会覆盖最新设置', async () => {
    let resolveInitialTree;
    const source = createHarness(createTree([]), {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'enable-request' }
    });
    source.chrome.bookmarks.getTree.mockImplementationOnce(() => new Promise(resolve => {
      resolveInitialTree = resolve;
    }));
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(resolveInitialTree).toEqual(expect.any(Function)));
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: false,
        bmTagSyncStatus: { lastError: '', pending: true, target: false, requestId: 'disable-request' }
      });
      source.emitAlarm('bm-native-sync-setting');
      resolveInitialTree(clone(source.tree));

      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', disabled: true
      }));
      expect(source.localData.bmNativeTagSyncEnabled).toBe(false);
      expect(syncRoot(source.tree)).toBeUndefined();
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('用户在本机种子读取期间关闭同步时不会留下待发布缓存', async () => {
    let releaseLocalTags;
    const tree = createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: { source: ['本机标签'] },
      bmFixedTags: ['本机标签'],
      bmTagRules: { domain: {}, keyword: {} },
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'enable-request', target: true, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'enable-request' }
    });
    const originalGet = source.chrome.storage.local.get.getMockImplementation();
    source.chrome.storage.local.get.mockImplementation(async keys => {
      if (keys === 'bmTags' && !releaseLocalTags) {
        await new Promise(resolve => { releaseLocalTags = resolve; });
      }
      return originalGet(keys);
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(releaseLocalTags).toEqual(expect.any(Function)));
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: false,
        bmNativeTagSyncRequest: { id: 'disable-request', target: false, at: 2 },
        bmTagSyncStatus: { lastError: '', pending: true, target: false, requestId: 'disable-request' }
      });
      releaseLocalTags();

      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', disabled: true
      }));
      expect(source.localData.bmNativeTagSyncEnabled).toBe(false);
      expect(source.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(syncRoot(source.tree).children.every(device => !device.children.length)).toBe(true);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('用户在本机种子已落盘但发布前关闭同步时会清理候选缓存', async () => {
    let releaseWritingProgress;
    const tree = createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: { source: ['本机标签'] },
      bmFixedTags: ['本机标签'],
      bmTagRules: { domain: {}, keyword: {} },
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'enable-request', target: true, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'enable-request' }
    });
    const originalSet = source.chrome.storage.local.set.getMockImplementation();
    source.chrome.storage.local.set.mockImplementation(async values => {
      if (values.bmTagSyncStatus && values.bmTagSyncStatus.phase === 'writing-sync-data' &&
        !releaseWritingProgress) {
        await new Promise(resolve => { releaseWritingProgress = resolve; });
      }
      return originalSet(values);
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(releaseWritingProgress).toEqual(expect.any(Function)));
      expect(source.localData.bmNativeTagSyncRecords).toHaveProperty('openai.com/research');
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: false,
        bmNativeTagSyncRequest: { id: 'disable-request', target: false, at: 2 },
        bmTagSyncStatus: { lastError: '', pending: true, target: false, requestId: 'disable-request' }
      });
      releaseWritingProgress();

      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', disabled: true
      }));
      expect(source.localData.bmNativeTagSyncEnabled).toBe(false);
      expect(source.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(source.localData.bmNativeTagSyncConfig).toBeUndefined();
      expect(syncRoot(source.tree).children.every(device => !device.children.length)).toBe(true);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('旧任务晚写状态时仍会执行新的持久化请求', async () => {
    let releaseOldStatusWrite;
    const source = createHarness(createTree([]), {
      bmTags: {},
      bmNativeTagSyncEnabled: false,
      bmNativeTagSyncRequest: { id: 'close-request', target: false, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: false, requestId: 'close-request' }
    });
    const writeLocal = source.chrome.storage.local.set.getMockImplementation();
    source.chrome.storage.local.set.mockImplementation(async values => {
      const status = values.bmTagSyncStatus;
      if (status && status.disabled && status.requestId === 'close-request') {
        await new Promise(resolve => { releaseOldStatusWrite = resolve; });
      }
      return writeLocal(values);
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(releaseOldStatusWrite).toEqual(expect.any(Function)));
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: true,
        bmNativeTagSyncRequest: { id: 'enable-request', target: true, at: 2 },
        bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'enable-request' }
      });
      source.emitAlarm('bm-native-sync-setting');
      releaseOldStatusWrite();

      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncCompletedRequest)
        .toBe('enable-request'));
      expect(source.localData.bmNativeTagSyncEnabled).toBe(true);
      expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', requestId: 'enable-request', lastSuccessAt: expect.any(Number)
      });
      const root = syncRoot(source.tree);
      expect(root).toBeDefined();
      expect(root.children[0].children.some(node => node.title.startsWith('BMN1|H|'))).toBe(true);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('新请求写入时会立即清理被替换请求的周期闹钟', async () => {
    let releaseOldRead;
    const source = createHarness(createTree([]), {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'old-request', target: true, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'old-request' }
    });
    source.chrome.bookmarks.getTree.mockImplementationOnce(() => new Promise(resolve => {
      releaseOldRead = () => resolve(clone(source.tree));
    }));
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(releaseOldRead).toEqual(expect.any(Function)));
      await source.chrome.storage.local.set({
        bmNativeTagSyncEnabled: true,
        bmNativeTagSyncRequest: { id: 'new-request', target: true, at: 2 },
        bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'new-request' }
      });
      await vi.waitFor(() => expect(source.chrome.alarms.clear)
        .toHaveBeenCalledWith('bm-native-sync-setting-old-request'));
      expect(source.chrome.alarms.clear).not.toHaveBeenCalledWith('bm-native-sync-setting-new-request');
      releaseOldRead();
      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncCompletedRequest).toBe('new-request'));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('持久化请求失败时保留未完成标记并安排重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createHarness(createTree([]), {
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'failed-request', target: true, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'failed-request' }
    });
    source.chrome.bookmarks.getTree.mockRejectedValue(new Error('书签 API 暂不可用'));
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus).toMatchObject({
        lastError: '书签 API 暂不可用', requestId: 'failed-request'
      }));
      expect(source.localData.bmNativeTagSyncCompletedRequest).toBeUndefined();
      expect(source.chrome.alarms.create).toHaveBeenCalledWith(
        'bm-native-sync-setting-failed-request',
        { when: expect.any(Number), periodInMinutes: 0.5 }
      );
    } finally {
      warn.mockRestore();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('旧请求的周期闹钟触发时会自行清理，不会持续唤醒后台', async () => {
    const source = createHarness(createTree([]), {
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'completed-request', target: true, at: 1 },
      bmNativeTagSyncCompletedRequest: 'completed-request',
      bmTagSyncStatus: { lastError: '', lastSuccessAt: 1 }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      source.emitAlarm('bm-native-sync-setting-stale-request');
      await vi.waitFor(() => expect(source.chrome.alarms.clear)
        .toHaveBeenCalledWith('bm-native-sync-setting-stale-request'));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('同步目录未完整时保留请求，供重启后的 Service Worker 继续恢复', async () => {
    const tree = createTree([]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [{
        id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [{
          id: 'bad-head', parentId: 'remote-device', title: 'BMN1|H|broken'
        }]
      }]
    });
    const source = createHarness(tree, {
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncRequest: { id: 'retry-request', target: true, at: 1 },
      bmTagSyncStatus: { lastError: '', pending: true, target: true, requestId: 'retry-request' }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus.lastError).toMatch(/同步节点格式无效/));
      expect(source.localData.bmNativeTagSyncCompletedRequest).toBeUndefined();
      expect(source.chrome.alarms.create).toHaveBeenCalledWith(
        'bm-native-sync-setting-retry-request',
        { when: expect.any(Number), periodInMinutes: 0.5 }
      );
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('关闭同步会写入关闭状态，而非伪造同步成功', async () => {
    const source = createHarness(createTree([]), {
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seeded: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await expect(source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: false }))
        .resolves.toMatchObject({ ok: true, changed: false });
      expect(source.localData.bmTagSyncStatus).toEqual(expect.objectContaining({
        lastError: '', disabled: true, at: expect.any(Number)
      }));
      expect(source.localData.bmTagSyncStatus).not.toHaveProperty('lastSuccessAt');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('最终恢复会为丢失缓存的空设备目录写入 presence 提交', async () => {
    const tree = createTree([]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [
        { id: 'local-device', parentId: 'sync-root', title: 'BMN1|D|local-device', children: [] },
        { id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [] }
      ]
    });
    const source = createHarness(tree, {
      bmTags: {},
      bmNativeTagSyncEnabled: true,
      bmNativeTagSyncState: { deviceId: 'local-device', seeded: true }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      source.emitAlarm('bm-native-sync-hydration');
      await vi.waitFor(() => {
        const device = findNode(source.tree, 'local-device');
        expect(device.children.some(node => node.title.startsWith('BMN1|H|presence|'))).toBe(true);
        expect(device.children.some(node => node.title.startsWith('BMN1|S|presence|'))).toBe(true);
      });
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('卸载重装后保留旧空目录时，明确启用会立即写入本机标签', async () => {
    vi.useFakeTimers();
    const previous = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['旧标签'] }, bmFixedTags: ['旧标签'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = previous.chrome;
    new Function(backgroundCode)();

    try {
      await previous.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      syncRoot(previous.tree).children.forEach(device => { device.children = []; });

      const reinstalled = createHarness(clone(previous.tree), {
        bmTags: { restored: ['已恢复'] },
        bmFixedTags: ['已恢复'],
        bmTagRules: { domain: {}, keyword: {} }
      });
      reinstalled.tree[0].children[0].children = [{
        id: 'restored', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = reinstalled.chrome;
      new Function(backgroundCode)();

      reinstalled.emitInstalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(reinstalled.localData.bmNativeTagSyncEnabled).toBeUndefined();
      expect(reinstalled.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', waitingForData: true, waitingDeviceCount: 1
      });

      await reinstalled.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(reinstalled.localData.bmNativeTagSyncRecords).toHaveProperty('openai.com/research');
      expect(reinstalled.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['已恢复']);
      expect(reinstalled.localData.bmNativeTagSyncState.seeded).toBe(true);
      expect(reinstalled.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
      const published = syncRoot(reinstalled.tree).children.find(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|'))
      );
      expect(published).toBeTruthy();
      expect(published.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('明确启用且本机没有标签时会建立 presence，迟到远端配置仍可接管', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['远端'] }, bmFixedTags: ['远端'],
      bmTagRules: { domain: { openai: ['远端'] }, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: [],
        bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const remoteDevice = syncRoot(target.tree).children[0];
      const remoteChildren = clone(remoteDevice.children);
      remoteDevice.children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(target.localData.bmTags).toEqual({});
      expect(syncRoot(target.tree).children).toHaveLength(2);
      expect(target.localData.bmNativeTagSyncRecords).toEqual({});
      expect(target.localData.bmNativeTagSyncState.seeded).toBe(true);
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
      expect(syncRoot(target.tree).children.some(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|presence|'))
      )).toBe(true);

      const presenceDevice = syncRoot(target.tree).children.find(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|presence|'))
      );
      expect(target.localData.bmNativeTagSyncState.presenceDeviceIds).toEqual([remoteDevice.title.split('|')[2]]);
      await target.triggerBookmarkCreated(presenceDevice.id, presenceDevice);
      await vi.advanceTimersByTimeAsync(800);
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });

      remoteDevice.children = remoteChildren;
      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTags).toEqual({ target: ['远端'] });
      expect(target.localData.bmFixedTags).toEqual(['远端']);
      expect(target.localData.bmTagRules).toEqual({ domain: { openai: ['远端'] }, keyword: {} });
      expect(target.localData.bmNativeTagSyncState).toMatchObject({ presence: false, presenceDeviceIds: [] });

      syncRoot(target.tree).children.push({
        id: 'late-device', parentId: syncRoot(target.tree).id,
        title: 'BMN1|D|late-device', children: []
      });
      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTagSyncStatus).toMatchObject({
        lastError: '', waitingForData: true, waitingDeviceCount: 1
      });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('presence 节点丢失后会在最终恢复中重新建立', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['远端'] }, bmFixedTags: ['远端'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const remoteDevice = syncRoot(target.tree).children[0];
      remoteDevice.children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      syncRoot(target.tree).children = [remoteDevice];
      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      await vi.runAllTimersAsync();
      target.emitAlarm('bm-native-sync-hydration');

      await vi.waitFor(() => expect(syncRoot(target.tree).children.some(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|presence|'))
      )).toBe(true));
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('presence 节点丢失后关闭再开启会立即重新建立', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['远端'] }, bmFixedTags: ['远端'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const remoteDevice = syncRoot(target.tree).children[0];
      remoteDevice.children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      syncRoot(target.tree).children = [remoteDevice];
      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: false });
      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

      expect(syncRoot(target.tree).children.some(device =>
        device.children.some(node => node.title.startsWith('BMN1|H|presence|'))
      )).toBe(true);
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('明确启用但远端分片损坏时，不会用本机恢复标签覆盖远端', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['远端'] }, bmFixedTags: ['远端'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机恢复'] },
        bmFixedTags: ['本机恢复'],
        bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const remoteDevice = syncRoot(target.tree).children[0];
      remoteDevice.children = remoteDevice.children.filter(node => !node.title.startsWith('BMN1|S|'));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      await vi.runAllTimersAsync();
      target.emitAlarm('bm-native-sync-hydration');

      await vi.waitFor(() => expect(target.localData.bmTagSyncStatus.lastError).toMatch(/分片/));
      expect(target.localData.bmTags).toEqual({ target: ['本机恢复'] });
      expect(target.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(target.localData.bmNativeTagSyncState.seedAfterIncomplete).toBe(true);
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/分片/);
      expect(syncRoot(target.tree).children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('远端分片先于提交头到达时，不会被当成空目录立即播种', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['远端'] }, bmFixedTags: ['远端'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机恢复'] },
        bmFixedTags: ['本机恢复'],
        bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      const remoteDevice = syncRoot(target.tree).children[0];
      remoteDevice.children = remoteDevice.children.filter(node => node.title.startsWith('BMN1|S|'));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

      expect(target.localData.bmTags).toEqual({ target: ['本机恢复'] });
      expect(target.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/提交头缺失/);
      expect(syncRoot(target.tree).children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('远端协议节点格式损坏时，不会被当成空目录立即播种', async () => {
    vi.useFakeTimers();
    const tree = createTree([
      { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]);
    tree[0].children[1].children.push({
      id: 'sync-root', parentId: '2', title: '书签管家同步数据（请勿修改）', children: [{
        id: 'remote-device', parentId: 'sync-root', title: 'BMN1|D|remote-device', children: [{
          id: 'bad-head', parentId: 'remote-device', title: 'BMN1|H|broken'
        }]
      }]
    });
    const target = createHarness(tree, {
      bmTags: { target: ['本机恢复'] },
      bmFixedTags: ['本机恢复'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = target.chrome;
    new Function(backgroundCode)();

    try {
      await target.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

      expect(target.localData.bmTags).toEqual({ target: ['本机恢复'] });
      expect(target.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/同步节点格式无效/);
      expect(syncRoot(target.tree).children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('明确关闭再开启时会用本机已有修订修复空根目录', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const revision = clone(source.localData.bmNativeTagSyncRecords['openai.com/research'].revision);
      syncRoot(source.tree).children = [];
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: false });
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

      const device = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|'));
      expect(device.children.some(node => node.title.startsWith('BMN1|H|'))).toBe(true);
      expect(device.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['AI']);
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].revision).toEqual(revision);
      expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('后台定时读取异常后仍会继续下一次重试', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      target.chrome.bookmarks.getTree.mockRejectedValueOnce(new Error('书签 API 暂不可用'));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      target.emitStartup();
      await vi.advanceTimersToNextTimerAsync();
      await vi.waitFor(() => expect(target.chrome.alarms.create).toHaveBeenCalledWith(
        'bm-native-sync-hydration-1', { when: expect.any(Number) }
      ));
      target.emitAlarm('bm-native-sync-hydration');
      await vi.waitFor(() => expect(target.localData.bmTags).toEqual({ target: ['AI'] }));
      expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
    } finally {
      warn.mockRestore();
      log.mockRestore();
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('旧水合完成时不会取消新书签事件安排的读取', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      let resolveTree;
      target.chrome.bookmarks.getTree
        .mockImplementationOnce(() => new Promise(resolve => { resolveTree = resolve; }))
        .mockImplementation(async () => clone(target.tree));
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      const hydration = target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      await vi.waitFor(() => expect(resolveTree).toEqual(expect.any(Function)));
      target.emitBookmarkChanged('target', { title: 'OpenAI' });
      resolveTree(clone(target.tree));
      await hydration;

      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await vi.advanceTimersToNextTimerAsync();
      await vi.waitFor(() => expect(target.chrome.bookmarks.getTree.mock.calls.length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('后台成功发布后会清除旧同步错误', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['AI'] },
      bmFixedTags: ['AI', '工作'],
      bmTagRules: { domain: {}, keyword: {} },
      bmTagSyncStatus: { lastError: '旧错误', at: 1 }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      await source.chrome.storage.local.set({
        bmTagSyncStatus: { lastError: '待清除的发布错误', at: 2 }
      });
      await source.chrome.storage.local.set({ bmTags: { source: ['工作'] } });

      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags)
        .toEqual(['工作']));
      await vi.waitFor(() => expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' }));
      expect(source.localData.bmTagSyncStatus.lastSuccessAt).toEqual(expect.any(Number));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('目录先到但本机状态未启用时，会发布新增书签的默认标签', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), {
      bmTags: { source: ['工作'] },
      bmFixedTags: ['AI', '工作', '代码'],
      bmTagRules: { domain: {}, keyword: {} }
    });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const target = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: ['AI', '工作', '代码'], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      const localBookmark = {
        id: 'target', parentId: '1', title: '仓库', url: 'https://github.com/example/repo'
      };
      target.tree[0].children[0].children.push(localBookmark);
      await target.triggerBookmarkCreated('target', localBookmark);
      await vi.waitFor(() => expect(target.localData.bmNativeTagSyncRecords).toMatchObject({
        'github.com/example/repo': { tags: ['代码'] }
      }));
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('缺失分片时不应用半份数据，也不会覆盖本机标签', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const device = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|'));
      device.children = device.children.filter(node => !node.title.startsWith('BMN1|S|'));

      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['本机'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await expect(target.send({ type: 'bmNativeTagSync', action: 'hydrate' }))
        .resolves.toMatchObject({ ok: true, changed: false });
      expect(target.localData.bmTags).toEqual({ target: ['本机'] });
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/分片/);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('本机删除标签会发布墓碑，防止旧设备标签在新设备复活', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      await source.chrome.storage.local.set({ bmTags: {} });
      await vi.waitFor(() => expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual([]));
      await source.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      const target = createHarness(clone(source.tree), {
        bmTags: { target: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [{
        id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research'
      }];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTags).toEqual({});
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('内部目录被误删后，重新启用会从当前本机标签重建', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      source.tree[0].children[1].children = [];
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: false });
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

      expect(syncRoot(source.tree)).toBeTruthy();
      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['AI']);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('明确关闭同步后，书签事件不会把开关静默重新打开', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      expect(syncRoot(source.tree)).toBeTruthy();
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: false });
      expect(source.localData.bmNativeTagSyncEnabled).toBe(false);
      const recordsBefore = clone(source.localData.bmNativeTagSyncRecords);

      // 关闭后目录仍保留，但任何书签事件都不应重新开启同步
      source.emitBookmarkChanged('source', { title: 'OpenAI' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(source.localData.bmNativeTagSyncEnabled).toBe(false);

      // 关闭期间本地标签变更只落本地，不写入同步记录
      await source.send({ type: 'bmTagMutation', changes: { source: ['工具'] }, mode: 'overwrite' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(source.localData.bmTags).toEqual({ source: ['工具'] });
      expect(clone(source.localData.bmNativeTagSyncRecords)).toEqual(recordsBefore);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('内容未变化的桶重复发布时不会重建分片', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const deviceFolder = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|'));
      const childrenBefore = clone(deviceFolder.children);
      const createCallsBefore = source.chrome.bookmarks.create.mock.calls.length;

      await source.send({ type: 'bmNativeTagSync', action: 'publish', includeConfig: true });

      expect(source.chrome.bookmarks.create.mock.calls.length).toBe(createCallsBefore);
      expect(syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|')).children)
        .toEqual(childrenBefore);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('书签地址修改后的明确标签更新会迁移标签，并为旧地址发布墓碑', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/old' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const oldUrl = 'https://openai.com/old';
      const newUrl = 'https://openai.com/new';
      await source.chrome.bookmarks.update('source', { url: newUrl });
      source.emitBookmarkChanged('source', { url: 'https://openai.com/new' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(source.localData.bmNativeTagSyncRecords).toMatchObject({
        'openai.com/old': { tags: ['AI'] }
      });
      expect(source.localData.bmNativeTagSyncRecords['openai.com/new']).toBeUndefined();
      expect(source.localData.bmNativeTagSyncUrls.source).toBe('openai.com/old');

      await expect(source.send({
        type: 'bmNativeTagSync', action: 'migrateUrl', id: 'source', oldUrl, newUrl
      })).resolves.toMatchObject({ ok: true, changed: true });
      await source.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(source.localData.bmNativeTagSyncRecords).toMatchObject({
        'openai.com/old': { tags: [] },
        'openai.com/new': { tags: ['AI'] }
      });
      expect(source.localData.bmNativeTagSyncUrls.source).toBe('openai.com/new');

      const target = createHarness(clone(source.tree), {
        bmTags: { old: ['陈旧'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [
        { id: 'old', parentId: '1', title: '旧地址', url: 'https://openai.com/old' },
        { id: 'new', parentId: '1', title: '新地址', url: 'https://openai.com/new' }
      ];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTags).toEqual({ new: ['AI'] });
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('远端书签 URL 先到时不会发布本机空标签记录', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/old' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const sourceDeviceTitle = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|')).title;
      const target = createHarness(clone(source.tree), {
        bmTags: {},
        bmFixedTags: [],
        bmTagRules: { domain: {}, keyword: {} },
        bmNativeTagSyncEnabled: true,
        bmNativeTagSyncState: { deviceId: 'target-device', clock: 0, sequence: 0, seeded: false },
        bmNativeTagSyncUrls: { target: 'openai.com/old' }
      });
      target.tree[0].children[0].children = [
        { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/old' }
      ];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.chrome.bookmarks.update('target', { url: 'https://openai.com/new' });
      target.emitBookmarkChanged('target', { url: 'https://openai.com/new' });
      await vi.advanceTimersByTimeAsync(1000);

      expect(target.localData.bmNativeTagSyncRecords).toBeUndefined();
      expect(target.localData.bmNativeTagSyncUrls.target).toBe('openai.com/old');
      expect(syncRoot(target.tree).children.filter(node => node.title.startsWith('BMN1|D|')).map(node => node.title))
        .toEqual([sourceDeviceTitle]);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('仅接受当前 URL 已更新的扩展内迁移请求', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/old' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      await expect(source.send({
        type: 'bmNativeTagSync', action: 'migrateUrl', id: 'source',
        oldUrl: 'https://openai.com/old', newUrl: 'https://openai.com/new'
      })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/尚未更新/) });
      expect(source.localData.bmNativeTagSyncRecords['openai.com/new']).toBeUndefined();
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('存在损坏分片时不会用可读旧记录部分覆盖本机标签', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['旧标签'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const sourceDeviceTitle = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|')).title;
      const newer = createHarness(clone(source.tree), {
        bmTags: {}, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      globalThis.chrome = newer.chrome;
      new Function(backgroundCode)();

      await newer.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      await newer.chrome.storage.local.set({ bmTags: { source: ['新标签'] } });
      await newer.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      const newerDevice = syncRoot(newer.tree).children.find(node =>
        node.title.startsWith('BMN1|D|') && node.title !== sourceDeviceTitle
      );
      expect(newer.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual(['新标签']);
      expect(newerDevice.children.some(node => node.title.startsWith('BMN1|H|'))).toBe(true);
      expect(newerDevice.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(true);
      newerDevice.children = newerDevice.children.filter(node => !node.title.startsWith('BMN1|S|'));
      expect(newerDevice.children.some(node => node.title.startsWith('BMN1|S|'))).toBe(false);

      const target = createHarness(clone(newer.tree), {
        bmTags: { target: ['本机'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} }
      });
      target.tree[0].children[0].children = [
        { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
      ];
      globalThis.chrome = target.chrome;
      new Function(backgroundCode)();

      await target.send({ type: 'bmNativeTagSync', action: 'hydrate' });
      expect(target.localData.bmTags).toEqual({ target: ['本机'] });
      expect(target.localData.bmTagSyncStatus.lastError).toMatch(/分片/);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('删除包含书签的文件夹会为其中地址发布墓碑', async () => {
    vi.useFakeTimers();
    const source = createHarness(createTree([{
      id: 'folder', parentId: '1', title: '待删除', children: [
        { id: 'source', parentId: 'folder', title: 'OpenAI', url: 'https://openai.com/research' }
      ]
    }]), { bmTags: { source: ['AI'] }, bmFixedTags: [], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const removed = clone(findNode(source.tree, 'folder'));
      await source.chrome.bookmarks.remove('folder');
      source.emitBookmarkRemoved('folder', removed);
      await vi.advanceTimersByTimeAsync(1000);
      await source.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(source.localData.bmNativeTagSyncRecords['openai.com/research'].tags).toEqual([]);
    } finally {
      vi.useRealTimers();
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('配置变更只写配置分桶，不重写标签分桶', async () => {
    const source = createHarness(createTree([
      { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
    ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
    globalThis.chrome = source.chrome;
    new Function(backgroundCode)();

    try {
      await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });
      const device = syncRoot(source.tree).children.find(node => node.title.startsWith('BMN1|D|'));
      const tagHead = () => device.children.find(node =>
        node.title.startsWith('BMN1|H|') && !node.title.startsWith('BMN1|H|config|')
      );
      const configHead = () => device.children.find(node => node.title.startsWith('BMN1|H|config|'));
      const beforeTagHead = tagHead().title;
      const beforeConfigHead = configHead().title;

      await source.chrome.storage.local.set({ bmFixedTags: ['AI', '工作'] });
      await source.send({ type: 'bmNativeTagSync', action: 'hydrate' });

      expect(tagHead().title).toBe(beforeTagHead);
      expect(configHead().title).not.toBe(beforeConfigHead);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});
