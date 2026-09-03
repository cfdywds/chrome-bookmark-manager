import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libCode = readFileSync(join(__dirname, '..', 'js', 'lib.js'), 'utf-8');
const backgroundCode = readFileSync(join(__dirname, '..', 'js', 'background.js'), 'utf-8');
const IMPORT_MESSAGE = 'bmBackupImportBookmark';

function restoreChrome(previous) {
  if (previous === undefined) delete globalThis.chrome;
  else globalThis.chrome = previous;
}

function createV4Backup(data) {
  return JSON.stringify({
    app: 'bookmark-manager',
    version: 4,
    exportedAt: 1700000000000,
    roots: [],
    trash: [],
    ...data
  });
}

function backupRoot(id, title, children) {
  return [id, title, children];
}

function backupFolder(id, title, children) {
  return [title, children, id];
}

function backupBookmark(title, url, tags, hidden) {
  const entry = [title, url];
  if ((tags && tags.length) || hidden) {
    entry.push(tags || []);
    if (hidden) entry.push(1);
  }
  return entry;
}

describe('备份恢复创建保护', () => {
  it('忽略误含内部同步目录的备份节点', async () => {
    const previousChrome = globalThis.chrome;
    const store = {};
    const create = vi.fn();
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]),
        create
      },
      storage: {
        local: {
          get: vi.fn(async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
            .filter(key => Object.prototype.hasOwnProperty.call(store, key)).map(key => [key, store[key]]))),
          set: vi.fn(async values => Object.assign(store, values))
        }
      },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [backupFolder('sync', '书签管家同步数据（请勿修改）', [
          backupBookmark('内部数据', 'https://example.com/internal', ['AI'])
        ])])]
      });
      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ folders: 0, bookmarks: 0, skipped: 1 });
      await expect(globalThis.BM.importBookmarksJSON(backup)).resolves.toMatchObject({ skipped: 1 });
      expect(create).not.toHaveBeenCalled();
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('仅接受 V4 紧凑备份', async () => {
    const previousChrome = globalThis.chrome;
    const store = {
      bmTagRules: { domain: { current: ['工作'] }, keyword: { release: ['资讯'] } }
    };
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]) },
      storage: { local: { get, set }, sync: { get: vi.fn().mockResolvedValue({}) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      await expect(globalThis.BM.importBookmarksJSON(JSON.stringify({
        app: 'bookmark-manager', version: 2, bookmarks: [], domainGroups: { legacy: '代码' }
      }))).rejects.toThrow('不是当前版本导出的有效书签管家备份文件');
      expect(store.bmTagRules).toEqual({ domain: { current: ['工作'] }, keyword: { release: ['资讯'] } });
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('导入 V4 统一规则时恢复域名和关键字规则', async () => {
    const previousChrome = globalThis.chrome;
    const store = { bmTagRules: { domain: { current: ['工作'] }, keyword: {} } };
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]) },
      storage: { local: { get, set }, sync: { get: vi.fn().mockResolvedValue({}) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      await globalThis.BM.importBookmarksJSON(createV4Backup({
        tagRules: { domain: { corp: ['工作', '代码'] }, keyword: { release: ['资讯'] } }
      }));
      expect(store.bmTagRules).toEqual({
        domain: { corp: ['工作', '代码'] }, keyword: { release: ['资讯'] }
      });
      expect(store.bmDomainGroupsMigrated).toBe(true);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('导入显式空标签池时只保留兜底标签的语义', async () => {
    const previousChrome = globalThis.chrome;
    const store = { bmFixedTags: ['旧标签'] };
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]) },
      storage: { local: { get, set }, sync: { get: vi.fn().mockResolvedValue({}) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      await globalThis.BM.importBookmarksJSON(createV4Backup({ fixedTags: [] }));
      expect(store.bmFixedTags).toEqual([]);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('默认合并完整 URL 并合并标签，显式选择后才保留副本', async () => {
    const previousChrome = globalThis.chrome;
    const store = {
      bmFixedTags: ['AI', '工具', '其他'],
      bmTags: { existing: ['工具'] }
    };
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    const create = vi.fn().mockResolvedValue({ id: 'copy' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{
          children: [{
            id: 'bar', title: '书签栏', children: [
              { id: 'existing', title: '已有书签', url: 'https://example.com/' }
            ]
          }]
        }]),
        create
      },
      storage: { local: { get, set } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupBookmark('备份书签', 'https://example.com/', ['项目A'], true)
        ])],
        fixedTags: ['AI', '工具', '项目A', '其他'],
        tagRules: { domain: {}, keyword: {} }
      });

      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ bookmarks: 0, merged: 1, skipped: 0 });
      await expect(globalThis.BM.importBookmarksJSON(backup))
        .resolves.toMatchObject({ bookmarks: 0, merged: 1, skipped: 0 });
      expect(create).not.toHaveBeenCalled();
      expect(store.bmTags.existing).toEqual(['工具', '项目A']);
      expect(store.bmFixedTags).toEqual(['AI', '工具', '项目A', '其他']);
      expect(store.bmHiddenIds).toEqual(['existing']);

      const copied = await globalThis.BM.importBookmarksJSON(backup, { keepDuplicates: true });
      expect(copied).toMatchObject({ bookmarks: 1, merged: 0, skipped: 0 });
      expect(create).toHaveBeenCalledWith({
        parentId: 'bar', title: '备份书签', url: 'https://example.com/'
      });
      expect(store.bmTags.copy).toEqual(['项目A']);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('同一备份内的相同 URL 只创建一次并汇总标签', async () => {
    const previousChrome = globalThis.chrome;
    const store = {};
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    const create = vi.fn().mockResolvedValue({ id: 'new-bookmark' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]),
        create
      },
      storage: { local: { get, set } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupBookmark('第一个', 'https://example.com/', ['AI']),
          backupBookmark('第二个', 'https://example.com/', ['前端'])
        ])]
      });

      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ bookmarks: 1, merged: 1 });
      await expect(globalThis.BM.importBookmarksJSON(backup))
        .resolves.toMatchObject({ bookmarks: 1, merged: 1 });
      expect(create).toHaveBeenCalledTimes(1);
      expect(store.bmTags['new-bookmark']).toEqual(['AI', '前端']);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('保留仅含可合并书签的来源目录', async () => {
    const previousChrome = globalThis.chrome;
    const create = vi.fn().mockResolvedValue({ id: 'import-folder' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{
          children: [{
            id: 'bar', title: '书签栏', children: [
              { id: 'existing', title: '已有书签', url: 'https://example.com/' }
            ]
          }]
        }]),
        create
      },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupFolder('source-folder', '导入目录', [
            backupBookmark('备份书签', 'https://example.com/')
          ])
        ])]
      });

      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ folders: 1, bookmarks: 0, merged: 1 });
      await expect(globalThis.BM.importBookmarksJSON(backup))
        .resolves.toMatchObject({ folders: 1, bookmarks: 0, merged: 1 });
      expect(create).toHaveBeenCalledWith({ parentId: 'bar', title: '导入目录' });
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('恢复为创建登记并确认令牌，失败时取消，dry run 不发送消息', async () => {
    const previousChrome = globalThis.chrome;
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 'new-bookmark' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏' }] }]),
        search: vi.fn().mockResolvedValue([]),
        create
      },
      storage: {
        local: { get: vi.fn(), set: vi.fn() }
      },
      runtime: { sendMessage }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupBookmark('示例', 'https://example.com/')
        ])]
      });

      const stats = await globalThis.BM.importBookmarksJSON(backup);

      expect(stats.bookmarks).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenNthCalledWith(1, {
        type: IMPORT_MESSAGE,
        action: 'reserve',
        parentId: 'bar',
        url: 'https://example.com/'
      });
      expect(sendMessage).toHaveBeenNthCalledWith(2, {
        type: IMPORT_MESSAGE,
        action: 'confirm',
        parentId: 'bar',
        url: 'https://example.com/',
        bookmarkId: 'new-bookmark'
      });

      sendMessage.mockClear();
      create.mockClear();
      const preview = await globalThis.BM.importBookmarksJSON(backup, { dryRun: true });
      expect(preview.bookmarks).toBe(1);
      expect(create).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();

      create.mockRejectedValueOnce(new Error('创建失败'));
      const failed = await globalThis.BM.importBookmarksJSON(backup);
      expect(failed.skipped).toBe(1);
      expect(sendMessage).toHaveBeenNthCalledWith(1, {
        type: IMPORT_MESSAGE,
        action: 'reserve',
        parentId: 'bar',
        url: 'https://example.com/'
      });
      expect(sendMessage).toHaveBeenNthCalledWith(2, {
        type: IMPORT_MESSAGE,
        action: 'cancel',
        parentId: 'bar',
        url: 'https://example.com/'
      });
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('从书签栏索引复用顶级文件夹，不为每个文件夹搜索整棵树', async () => {
    const previousChrome = globalThis.chrome;
    const search = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 'new-bookmark' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([
          {
            children: [
              {
                id: 'bar',
                title: '书签栏',
                children: [{ id: 'work', title: '工作' }]
              }
            ]
          }
        ]),
        search,
        create
      },
      storage: {
        local: { get: vi.fn(), set: vi.fn() }
      }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupFolder('old-work', '工作', [
            backupBookmark('示例', 'https://example.com/')
          ])
        ])]
      });

      const stats = await globalThis.BM.importBookmarksJSON(backup);

      expect(stats.reused).toBe(1);
      expect(create).toHaveBeenCalledWith({
        parentId: 'work',
        title: '示例',
        url: 'https://example.com/'
      });
      expect(search).not.toHaveBeenCalled();
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('预览与导入都会跳过非 HTTP(S) 书签', async () => {
    const previousChrome = globalThis.chrome;
    const create = vi.fn().mockResolvedValue({ id: 'new-bookmark' });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏' }] }]),
        create
      },
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      runtime: { sendMessage: vi.fn() }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [backupRoot('bar', '书签栏', [
          backupBookmark('正常', 'https://example.com/'),
          backupBookmark('不安全', 'javascript:alert(1)')
        ])]
      });

      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ bookmarks: 1, skipped: 1 });
      await expect(globalThis.BM.importBookmarksJSON(backup))
        .resolves.toMatchObject({ bookmarks: 1, skipped: 1 });
      expect(create).toHaveBeenCalledWith({
        parentId: 'bar', title: '正常', url: 'https://example.com/'
      });
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('恢复全部根目录、内联元数据与回收站原文件夹', async () => {
    const previousChrome = globalThis.chrome;
    const store = {};
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    const ids = ['target-folder', 'target-bookmark', 'target-other-bookmark'];
    const create = vi.fn(async () => ({ id: ids.shift() }));
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{
          children: [
            { id: 'target-bar', title: '书签栏', children: [] },
            { id: 'target-other', title: '其他书签', children: [] }
          ]
        }]),
        create
      },
      storage: { local: { get, set } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      const backup = createV4Backup({
        roots: [
          backupRoot('source-bar', '书签栏', [
            backupFolder('source-folder', '项目', [
              backupBookmark('项目主页', 'https://project.example/', ['项目'], true)
            ])
          ]),
          backupRoot('source-other', '其他书签', [
            backupBookmark('归档', 'https://archive.example/', ['归档'])
          ])
        ],
        trash: [[
          'source-trash', '已删除', 'https://deleted.example/', 'source-folder', 1600000000000, ['项目']
        ]],
        fixedTags: ['项目', '归档', '其他'],
        tagRules: { domain: { project: ['项目'] }, keyword: {} }
      });

      await expect(globalThis.BM.importBookmarksJSON(backup)).resolves.toMatchObject({
        folders: 1, bookmarks: 2, merged: 0, skipped: 0
      });
      expect(create).toHaveBeenNthCalledWith(1, { parentId: 'target-bar', title: '项目' });
      expect(create).toHaveBeenNthCalledWith(2, {
        parentId: 'target-folder', title: '项目主页', url: 'https://project.example/'
      });
      expect(create).toHaveBeenNthCalledWith(3, {
        parentId: 'target-other', title: '归档', url: 'https://archive.example/'
      });
      expect(store.bmTags).toEqual({
        'target-bookmark': ['项目'],
        'target-other-bookmark': ['归档']
      });
      expect(store.bmHiddenIds).toEqual(['target-bookmark']);
      expect(store.bmTrash).toEqual([{
        id: 'backup:1700000000000:source-trash',
        title: '已删除',
        url: 'https://deleted.example/',
        parentId: 'target-folder',
        deletedAt: 1600000000000,
        path: ['项目']
      }]);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('回收站记录使用稳定 ID 去重，并跳过非 HTTP(S) URL', async () => {
    const previousChrome = globalThis.chrome;
    const store = {};
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    globalThis.chrome = {
      bookmarks: { getTree: vi.fn().mockResolvedValue([{ children: [{ id: 'bar', title: '书签栏', children: [] }] }]) },
      storage: { local: { get, set } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      const trash = [['backup:origin:deleted', '已删除', 'https://deleted.example/', '', 1600000000000, []]];
      await globalThis.BM.importBookmarksJSON(createV4Backup({ exportedAt: 1, trash }));
      await globalThis.BM.importBookmarksJSON(createV4Backup({ exportedAt: 2, trash }));
      await globalThis.BM.importBookmarksJSON(createV4Backup({
        exportedAt: 3,
        trash: [['unsafe', '不安全', 'javascript:alert(1)', '', 1600000000000, []]]
      }));

      expect(store.bmTrash).toEqual([{
        id: 'backup:origin:deleted',
        title: '已删除',
        url: 'https://deleted.example/',
        parentId: '',
        deletedAt: 1600000000000,
        path: []
      }]);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('回收站满时在创建书签前明确失败，不删除本地记录', async () => {
    const previousChrome = globalThis.chrome;
    const store = {
      bmTrash: Array.from({ length: 5000 }, (_, index) => ({ id: 'current-' + index, url: 'https://current.example/' }))
    };
    const get = vi.fn(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
      });
      return result;
    });
    const set = vi.fn(async values => Object.assign(store, values));
    const getTree = vi.fn();
    globalThis.chrome = {
      bookmarks: { getTree },
      storage: { local: { get, set } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
    };

    try {
      new Function(libCode)();
      await expect(globalThis.BM.importBookmarksJSON(createV4Backup({
        trash: [['new-trash', '待恢复', 'https://new.example/', '', 1600000000000, []]]
      }))).rejects.toThrow('回收站空间不足');
      expect(getTree).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(store.bmTrash).toHaveLength(5000);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('后台仅跳过已确认的恢复创建，同键普通收藏仍会被默认打标', async () => {
    const previousChrome = globalThis.chrome;
    const sessionGet = vi.fn().mockResolvedValue({});
    const localGet = vi.fn().mockResolvedValue({ bmFixedTags: ['其他'], bmTags: {} });
    const localSet = vi.fn().mockResolvedValue(undefined);
    let onCreated;
    const messageListeners = [];
    globalThis.chrome = {
      sidePanel: {
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      bookmarks: {
        onCreated: {
          addListener: listener => {
            onCreated = listener;
          }
        },
        onChanged: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
        onMoved: { addListener: vi.fn() }
      },
      storage: {
        session: { get: sessionGet, set: vi.fn(), remove: vi.fn() },
        local: { get: localGet, set: localSet }
      },
      windows: { getCurrent: vi.fn().mockResolvedValue({ id: 1 }) },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      runtime: {
        onMessage: {
          addListener: listener => {
            messageListeners.push(listener);
          }
        },
        onStartup: { addListener: vi.fn() }
      }
    };

    try {
      new Function(backgroundCode)();
      const dispatchMessage = message => messageListeners.forEach(listener => listener(
        message,
        null,
        vi.fn()
      ));
      dispatchMessage(
        {
          type: IMPORT_MESSAGE,
          action: 'reserve',
          parentId: 'bar',
          url: 'https://example.com/'
        }
      );
      const manualCreation = onCreated('manual-bookmark', {
        parentId: 'bar',
        url: 'https://example.com/',
        title: '手动收藏'
      });
      dispatchMessage(
        {
          type: IMPORT_MESSAGE,
          action: 'confirm',
          parentId: 'bar',
          url: 'https://example.com/',
          bookmarkId: 'new-bookmark'
        }
      );
      await manualCreation;

      expect(localGet).toHaveBeenCalledWith('bmStarHook');
      expect(localSet).toHaveBeenCalledWith({ bmTags: { 'manual-bookmark': ['其他'] } });

      await onCreated('new-bookmark', {
        parentId: 'bar',
        url: 'https://example.com/',
        title: '恢复书签'
      });
      expect(localSet).toHaveBeenCalledOnce();
    } finally {
      restoreChrome(previousChrome);
    }
  });
});
