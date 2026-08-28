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

describe('备份恢复创建保护', () => {
  it('导入 V2 域名分组时保留现有关键字规则', async () => {
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
      await globalThis.BM.importBookmarksJSON(JSON.stringify({
        app: 'bookmark-manager', version: 2, bookmarks: [], domainGroups: { legacy: '代码' }
      }));
      expect(store.bmTagRules).toEqual({ domain: { legacy: ['代码'] }, keyword: { release: ['资讯'] } });
      expect(store.bmDomainGroupsMigrated).toBe(true);
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('导入 V3 统一规则时恢复域名和关键字规则', async () => {
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
      await globalThis.BM.importBookmarksJSON(JSON.stringify({
        app: 'bookmark-manager', version: 3, bookmarks: [],
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [{ title: '', children: [{ title: '书签栏', children: [
          { id: 'backup-bookmark', title: '备份书签', url: 'https://example.com/' }
        ] }] }],
        fixedTags: ['AI', '工具', '项目A', '其他'],
        tags: { 'backup-bookmark': ['项目A'] },
        hiddenIds: ['backup-bookmark']
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [{ title: '', children: [{ title: '书签栏', children: [
          { id: 'first', title: '第一个', url: 'https://example.com/' },
          { id: 'second', title: '第二个', url: 'https://example.com/' }
        ] }] }],
        tags: { first: ['AI'], second: ['前端'] }
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

  it('仅含可合并书签的来源目录不会创建为空文件夹', async () => {
    const previousChrome = globalThis.chrome;
    const create = vi.fn();
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [{ title: '', children: [{ title: '书签栏', children: [{
          id: 'import-folder', title: '导入目录', children: [
            { id: 'backup-bookmark', title: '备份书签', url: 'https://example.com/' }
          ]
        }] }] }]
      });

      await expect(globalThis.BM.importBookmarksJSON(backup, { dryRun: true }))
        .resolves.toMatchObject({ folders: 0, bookmarks: 0, merged: 1 });
      await expect(globalThis.BM.importBookmarksJSON(backup))
        .resolves.toMatchObject({ folders: 0, bookmarks: 0, merged: 1 });
      expect(create).not.toHaveBeenCalled();
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [
          {
            title: '',
            children: [
              {
                title: '书签栏',
                children: [{ id: 'old-bookmark', title: '示例', url: 'https://example.com/' }]
              }
            ]
          }
        ]
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [
          {
            title: '',
            children: [
              {
                title: '书签栏',
                children: [
                  {
                    id: 'old-work',
                    title: '工作',
                    children: [{ id: 'old-bookmark', title: '示例', url: 'https://example.com/' }]
                  }
                ]
              }
            ]
          }
        ]
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
      const backup = JSON.stringify({
        app: 'bookmark-manager',
        bookmarks: [{
          title: '',
          children: [{
            title: '书签栏',
            children: [
              { title: '正常', url: 'https://example.com/' },
              { title: '不安全', url: 'javascript:alert(1)' }
            ]
          }]
        }]
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
