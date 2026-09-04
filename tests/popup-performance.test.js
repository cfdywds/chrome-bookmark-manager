import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupSource = readFileSync(join(__dirname, '..', 'js', 'popup.js'), 'utf-8');
const popupHtml = readFileSync(join(__dirname, '..', 'popup.html'), 'utf-8');
const popupCss = readFileSync(join(__dirname, '..', 'css', 'popup.css'), 'utf-8');
const libSource = readFileSync(join(__dirname, '..', 'js', 'lib.js'), 'utf-8');
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf-8'));

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

function getStorageChangeListenerSource() {
  const source = popupSource.replace(/\r\n/g, '\n');
  const marker = 'chrome.storage.onChanged.addListener(';
  const start = source.indexOf(marker);
  const end = source.indexOf('\n    });\n  } catch', start);
  if (start < 0 || end < 0) throw new Error('未找到 storage change listener');
  return source.slice(start + marker.length, end + 6);
}

describe('弹窗大列表渲染', () => {
  it('不再提供 HTML 分析报告导出', () => {
    expect(popupHtml).not.toContain('exportBtn');
    expect(popupSource).not.toContain('buildReportHtml');
    expect(popupSource).not.toContain('exportReport');
    expect(popupSource).not.toContain('bookmark-report.html');
  });

  it('标签按钮悬浮态使用低透明度底色', () => {
    const rule = popupCss.match(/\.tag-chip:hover,\s*\.tag-chip:focus-visible\s*\{([^}]*)\}/)?.[1] || '';
    expect(rule).toContain('background: rgba(22, 163, 74, .12)');
    expect(rule).toContain('color: var(--ok-strong)');
    expect(popupCss).toContain('--ok-strong: #047857');
    expect(popupCss).toContain('.tag-chip:focus-visible { outline: 2px solid var(--ok-strong)');
  });

  it('待清理卡片仅保留动作名称，不重复展示说明', () => {
    expect(popupSource).not.toContain('class="act-desc"');
    expect(popupSource).not.toContain("desc: 'URL 完全相同'");
    expect(popupSource).not.toContain("desc: '无书签的夹'");
  });

  it('操作指南不再引用已移除的敏感书签入口', () => {
    expect(popupHtml).not.toContain('敏感书签和回收站均从这里进入');
    expect(popupHtml).toContain('重复书签、空文件夹和回收站均从这里进入');
  });

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
  it('提供概览、标签和独立隐藏书签页签', () => {
    const tabs = [...popupHtml.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
    expect(tabs).toEqual(['overview', 'tags', 'hidden']);
  });

  it('标签页仅说明标签数字含义，不重复编码数量', () => {
    expect(popupSource).toContain("helpDot('标签后的数字表示书签数量。')");
    expect(popupSource).not.toContain("pageHint(ICON('tag'), '<b>本页能做什么：</b>按标签浏览书签");
  });
});

describe('扩展内更新', () => {
  it('不提供更新检查入口、运行时请求或 GitHub API 权限', () => {
    expect(popupSource).not.toContain('check-update');
    expect(popupSource).not.toContain('checkUpdate');
    expect(libSource).not.toContain('checkForUpdate');
    expect(libSource).not.toContain('api.github.com');
    expect(manifest.host_permissions || []).not.toContain('https://api.github.com/*');
  });
});

describe('书签地址编辑', () => {
  it('侧边栏编辑 URL 后显式迁移标签同步记录', () => {
    expect(popupSource).toContain('await BM.migrateTagSyncUrl(EDITING.id, previousUrl, u.href);');
  });
});

describe('隐藏书签视图', () => {
  it('只渲染隐藏书签，并复用书签行操作', () => {
    const panel = { innerHTML: '' };
    const content = () => panel;
    const ICON = name => `<${name}>`;
    const ICON_SM = name => `<${name}>`;
    const emptyState = vi.fn();
    const renderItemRows = vi.fn(() => '<rows>');
    const FIRST_LIST_COUNT = 80;
    const DATA = {
      items: [
        { id: 'visible', hidden: false },
        { id: 'hidden-a', hidden: true },
        { id: 'hidden-b', hidden: true }
      ]
    };
    const renderHidden = eval(`(${getFunctionSource('renderHidden')})`);

    renderHidden();

    expect(renderItemRows).toHaveBeenCalledWith(
      [DATA.items[1], DATA.items[2]],
      'hidden-items',
      FIRST_LIST_COUNT,
      FIRST_LIST_COUNT
    );
    expect(panel.innerHTML).toContain('已隐藏 <b>2</b> 个书签');
    expect(emptyState).not.toHaveBeenCalled();
  });

  it('空列表显示隐藏书签专用空状态，并由页签分发到该视图', () => {
    const panel = { innerHTML: '' };
    const content = () => panel;
    const ICON = name => `<${name}>`;
    const ICON_SM = name => `<${name}>`;
    const emptyState = vi.fn(() => '<empty>');
    const renderItemRows = vi.fn();
    const FIRST_LIST_COUNT = 80;
    const DATA = { items: [{ id: 'visible', hidden: false }] };
    const renderHidden = eval(`(${getFunctionSource('renderHidden')})`);

    renderHidden();

    expect(emptyState).toHaveBeenCalledWith('<eye-off>', '没有隐藏的书签', '隐藏的书签会显示在这里');
    expect(renderItemRows).not.toHaveBeenCalled();
    expect(getFunctionSource('render')).toContain("else if (tab === 'hidden') renderHidden();");
  });

  it('在隐藏页搜索时只匹配隐藏书签', () => {
    const panel = { innerHTML: '' };
    const content = () => panel;
    const ICON = name => `<${name}>`;
    const ICON_SM = name => `<${name}>`;
    const escapeHtml = value => String(value);
    const emptyState = vi.fn();
    const renderItemRows = vi.fn(() => '<rows>');
    const updateBulk = vi.fn();
    const FIRST_LIST_COUNT = 80;
    const SEARCH = 'docs';
    const currentTab = 'hidden';
    const DATA = {
      items: [
        { id: 'visible', hidden: false, title: 'Visible docs', url: '', host: '' },
        { id: 'hidden', hidden: true, title: 'Hidden docs', url: '', host: '' }
      ]
    };
    const renderSearch = eval(`(${getFunctionSource('renderSearch')})`);

    renderSearch();

    expect(renderItemRows).toHaveBeenCalledWith(
      [DATA.items[1]],
      'search-hidden-docs',
      FIRST_LIST_COUNT,
      FIRST_LIST_COUNT,
      { highlight: SEARCH, search: true }
    );
    expect(panel.innerHTML).toContain('隐藏书签搜索');
    expect(updateBulk).toHaveBeenCalledOnce();
  });

  it('标签页不再切换到混合隐藏视图，快捷入口跳转独立页面', () => {
    expect(popupSource).not.toContain('hiddenView');
    expect(popupSource).not.toContain('toggle-hidden-view');
    expect(getFunctionSource('renderTags')).toContain('const stats = DATA.tagStats || {};');
    expect(getFunctionSource('renderTags')).toContain('data-jump="hidden"');
  });
});

describe('标签池重命名', () => {
  it('同步更新域名和关键字规则中的标签引用', () => {
    const renameTagInRules = eval(`(${getFunctionSource('renameTagInRules')})`);

    expect(renameTagInRules({
      domain: { github: ['代码', '工具'] },
      keyword: { roadmap: ['代码'] }
    }, '代码', '开发')).toEqual({
      domain: { github: ['开发', '工具'] },
      keyword: { roadmap: ['开发'] }
    });
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

  it('失败提示可提供继续打标操作，成功恢复时可清除提示', () => {
    const retry = vi.fn();
    const fields = {
      '#app': { classList: { add: vi.fn(), remove: vi.fn() } },
      '#operationNoticeTitle': { textContent: '' },
      '#operationNoticeDetail': { textContent: '' },
      '#operationNotice': { classList: { remove: vi.fn(), add: vi.fn() } },
      '#operationNoticeAction': { textContent: '', onclick: null, classList: { remove: vi.fn(), add: vi.fn() } }
    };
    const $ = selector => fields[selector];
    const showPersistentError = eval(`(${getFunctionSource('showPersistentError')})`);
    const clearPersistentError = eval(`(${getFunctionSource('clearPersistentError')})`);

    showPersistentError('AI 打标失败', '网络请求失败', { label: '继续打标（3）', onClick: retry });
    expect(fields['#operationNoticeAction'].textContent).toBe('继续打标（3）');
    expect(fields['#operationNoticeAction'].onclick).toBe(retry);
    expect(fields['#operationNoticeAction'].classList.remove).toHaveBeenCalledWith('hidden');

    clearPersistentError();
    expect(fields['#operationNoticeAction'].onclick).toBeNull();
    expect(fields['#operationNoticeAction'].classList.add).toHaveBeenCalledWith('hidden');
    expect(fields['#operationNotice'].classList.add).toHaveBeenCalledWith('hidden');
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

  it('同步读取超时时仍扫描本地书签，设置读取与首轮扫描并行', () => {
    expect(popupSource).toContain('tagConfigurationReady = BM.initializeSyncedTagConfiguration');
    expect(popupSource).toContain('settingsReady = loadSettings();');
    expect(popupSource).toContain('function waitForInitialTagConfiguration()');
    expect(getFunctionSource('runRefresh')).toContain('await waitForInitialTagConfiguration();');
    expect(popupSource).toContain('await Promise.all([settingsReady, refresh(true)]);');
    expect(popupSource).toContain('void tagConfigurationReady.then(async () =>');
    expect(popupSource).toContain('BM.watchTagConfiguration');
  });

  it('初始同步未返回时，在时限后解除首屏扫描等待', async () => {
    vi.useFakeTimers();
    const INITIAL_TAG_SYNC_WAIT_MS = 1200;
    const tagConfigurationReady = new Promise(() => {});
    const waitForInitialTagConfiguration = eval(`(${getFunctionSource('waitForInitialTagConfiguration')})`);

    try {
      const waiting = waitForInitialTagConfiguration();
      await vi.advanceTimersByTimeAsync(INITIAL_TAG_SYNC_WAIT_MS);
      await expect(waiting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('标签池编辑通过共享配置同步保存', () => {
    expect(getFunctionSource('createTag')).toContain('BM.saveSyncedTagConfiguration');
    expect(getFunctionSource('renameTag')).toContain('BM.saveSyncedTagConfiguration');
    expect(getFunctionSource('removeTagFromPool')).toContain('BM.saveSyncedTagConfiguration');
    expect(popupSource).not.toContain('chrome.storage.local.set({ bmFixedTags');
  });

  it('标签池外部变更后重载缓存并刷新已打开的标签管理器', async () => {
    const invalidateFixedTags = vi.fn();
    const loadFixedTags = vi.fn().mockResolvedValue(undefined);
    const BM = { invalidateFixedTags, loadFixedTags };
    const manager = { classList: { contains: vi.fn().mockReturnValue(false) } };
    const $ = vi.fn().mockReturnValue(manager);
    const openTagManager = vi.fn();
    const refresh = vi.fn();
    let SETTINGS = {};
    const PROVIDERS = {};
    const listener = eval(`(${getStorageChangeListenerSource()})`);

    listener({ bmFixedTags: { newValue: ['代码'] } }, 'local');

    expect(invalidateFixedTags).toHaveBeenCalledOnce();
    expect(loadFixedTags).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(openTagManager).toHaveBeenCalledOnce());
    expect($).toHaveBeenCalledWith('#tagMgrWrap');
    expect(refresh).not.toHaveBeenCalled();
    expect(SETTINGS).toEqual({});
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
    expect(getFunctionSource('aiTagAll')).toContain('const targets = isResume ? resumeItems : getAiTagTargets(force);');
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

  it('续打启动锁覆盖权限检查和确认阶段，避免重复点击发起并发请求', () => {
    let aiTagRunning = false;
    let aiTagStarting = false;
    const claimAiTagStart = eval(`(${getFunctionSource('claimAiTagStart')})`);

    expect(claimAiTagStart()).toBe(true);
    expect(aiTagStarting).toBe(true);
    expect(claimAiTagStart()).toBe(false);
    aiTagStarting = false;
    aiTagRunning = true;
    expect(claimAiTagStart()).toBe(false);
    expect(getFunctionSource('aiTagAll')).toContain('if (!claimAiTagStart()) return;');
  });

  it('失败续打只保留尚未成功写入的代表书签', () => {
    const getPendingAiRepresentatives = eval(`(${getFunctionSource('getPendingAiRepresentatives')})`);
    const items = [{ id: 'done' }, { id: 'retry-1' }, { id: 'retry-2' }];
    expect(getPendingAiRepresentatives(items, new Set(['done'])).map(item => item.id))
      .toEqual(['retry-1', 'retry-2']);
    const source = getFunctionSource('aiTagAll');
    expect(source).toContain('const isResume = Array.isArray(resumeItems);');
    expect(source).toContain("label: '继续打标（' + remainingItems.length + '）'");
    expect(source).toContain('const remainingItems = getPendingAiRepresentatives(aiBatch, completedRepresentatives);');
  });

  it('模型只返回“其他”时不将该书签视作打标完成', () => {
    const source = getFunctionSource('aiTagAll');
    expect(source).toContain('isAiTagPending({ tags })');
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

describe('自定义规则批量应用', () => {
  it('按同址书签汇总规则结果，并支持追加、覆盖和仅未标三种策略', () => {
    const BM = {
      FALLBACK_TAG: '其他',
      getTags: () => ({ sameA: ['手动'], sameB: [], lone: ['其他'] }),
      urlKey: url => url,
      unionTagLists: lists => {
        const tags = [];
        lists.forEach(list => {
          list.forEach(tag => {
            if (tag && tag !== '其他' && !tags.includes(tag)) tags.push(tag);
          });
        });
        return tags;
      },
      matchCustomTagRules: item => ({
        domain: item.host === 'corp.example' ? ['工作'] : [],
        keyword: item.title === 'release' || item.title === '发布' ? ['资讯'] : []
      })
    };
    const DATA = {
      items: [
        { id: 'sameA', key: 'same-url', host: 'corp.example', url: 'https://corp.example/', title: '内部系统', tags: ['手动'] },
        { id: 'sameB', key: 'same-url', host: 'corp.example', url: 'https://corp.example/', title: 'release', tags: [] },
        { id: 'lone', key: 'lone-url', host: 'example.com', url: 'https://example.com/release', title: '发布', tags: ['其他'] }
      ]
    };
    const collectCustomRuleApplications = eval(`(${getFunctionSource('collectCustomRuleApplications')})`);

    expect(collectCustomRuleApplications('append')).toEqual({
      matched: 3,
      changed: 3,
      changes: {
        sameA: ['手动', '工作', '资讯'],
        sameB: ['手动', '工作', '资讯'],
        lone: ['资讯']
      }
    });
    expect(collectCustomRuleApplications('replace')).toEqual({
      matched: 3,
      changed: 3,
      changes: {
        sameA: ['工作', '资讯'],
        sameB: ['工作', '资讯'],
        lone: ['资讯']
      }
    });
    expect(collectCustomRuleApplications('untagged')).toEqual({
      matched: 3,
      changed: 1,
      changes: { lone: ['资讯'] }
    });
  });

  it('提供不调用 AI 的规则应用入口和三种确认选项', () => {
    expect(popupSource).toContain('data-action="apply-custom-rules"');
    expect(popupSource).toContain("} else if (action === 'apply-custom-rules') {");
    expect(popupHtml).toContain('id="confirmFourth"');
    expect(popupHtml).toContain('id="operationNoticeAction"');
    expect(popupCss).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(popupCss).toContain('justify-content: flex-end; gap: 8px; flex-wrap: wrap;');
    const source = getFunctionSource('applyCustomRules');
    expect(source).toContain("fourthText: '仅未标'");
    expect(source).toContain("thirdText: '覆盖'");
    expect(source).toContain("confirmText: '追加'");
    expect(source).not.toContain('BM.aiTag');
  });

  it('规则应用的预览异常会显示失败提示，而非静默中断', async () => {
    const BM = {
      loadTags: vi.fn().mockResolvedValue(undefined),
      loadFixedTags: vi.fn().mockResolvedValue(undefined),
      loadTagRules: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn()
    };
    const getCustomRuleCount = () => 1;
    const collectCustomRuleApplications = vi.fn(() => { throw new Error('规则预览失败'); });
    const toast = vi.fn();
    const confirmDialog = vi.fn();
    const refresh = vi.fn();
    const document = { contains: vi.fn().mockReturnValue(true) };
    const trigger = { disabled: false, textContent: '⚡ 应用规则' };
    const applyCustomRules = eval(`(${getFunctionSource('applyCustomRules')})`);

    await applyCustomRules(trigger);

    expect(toast).toHaveBeenCalledWith('应用规则失败：规则预览失败', 'danger');
    expect(BM.logError).toHaveBeenCalledWith('apply-custom-rules', expect.any(Error));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(trigger).toEqual({ disabled: false, textContent: '⚡ 应用规则' });
    expect(document.contains).toHaveBeenCalledWith(trigger);
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

  it('无完整 URL 重复时，仍为归一化同址书签提供统一入口', () => {
    const BM = { urlKey: url => url.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, '') };
    const DATA = {
      exactDuplicates: [],
      itemsByUrlKey: new Map([['example.com/docs', [{ id: 'one' }, { id: 'two' }]]])
    };
    const getSameUrlGroups = eval(`(${getFunctionSource('getSameUrlGroups')})`);
    const emptyState = () => '<div>empty</div>';
    const ICON = () => '';
    const renderExact = eval(`(${getFunctionSource('renderExact')})`);
    const container = { innerHTML: '' };

    renderExact(container);

    expect(container.innerHTML).toContain('data-action="unify-exact-tags"');
  });

  it('AI 同址分组从完整索引回填已标与隐藏书签', () => {
    const pending = { id: 'pending', url: 'https://example.com/docs' };
    const tagged = { id: 'tagged', url: 'http://www.example.com/docs', tags: ['工具'] };
    const hidden = { id: 'hidden', url: 'https://example.com/docs/', hidden: true };
    const tagsById = { tagged: ['工作'], hidden: ['设计'] };
    const BM = {
      urlKey: url => url.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, ''),
      getTags: () => tagsById,
      unionTagLists: lists => [...new Set(lists.flat())]
    };
    const DATA = {
      itemsByUrlKey: new Map([['example.com/docs', [pending, tagged, hidden]]])
    };
    const getSameUrlSiblings = eval(`(${getFunctionSource('getSameUrlSiblings')})`);
    const collectAiTagGroups = eval(`(${getFunctionSource('collectAiTagGroups')})`);
    const mergeAiTagsWithSameUrl = eval(`(${getFunctionSource('mergeAiTagsWithSameUrl')})`);

    const { representatives, siblingsByKey } = collectAiTagGroups([pending]);
    const siblings = siblingsByKey.get('example.com/docs');

    expect([...representatives.values()].map(item => item.id)).toEqual(['pending']);
    expect(siblings.map(item => item.id).sort())
      .toEqual(['hidden', 'pending', 'tagged']);
    expect(mergeAiTagsWithSameUrl(siblings, ['教程'], false)).toEqual(['工作', '设计', '教程']);
    expect(mergeAiTagsWithSameUrl(siblings, ['教程'], true)).toEqual(['教程']);
  });

  it('新增和改址使用最新 URL，而非 DATA 中的旧快照', async () => {
    const setTagsBatch = vi.fn().mockResolvedValue(true);
    const BM = {
      urlKey: url => url.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, ''),
      loadTags: vi.fn().mockResolvedValue(),
      loadFixedTags: vi.fn().mockResolvedValue(),
      getTags: vi.fn(),
      unionTagLists: lists => [...new Set(lists.flat())],
      setTagsBatch
    };
    const existing = { id: 'existing', url: 'http://www.example.com/docs' };
    const oldSibling = { id: 'old-sibling', url: 'https://example.com/old' };
    const staleEditing = { id: 'editing', url: 'https://example.com/old' };
    const newSibling = { id: 'new-sibling', url: 'https://example.com/new' };
    const DATA = {
      itemsByUrlKey: new Map([
        ['example.com/docs', [existing]],
        ['example.com/old', [oldSibling, staleEditing]],
        ['example.com/new', [newSibling]]
      ]),
      itemById: new Map([['editing', staleEditing]])
    };
    const tagsById = {
      created: ['工具'],
      existing: ['前端'],
      editing: ['工具'],
      'old-sibling': ['设计'],
      'new-sibling': ['前端']
    };
    BM.getTags.mockReturnValue(tagsById);
    const getSameUrlSiblings = eval(`(${getFunctionSource('getSameUrlSiblings')})`);
    const unifySameUrlTags = eval(`(${getFunctionSource('unifySameUrlTags')})`);

    await unifySameUrlTags({ id: 'created', url: 'https://example.com/docs' }, ['工具']);
    expect(setTagsBatch).toHaveBeenLastCalledWith({
      existing: ['工具', '前端'],
      created: ['工具', '前端']
    });

    await unifySameUrlTags({ id: 'editing', url: 'https://example.com/new' }, ['工具']);
    expect(setTagsBatch).toHaveBeenLastCalledWith({
      'new-sibling': ['工具', '前端'],
      editing: ['工具', '前端']
    });

    setTagsBatch.mockResolvedValueOnce(false);
    await expect(unifySameUrlTags({ id: 'created', url: 'https://example.com/docs' }, ['工具']))
      .resolves.toBe(false);
  });

  it('新增后标签同步失败时保留书签并引导从列表编辑', () => {
    const saveAddSource = getFunctionSource('saveAdd');

    expect(saveAddSource).toContain('let created = null;');
    expect(saveAddSource).toContain("toast('书签已新增，但标签同步失败，请在列表中编辑重试', 'warn');");
    expect(saveAddSource).toContain('if (created) {');
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
    let planMode = true;
    let PLAN = { type: 'delete' };
    let currentTab = 'tags';
    let tabRenderToken = 4;
    const document = { querySelectorAll: () => [{ dataset: { tab: 'overview' }, classList: { toggle: vi.fn() } }] };
    const DATA = {};
    const render = vi.fn();
    const openOverviewDetail = eval(`(${getFunctionSource('openOverviewDetail')})`);

    openOverviewDetail('trash');

    expect(currentTab).toBe('overview');
    expect(overviewDetail).toBe('trash');
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
