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
