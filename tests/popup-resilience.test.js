/**
 * 侧边栏（popup.html / 侧边面板）的初始化与刷新韧性回归
 *
 * 背景：
 * 1) 打开面板时内容区会先被清空成「正在扫描书签…」，而一次打开可能触发多轮全量扫描，
 *    书签量大时表现为反复白屏；删除单条书签实测会连跑 17 轮 analyze + render。
 * 2) 初始化链缺少兜底：扩展重载后侧边栏文档被复用（DOMContentLoaded 已过去）时 init
 *    永不执行；chrome.bookmarks.getTree() 永不 settle 时也没有超时，内容区永久停在加载态。
 * 本文件锁定修复后的行为：首屏才铺加载态、刷新合并为一轮、扫描有看门狗、故障可见。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupSource = readFileSync(join(__dirname, '..', 'js', 'popup.js'), 'utf-8');

// 与 popup-performance.test.js / undo-delete.test.js 相同的源码抽取方式：只取单个顶层函数体
function getFunctionSource(name, source = popupSource) {
  const functionStart = source.indexOf(`function ${name}(`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const endings = [
    { index: source.indexOf('\n}\n', start), length: 2 },
    { index: source.indexOf('\r\n}\r\n', start), length: 3 }
  ].filter(entry => entry.index >= 0).sort((a, b) => a.index - b.index);
  if (start < 0 || !endings.length) throw new Error(`未找到函数 ${name}`);
  const end = endings[0];
  return source.slice(start, end.index + end.length).replace(`function ${name}`, 'function');
}

function storageChangeListenerSource() {
  const start = popupSource.indexOf('chrome.storage.onChanged.addListener(');
  const close = popupSource.indexOf('\n  });', start);
  if (start < 0 || close < 0) throw new Error('未找到 storage.onChanged 监听器');
  return popupSource.slice(start, close);
}

describe('初始化兜底', () => {
  it('DOMContentLoaded 已经过去时也能初始化（侧边栏文档被复用）', () => {
    expect(popupSource).toContain("if (document.readyState === 'loading')");
    expect(popupSource).toContain(
      "document.addEventListener('DOMContentLoaded', bootstrap, { once: true });"
    );
    expect(popupSource).toContain('bootstrap();');
    // init 的拒绝必须被接住，否则面板会静默停在骨架
    expect(popupSource).toContain('.then(init)');
    expect(popupSource).toContain('.catch(reportFatal);');
  });

  it('未处理的异步错误变成可见提示，但不覆盖已渲染的内容', () => {
    expect(popupSource).toContain("window.addEventListener('unhandledrejection'");
    expect(popupSource).toContain("!box.querySelector('.row, .entry-card, .error-card')");
  });

  it('数据未就绪时 render 不会用空数据渲染', () => {
    expect(getFunctionSource('render')).toContain('if (!DATA) return;');
  });

  it('事件注册使用可选链，单个元素缺失不会中断整段注册', () => {
    // 裸的 $('#x').addEventListener 会在元素缺失时抛错，让后续注册全部失效
    expect(popupSource).not.toMatch(/\$\('#[A-Za-z0-9_-]+'\)\.addEventListener\(/);
    expect(popupSource).toContain("$('#rescanBtn')?.addEventListener(");
  });

  it('初始化先校验关键节点，结构缺失时给出可见错误', () => {
    const init = getFunctionSource('init');
    expect(init).toContain('REQUIRED_NODES');
    expect(init).toContain('面板结构缺少必要元素');
  });
});

describe('扫描看门狗与加载态', () => {
  const fakeBox = () => ({ innerHTML: '' });

  it('analyze 永不返回时给出错误，而不是永久停在加载态', async () => {
    const box = fakeBox();
    const content = () => box;
    // runRefresh 会先校验 bookmarks API 可用
    const chrome = { bookmarks: { getTree: () => [] } };
    let DATA = null;
    let currentTab = 'overview';
    let tabRenderToken = 0;
    let listRenderLimits = {};
    const BMAnalyzer = { analyze: () => new Promise(() => {}) };
    const BM = {
      migrateStorage: vi.fn().mockResolvedValue(undefined),
      purgeExpiredTrash: vi.fn().mockResolvedValue(undefined),
      getTrash: vi.fn().mockResolvedValue([])
    };
    const render = vi.fn();
    const updateBulk = vi.fn();
    const toast = vi.fn();
    const showError = vi.fn();
    const SCAN_TIMEOUT_MS = 20;
    const withTimeout = eval(`(${getFunctionSource('withTimeout')})`);
    const runRefresh = eval(`(${getFunctionSource('runRefresh')})`);

    await runRefresh();

    expect(box.innerHTML).toContain('正在扫描书签');
    expect(showError).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });

  it('已有内容时扫描失败只提示，不把列表替换成错误卡', async () => {
    const box = fakeBox();
    box.innerHTML = '<div class="row">已有列表</div>';
    const content = () => box;
    // runRefresh 会先校验 bookmarks API 可用
    const chrome = { bookmarks: { getTree: () => [] } };
    let DATA = { items: [], trash: [] };
    let currentTab = 'overview';
    let tabRenderToken = 0;
    let listRenderLimits = {};
    const BMAnalyzer = { analyze: () => Promise.reject(new Error('boom')) };
    const BM = {
      migrateStorage: vi.fn().mockResolvedValue(undefined),
      purgeExpiredTrash: vi.fn().mockResolvedValue(undefined),
      getTrash: vi.fn().mockResolvedValue([])
    };
    const render = vi.fn();
    const updateBulk = vi.fn();
    const toast = vi.fn();
    const showError = vi.fn();
    const SCAN_TIMEOUT_MS = 20;
    const withTimeout = eval(`(${getFunctionSource('withTimeout')})`);
    const runRefresh = eval(`(${getFunctionSource('runRefresh')})`);

    await runRefresh();

    expect(box.innerHTML).toBe('<div class="row">已有列表</div>');
    expect(showError).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
  });

  it('刷新成功时不再插整页加载占位（删除后闪白与滚动丢失的来源）', async () => {
    const box = fakeBox();
    box.innerHTML = '<div class="row">已有列表</div>';
    const content = () => box;
    // runRefresh 会先校验 bookmarks API 可用
    const chrome = { bookmarks: { getTree: () => [] } };
    let DATA = { items: [] };
    let currentTab = 'overview';
    let tabRenderToken = 0;
    let listRenderLimits = {};
    const BMAnalyzer = {
      analyze: async () => ({
        items: [],
        trash: [],
        exactDuplicates: [],
        emptyFolders: [],
        tagStats: {}
      })
    };
    const BM = {
      migrateStorage: vi.fn().mockResolvedValue(undefined),
      purgeExpiredTrash: vi.fn().mockResolvedValue(undefined),
      getTrash: vi.fn().mockResolvedValue([])
    };
    const render = vi.fn();
    const updateBulk = vi.fn();
    const toast = vi.fn();
    const showError = vi.fn();
    const SCAN_TIMEOUT_MS = 20;
    const withTimeout = eval(`(${getFunctionSource('withTimeout')})`);
    const runRefresh = eval(`(${getFunctionSource('runRefresh')})`);

    await runRefresh();

    expect(box.innerHTML).toBe('<div class="row">已有列表</div>');
    expect(render).toHaveBeenCalledWith('overview');
    expect(updateBulk).toHaveBeenCalledOnce();
  });

  it('回收站读取失败也不影响主列表渲染', async () => {
    const box = fakeBox();
    const content = () => box;
    // runRefresh 会先校验 bookmarks API 可用
    const chrome = { bookmarks: { getTree: () => [] } };
    let DATA = { items: [] };
    let currentTab = 'overview';
    let tabRenderToken = 0;
    let listRenderLimits = {};
    const BMAnalyzer = {
      analyze: async () => ({
        items: [],
        trash: [],
        exactDuplicates: [],
        emptyFolders: [],
        tagStats: {}
      })
    };
    const BM = {
      migrateStorage: vi.fn().mockResolvedValue(undefined),
      purgeExpiredTrash: vi.fn().mockResolvedValue(undefined),
      getTrash: vi.fn().mockRejectedValue(new Error('后台忙'))
    };
    const render = vi.fn();
    const updateBulk = vi.fn();
    const toast = vi.fn();
    const showError = vi.fn();
    const SCAN_TIMEOUT_MS = 20;
    const withTimeout = eval(`(${getFunctionSource('withTimeout')})`);
    const runRefresh = eval(`(${getFunctionSource('runRefresh')})`);

    await runRefresh();

    expect(render).toHaveBeenCalledWith('overview');
    expect(showError).not.toHaveBeenCalled();
    expect(DATA.trash).toEqual([]);
  });
});

describe('刷新合并（删除不再连跑多轮全量扫描）', () => {
  it('合并调度存在，并在窗口结束后回到 refresh', () => {
    expect(popupSource).toContain('function scheduleRefresh(force)');
    expect(popupSource).toContain('refresh(force);');
    expect(popupSource).toContain('const REFRESH_COALESCE_MS = 120;');
    // 连续变更（批量新增 / 同步回写）时给相邻两轮扫描留下最小间隔，避免刷新风暴
    expect(popupSource).toContain('const REFRESH_MIN_INTERVAL_MS = 800;');
  });

  it('单条删除与空文件夹清理走合并调度', () => {
    expect(getFunctionSource('softDeleteBookmark')).toContain('scheduleRefresh();');
    expect(getFunctionSource('bulkCleanEmpty')).toContain('scheduleRefresh();');
    const bulk = popupSource.slice(popupSource.indexOf("$('#bulkDelete')"));
    expect(bulk.slice(0, 1200)).toContain('scheduleRefresh();');
  });

  it('标签回写触发的 storage 变更同样走合并调度', () => {
    const listener = storageChangeListenerSource();
    expect(listener).toContain("changes.bmTags");
    expect(listener).toContain('scheduleRefresh();');
  });
});
