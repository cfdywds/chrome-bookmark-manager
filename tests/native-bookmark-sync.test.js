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

function createHarness(tree, initialLocal) {
  let nextId = nextBookmarkId(tree);
  const messageListeners = [];
  const storageListeners = [];
  const bookmarkCreatedListeners = [];
  const bookmarkChangedListeners = [];
  const bookmarkRemovedListeners = [];
  const localData = { ...(initialLocal || {}) };
  const localSet = vi.fn(async values => {
    const changes = {};
    Object.entries(values).forEach(([key, value]) => {
      changes[key] = { oldValue: localData[key], newValue: value };
      localData[key] = value;
    });
    storageListeners.forEach(listener => listener(changes, 'local'));
  });
  const chrome = {
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(), open: vi.fn() },
    runtime: {
      onMessage: { addListener: listener => messageListeners.push(listener) },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() }
    },
    bookmarks: {
      getTree: vi.fn(async () => clone(tree)),
      getChildren: vi.fn(async id => clone((findNode(tree, id) || {}).children || [])),
      create: vi.fn(async info => {
        const parent = findNode(tree, info.parentId);
        if (!parent) throw new Error('父目录不存在');
        const node = {
          id: String(nextId++),
          parentId: String(info.parentId),
          title: info.title || ''
        };
        if (info.url) node.url = info.url;
        else node.children = [];
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
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    storage: {
      onChanged: { addListener: listener => storageListeners.push(listener) },
      local: {
        get: vi.fn(async keys => {
          if (typeof keys === 'string') return { [keys]: localData[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, localData[key]]));
          return { ...localData };
        }),
        set: localSet
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
      await new Promise(resolve => setTimeout(resolve, 1200));
      expect(target.localData.bmTags).toEqual({ target: ['工作'] });
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
