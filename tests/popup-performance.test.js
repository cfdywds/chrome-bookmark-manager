import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupSource = readFileSync(join(__dirname, '..', 'js', 'popup.js'), 'utf-8');
const popupHtml = readFileSync(join(__dirname, '..', 'popup.html'), 'utf-8');
const popupCss = readFileSync(join(__dirname, '..', 'css', 'popup.css'), 'utf-8');

function getFunctionSource(name) {
  const functionStart = popupSource.indexOf(`function ${name}(`);
  const start = popupSource.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const endings = [
    { index: popupSource.indexOf('\n}\n', start), length: 2 },
    { index: popupSource.indexOf('\r\n}\r\n', start), length: 3 }
  ].filter(entry => entry.index >= 0).sort((a, b) => a.index - b.index);
  if (start < 0 || !endings.length) throw new Error(`未找到函数 ${name}`);
  const end = endings[0];
  return popupSource.slice(start, end.index + end.length).replace(`function ${name}`, 'function');
}

describe('弹窗大列表渲染', () => {
  it('首次只返回受控数量，并在展开后增加返回项', () => {
    let listRenderLimits = Object.create(null);
    const escapeHtml = value => String(value);
    const takeForRender = eval(`(${getFunctionSource('takeForRender')})`);
    const items = Array.from({ length: 100 }, (_, index) => index);

    expect(takeForRender(items, 'items', 24, 24).items).toHaveLength(24);
    listRenderLimits.items = 48;
    const expanded = takeForRender(items, 'items', 24, 24);
    expect(expanded.items).toHaveLength(48);
    expect(expanded.more).toContain('48/100');
  });
});

describe('侧边栏导航', () => {
  it('只保留概览和标签两个顶级页签', () => {
    const tabs = [...popupHtml.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
    expect(tabs).toEqual(['overview', 'tags']);
  });

  it('标签页仅说明标签数字含义，不重复编码数量', () => {
    expect(popupSource).toContain("helpDot('标签后的数字表示书签数量。')");
    expect(popupSource).not.toContain("pageHint(ICON('tag'), '<b>本页能做什么：</b>按标签浏览书签");
  });
});

describe('操作反馈', () => {
  it('短提示位于底部，长任务状态放在内容区与底栏之间', () => {
    expect(popupCss).toContain('position: fixed; bottom: 68px;');
    expect(popupCss).not.toContain('position: fixed; top: 12px;');
    expect(popupHtml.indexOf('id="operationNotice"')).toBeGreaterThan(popupHtml.indexOf('<main id="content">'));
    expect(popupHtml.indexOf('id="progressWrap"')).toBeLessThan(popupHtml.indexOf('id="bulkBar"'));
    expect(popupCss).not.toContain('position: fixed; top: 0; left: 0; right: 0; z-index: 998;');
  });

  it('AI 任务失败原因固定显示，直到页面重载', () => {
    const fields = {
      '#app': { classList: { add: vi.fn() } },
      '#operationNoticeTitle': { textContent: '' },
      '#operationNoticeDetail': { textContent: '' },
      '#operationNotice': { classList: { remove: vi.fn() } }
    };
    const $ = selector => fields[selector];
    const showPersistentError = eval(`(${getFunctionSource('showPersistentError')})`);

    showPersistentError('AI 打标失败', '网络请求失败');

    expect(fields['#operationNoticeTitle'].textContent).toBe('AI 打标失败');
    expect(fields['#operationNoticeDetail'].textContent).toBe('网络请求失败');
    expect(fields['#operationNotice'].classList.remove).toHaveBeenCalledWith('hidden');
    expect(fields['#app'].classList.add).toHaveBeenCalledWith('has-operation-notice');
    expect(popupSource).toContain('showPersistentError(title, error);');
    expect(popupSource).not.toContain('原因已固定在底部');
    expect(getFunctionSource('showPersistentError')).not.toContain('setTimeout');
  });

  it('AI 任务状态支持独立终止，不覆盖顶部内容', () => {
    let activeProgressCancel = null;
    const fields = {
      '#progressWrap': { classList: { remove: vi.fn(), add: vi.fn() } },
      '#progressBar': { style: {} },
      '#progressLabel': { textContent: '' },
      '#progressCancel': { textContent: '', disabled: false, onclick: null, classList: { remove: vi.fn(), add: vi.fn() } }
    };
    const $ = selector => fields[selector];
    const startProgress = eval(`(${getFunctionSource('startProgress')})`);
    const endProgress = eval(`(${getFunctionSource('endProgress')})`);
    const stop = vi.fn();

    startProgress('AI 打标中', { onCancel: stop });
    fields['#progressCancel'].onclick();

    expect(stop).toHaveBeenCalledOnce();
    expect(fields['#progressCancel'].disabled).toBe(true);
    expect(fields['#progressCancel'].textContent).toBe('终止中…');
    endProgress();
    expect(fields['#progressWrap'].classList.add).toHaveBeenCalledWith('hidden');
  });
});

describe('标签云简化', () => {
  it('只显示标签名和数量，不使用长度条或字号分级重复表达数量', () => {
    expect(popupSource).not.toContain('sizeCls =');
    expect(popupSource).not.toContain("const size = n >= 20 ? ' lg' : n >= 8 ? ' md' : '';");
    expect(popupSource).not.toContain('class="tag-cloud${size}"');
    expect(popupSource).not.toContain('class="bar"');
    expect(popupCss).not.toContain('.tag-cloud .bar');
    expect(popupCss).not.toContain('.tag-cloud.md');
    expect(popupCss).not.toContain('.tag-cloud.lg');
  });
});

describe('侧边栏首屏', () => {
  it('在脚本和书签数据就绪前显示加载态，并以 defer 释放首次绘制', () => {
    expect(popupHtml).toContain('<div class="loading" role="status">正在扫描书签…</div>');
    expect([...popupHtml.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(match => match[1]))
      .toEqual(['js/lib.js', 'js/analyzer.js', 'js/popup.js']);
  });

  it('并行读取设置与首轮扫描，不串行阻塞概览渲染', () => {
    expect(popupSource).toContain('settingsReady = loadSettings();');
    expect(popupSource).toContain('await Promise.all([settingsReady, refresh(true)]);');
  });

  it('在设置读取完成前不会调用新增书签的 AI 打标', async () => {
    let resolveSettings;
    const settingsReady = new Promise(resolve => { resolveSettings = resolve; });
    const SETTINGS = { apiKey: 'key', baseUrl: 'https://api.example.com', model: 'test' };
    const fields = {
      '#addUrl': { value: 'https://example.com/' },
      '#addTitle': { value: '示例' },
      '#addAiTag': { disabled: false, textContent: '🤖 AI 打标' },
      '#addTags': { value: '' }
    };
    const $ = selector => fields[selector];
    const setAddMsg = vi.fn();
    const renderTagSuggest = vi.fn();
    const BM = {
      aiTag: vi.fn().mockResolvedValue({ new: ['测试'] }),
      hasLlmHostPermission: vi.fn().mockResolvedValue(true),
      normalizeHttpUrl: url => ({ href: url }),
      getBookmarkMetadata: () => ({ sensitive: [] })
    };
    const chrome = { runtime: { openOptionsPage: vi.fn() } };
    const aiTagSuggest = eval(`(${getFunctionSource('aiTagSuggest')})`);

    const pending = aiTagSuggest();
    const duplicate = aiTagSuggest();
    expect(BM.aiTag).not.toHaveBeenCalled();
    expect(fields['#addAiTag'].disabled).toBe(true);

    resolveSettings();
    await Promise.all([pending, duplicate]);

    expect(BM.aiTag).toHaveBeenCalledWith(
      [{ id: 'new', title: '示例', url: 'https://example.com/' }], SETTINGS
    );
    expect(BM.aiTag).toHaveBeenCalledOnce();
  });

  it('批量 AI 打标也等待设置读取完成', () => {
    expect(getFunctionSource('aiTagAll')).toContain('await settingsReady;');
  });
});

describe('AI 批量打标', () => {
  it('将仅有“其他”的书签视为待打标，并与页面计数使用同一目标集', () => {
    const BM = { FALLBACK_TAG: '其他' };
    const isAiTagPending = eval(`(${getFunctionSource('isAiTagPending')})`);

    expect(isAiTagPending({ tags: [] })).toBe(true);
    expect(isAiTagPending({ tags: ['其他'] })).toBe(true);
    expect(isAiTagPending({ tags: ['工具'] })).toBe(false);
    expect(getFunctionSource('renderTags')).toContain('const untaggedCount = getAiTagTargets(false).length;');
    expect(getFunctionSource('aiTagAll')).toContain('const targets = getAiTagTargets(force);');
  });

  it('普通打标排除隐藏书签，全量重打才包含它们', () => {
    const BM = { FALLBACK_TAG: '其他' };
    const DATA = {
      items: [
        { id: 'visible-pending', tags: ['其他'] },
        { id: 'hidden-pending', hidden: true, tags: [] },
        { id: 'visible-tagged', tags: ['工具'] }
      ]
    };
    const isAiTagPending = eval(`(${getFunctionSource('isAiTagPending')})`);
    const getAiTagTargets = eval(`(${getFunctionSource('getAiTagTargets')})`);

    expect(getAiTagTargets(false).map(item => item.id)).toEqual(['visible-pending']);
    expect(getAiTagTargets(true).map(item => item.id))
      .toEqual(['visible-pending', 'hidden-pending', 'visible-tagged']);
  });

  it('未完成时不将已打标比例四舍五入为 100%', () => {
    expect(popupSource).toContain('taggedCount === total ? 100 : Math.floor(taggedCount / total * 100)');
  });

  it('终止时按已处理批次计算剩余项，而非仅按已保存标签数', () => {
    expect(popupSource).toContain('let processed = 0;');
    expect(popupSource).toContain('onBatch: async (map, done) => {');
    expect(popupSource).toContain('processed = done;');
    expect(popupSource).toContain('const remain = batch.length - processed;');
  });
});

describe('刷新调度', () => {
  it('合并并发请求，且补扫期间的新请求不会丢失', async () => {
    let refreshInFlight = null;
    let refreshQueued = false;
    const resolvers = [];
    const runRefresh = vi.fn(() => new Promise(resolve => resolvers.push(resolve)));
    const refresh = eval(`(${getFunctionSource('refresh')})`);

    const first = refresh(true);
    const second = refresh(true);

    expect(runRefresh).toHaveBeenCalledTimes(1);
    resolvers.shift()();
    await vi.waitFor(() => expect(runRefresh).toHaveBeenCalledTimes(2));
    const third = refresh(true);
    resolvers.shift()();
    await vi.waitFor(() => expect(runRefresh).toHaveBeenCalledTimes(3));
    resolvers.shift()();
    await Promise.all([first, second, third]);

    expect(runRefresh).toHaveBeenCalledTimes(3);
    expect(refreshInFlight).toBeNull();
    expect(refreshQueued).toBe(false);
  });
});

describe('书签运行时索引', () => {
  it('按完整 URL 直接查找，不重新遍历全部书签', () => {
    const match = { id: '1', url: 'https://example.com/a' };
    const DATA = {
      itemsByUrl: new Map([['https://example.com/a', [match]]]),
      items: Array.from({ length: 500 }, (_, index) => ({ id: String(index) }))
    };
    const findExistingByUrl = eval(`(${getFunctionSource('findExistingByUrl')})`);

    expect(findExistingByUrl('https://example.com/a')).toEqual([match]);
  });

  it('仅完整 URL 一致才触发重复校验', () => {
    const match = { id: 'saved', url: 'https://example.com/team/saved' };
    const DATA = { itemsByUrl: new Map([['https://example.com/team/saved', [match]]]) };
    const findExistingByUrl = eval(`(${getFunctionSource('findExistingByUrl')})`);

    expect(findExistingByUrl('https://example.com/team/new')).toEqual([]);
    expect(findExistingByUrl('http://example.com/team/saved')).toEqual([]);
    expect(findExistingByUrl('https://example.com/team/saved')).toEqual([match]);
    expect(findExistingByUrl('https://example.com/team/saved', 'saved')).toEqual([]);
  });
});

describe('去重后的空文件夹清理', () => {
  it('仅清理受影响父目录链，保留系统根目录、含书签分支和历史空同级目录', async () => {
    const previousChrome = globalThis.chrome;
    const remove = vi.fn(async id => {
      if (id === 'keep' || id === 'work') throw new Error('文件夹非空');
    });
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([{
          id: '0',
          children: [{
            id: '1',
            parentId: '0',
            children: [
              {
                id: 'work',
                parentId: '1',
                children: [
                  { id: 'archive', parentId: 'work', children: [] },
                  { id: 'historic-empty', parentId: 'work', children: [] }
                ]
              },
              {
                id: 'keep',
                parentId: '1',
                children: [{ id: 'saved', parentId: 'keep', url: 'https://example.com/' }]
              }
            ]
          }]
        }]),
        remove
      }
    };

    try {
      const pruneDuplicateEmptyFolders = eval(`(${getFunctionSource('pruneDuplicateEmptyFolders')})`);
      await expect(pruneDuplicateEmptyFolders(['archive', 'keep'])).resolves.toBe(1);
      expect(remove.mock.calls.map(([id]) => id)).toEqual(['archive', 'work', 'keep']);
      expect(remove).not.toHaveBeenCalledWith('1');
      expect(remove).not.toHaveBeenCalledWith('historic-empty');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  it('批量和单组去重都启用空目录清理', () => {
    expect(popupSource).toContain("softDelete(ids, '删除中', { pruneEmptyFolders: true })");
    expect(popupSource).toContain("softDelete(ids, '清理重复项', { pruneEmptyFolders: true })");
  });
});

describe('批量删除性能', () => {
  it('受控并发删除，并仅对成功删除项分批清理标签', async () => {
    const DELETE_CONCURRENCY = 3;
    const TAG_CLEAR_BATCH_SIZE = 2;
    const DELETE_PROGRESS_INTERVAL_MS = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const chrome = {
      bookmarks: {
        remove: vi.fn(async id => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise(resolve => setTimeout(resolve, 0));
          inFlight--;
          if (id === 'failed') throw new Error('删除失败');
        })
      }
    };
    const BM = { setTagsBatch: vi.fn().mockResolvedValue(true) };
    const startProgress = vi.fn();
    const updateProgress = vi.fn();
    const endProgress = vi.fn();
    const console = { warn: vi.fn() };
    const removeForIds = eval(`(${getFunctionSource('removeForIds')})`);

    await expect(removeForIds(['one', 'two', 'failed', 'three', 'two'], '删除中')).resolves.toEqual({
      count: 3,
      removedIds: expect.arrayContaining(['one', 'two', 'three'])
    });

    expect(chrome.bookmarks.remove).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(3);
    expect(BM.setTagsBatch).toHaveBeenCalledTimes(2);
    expect(BM.setTagsBatch.mock.calls.flatMap(([changes]) => Object.keys(changes)).sort())
      .toEqual(['one', 'three', 'two']);
    expect(console.warn).toHaveBeenCalledWith('[书签管家] 删除失败', 'failed', expect.any(Error));
    expect(updateProgress).toHaveBeenLastCalledWith(100, '删除中 正在清理标签…');
    expect(startProgress).toHaveBeenCalledWith('删除中');
    expect(endProgress).toHaveBeenCalledOnce();
  });

  it('删除失败时不保留回收站记录，也不把失败项交给撤销或空目录清理', async () => {
    const TRASH_DELETE_HEARTBEAT_INTERVAL_MS = 5000;
    let trashRestoreInProgress = false;
    const bookmarks = new Map([
      ['removed', { id: 'removed', title: '成功项', url: 'https://one.example/', parentId: 'folder-one', path: [] }],
      ['failed', { id: 'failed', title: '失败项', url: 'https://two.example/', parentId: 'folder-two', path: [] }]
    ]);
    const getItemById = id => bookmarks.get(id) || null;
    const BM = {
      addToTrash: vi.fn().mockResolvedValue(2),
      completeTrashDelete: vi.fn().mockResolvedValue()
    };
    const removeForIds = vi.fn().mockResolvedValue({ count: 1, removedIds: ['removed'] });
    const pruneDuplicateEmptyFolders = vi.fn().mockResolvedValue(1);
    const toast = vi.fn();
    const console = { warn: vi.fn() };
    const softDelete = eval(`(${getFunctionSource('softDelete')})`);

    const result = await softDelete(['removed', 'failed'], '删除中', { pruneEmptyFolders: true });

    expect(BM.addToTrash).toHaveBeenCalledWith([...bookmarks.values()], { deletionPending: true });
    expect(BM.completeTrashDelete).toHaveBeenCalledWith(['removed'], ['failed']);
    expect(pruneDuplicateEmptyFolders).toHaveBeenCalledWith(['folder-one']);
    expect(result).toEqual({ n: 1, items: [bookmarks.get('removed')], prunedFolders: 1 });
  });

  it('空文件夹按子目录优先的原始顺序串行删除，不清理标签', async () => {
    const DATA = { emptyFolders: [{ id: 'child' }, { id: 'parent' }] };
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const removeForIds = vi.fn().mockResolvedValue({ count: 2, removedIds: ['child', 'parent'] });
    const toast = vi.fn();
    const refresh = vi.fn();
    const bulkCleanEmpty = eval(`(${getFunctionSource('bulkCleanEmpty')})`);

    await bulkCleanEmpty();

    expect(removeForIds).toHaveBeenCalledWith(
      ['child', 'parent'],
      '清理中',
      { concurrency: 1, clearTags: false }
    );
    expect(toast).toHaveBeenCalledWith('已清理 2 个空文件夹 ✓', 'ok');
  });
});

describe('回收站一键恢复', () => {
  it('确认后批量恢复，显示进度并汇总原目录回退数量', async () => {
    let trashRestoreInProgress = false;
    const items = [{ id: 'one' }, { id: 'two' }];
    const DATA = { trash: items };
    const BM = {
      restoreTrashItems: vi.fn(async (_items, options) => {
        options.onProgress({ done: 1, total: 2, restored: 1 });
        options.onProgress({ done: 2, total: 2, restored: 2 });
        return { restored: 2, fallback: 1, failed: [] };
      })
    };
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const startProgress = vi.fn();
    const updateProgress = vi.fn();
    const endProgress = vi.fn();
    const toast = vi.fn();
    const refresh = vi.fn().mockResolvedValue();
    const doRestoreAllTrash = eval(`(${getFunctionSource('doRestoreAllTrash')})`);

    await doRestoreAllTrash();

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '恢复回收站全部 2 项？', confirmText: '恢复全部 2 项', danger: false
    }));
    expect(startProgress).toHaveBeenCalledWith('正在恢复书签，请稍候…');
    expect(updateProgress).toHaveBeenLastCalledWith(100, '正在恢复 2/2');
    expect(BM.restoreTrashItems).toHaveBeenCalledWith(items, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(toast).toHaveBeenCalledWith('已恢复 2 项（1 项已放回书签栏） ✓', 'ok');
    expect(refresh).toHaveBeenCalledOnce();
    expect(endProgress).toHaveBeenCalledOnce();
    expect(trashRestoreInProgress).toBe(false);
  });

  it('单项失败不会掩盖已恢复的书签', async () => {
    let trashRestoreInProgress = false;
    const items = [{ id: 'one' }, { id: 'two' }];
    const DATA = { trash: items };
    const BM = {
      restoreTrashItems: vi.fn().mockResolvedValue({
        restored: 1, fallback: 0, failed: [{ id: 'two' }]
      })
    };
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const startProgress = vi.fn();
    const updateProgress = vi.fn();
    const endProgress = vi.fn();
    const toast = vi.fn();
    const refresh = vi.fn().mockResolvedValue();
    const doRestoreAllTrash = eval(`(${getFunctionSource('doRestoreAllTrash')})`);

    await doRestoreAllTrash();

    expect(toast).toHaveBeenCalledWith('已恢复 1 项，1 项失败 ✓', 'warn');
    expect(refresh).toHaveBeenCalledOnce();
    expect(endProgress).toHaveBeenCalledOnce();
    expect(trashRestoreInProgress).toBe(false);
  });
});

describe('页签切换调度', () => {
  it('切换后立即刷新时保持新页签，并丢弃旧渲染任务', () => {
    let currentTab = 'overview';
    let overviewDetail = 'security';
    let planMode = true;
    let PLAN = { type: 'delete' };
    let DATA = {};
    let tabRenderToken = 0;
    let frameCallback;
    const renderedTabs = [];
    const document = { querySelectorAll: () => [{ dataset: { tab: 'overview' }, classList: { toggle() {} } }] };
    const page = { innerHTML: '现有内容' };
    const content = () => page;
    const requestAnimationFrame = callback => { frameCallback = callback; };
    const render = tab => { renderedTabs.push(tab); };
    const switchTab = eval(`(${getFunctionSource('switchTab')})`);

    switchTab('tags');

    expect(page.innerHTML).toBe('现有内容');

    // refresh() 会使旧页签任务失效，并按照 currentTab 立即重绘。
    tabRenderToken++;
    render(currentTab);
    frameCallback();

    expect(currentTab).toBe('tags');
    expect(overviewDetail).toBe('');
    expect(planMode).toBe(false);
    expect(PLAN).toBeNull();
    expect(renderedTabs).toEqual(['tags']);
    expect(tabRenderToken).toBe(2);
    expect(DATA).toEqual({});
  });

  it('从概览进入工具视图时会使旧页签渲染任务失效', () => {
    let overviewDetail = '';
    let cleanSub = 'repeat';
    let securitySub = 'sensitive';
    let planMode = true;
    let PLAN = { type: 'delete' };
    let currentTab = 'tags';
    let tabRenderToken = 4;
    const document = { querySelectorAll: () => [{ dataset: { tab: 'overview' }, classList: { toggle: vi.fn() } }] };
    const DATA = {};
    const render = vi.fn();
    const openOverviewDetail = eval(`(${getFunctionSource('openOverviewDetail')})`);

    openOverviewDetail('security', 'trash');

    expect(currentTab).toBe('overview');
    expect(overviewDetail).toBe('security');
    expect(securitySub).toBe('trash');
    expect(planMode).toBe(false);
    expect(PLAN).toBeNull();
    expect(tabRenderToken).toBe(5);
    expect(render).toHaveBeenCalledWith('overview');
  });
});

describe('标签收敛统计', () => {
  it('按去重后的实际处理对象计数，且不会重写无需变更的标签', async () => {
    const tags = {
      onlyFallback: ['其他'],
      fallbackWithTag: ['工具', '其他'],
      loose: ['散落'],
      unchanged: ['工具'],
      stale: ['其他']
    };
    const DATA = {
      itemById: new Map([
        ['onlyFallback', { id: 'onlyFallback', title: '仅兜底', host: 'one.example' }],
        ['fallbackWithTag', { id: 'fallbackWithTag', title: '兼有标签', host: 'two.example' }],
        ['loose', { id: 'loose', title: '散落标签', host: 'three.example' }],
        ['unchanged', { id: 'unchanged', title: '无需变更', host: 'four.example' }]
      ])
    };
    const BM = {
      FALLBACK_TAG: '其他',
      loadTags: vi.fn(),
      loadFixedTags: vi.fn(),
      getTags: () => tags,
      normalizeToPool: tag => tag === '散落' ? '工具' : tag,
      setTagsBatch: vi.fn().mockResolvedValue(true),
      suggestTags: vi.fn(() => [])
    };
    const getItemById = id => DATA.itemById.get(id) || null;
    const escapeHtml = value => String(value);
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const startProgress = vi.fn();
    const updateProgress = vi.fn();
    const endProgress = vi.fn();
    const toast = vi.fn();
    const refresh = vi.fn();
    const migrateTags = eval(`(${getFunctionSource('migrateTags')})`);

    await migrateTags();

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '收敛 3 个书签的标签，并清理 1 条历史记录？' }));
    expect(BM.setTagsBatch).toHaveBeenCalledOnce();
    expect(BM.setTagsBatch).toHaveBeenCalledWith({
      onlyFallback: [],
      fallbackWithTag: ['工具'],
      loose: ['工具'],
      stale: null
    });
    expect(BM.suggestTags).toHaveBeenCalledWith(expect.objectContaining({ host: 'one.example', title: '仅兜底' }));
    expect(BM.suggestTags).toHaveBeenCalledWith(expect.objectContaining({ host: 'two.example', title: '兼有标签' }));
    expect(toast).toHaveBeenCalledWith('标签已收敛 ✓（处理 3 个书签，清理 1 条历史记录）', 'ok');
  });
});

describe('搜索清除', () => {
  it('清空查询、隐藏顶部清除按钮并恢复当前页签', () => {
    let SEARCH = 'privnode';
    let currentTab = 'overview';
    const searchInput = { value: SEARCH };
    const searchClear = { classList: { add: vi.fn() } };
    const $ = selector => selector === '#searchInput' ? searchInput : searchClear;
    const render = vi.fn();
    const clearSearch = eval(`(${getFunctionSource('clearSearch')})`);

    clearSearch();

    expect(SEARCH).toBe('');
    expect(searchInput.value).toBe('');
    expect(searchClear.classList.add).toHaveBeenCalledWith('hidden');
    expect(render).toHaveBeenCalledWith('overview');
  });

  it('点击搜索结果中的标签会退出搜索并进入标签筛选', () => {
    let TAG_FILTER = '';
    const clearSearch = vi.fn();
    const switchTab = vi.fn();
    const openTagFilter = eval(`(${getFunctionSource('openTagFilter')})`);

    openTagFilter('AI');

    expect(TAG_FILTER).toBe('AI');
    expect(clearSearch).toHaveBeenCalledWith(false);
    expect(switchTab).toHaveBeenCalledWith('tags');
  });
});
