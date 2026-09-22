/**
 * 删除后的「撤销」链路回归
 *
 * 背景：侧边栏（popup.html）的单条删除此前不提供撤销入口，而批量删除 / 重复项清理 /
 * 新标签页删除都提供；另外撤销在「没有任何可恢复记录」时会静默无反馈，看起来像没生效。
 * 本文件锁定这些行为：单条删除必须可撤销、撤销必须总有反馈、新标签页撤销要等删除收尾。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupSource = readFileSync(join(__dirname, '..', 'js', 'popup.js'), 'utf-8');
const newtabSource = readFileSync(join(__dirname, '..', 'js', 'newtab.js'), 'utf-8');

// 与 popup-performance.test.js 相同的源码抽取方式：只取单个顶层函数体，便于注入桩
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

function getNewtabFunctionSource(name) {
  const start = newtabSource.indexOf(`function ${name}(`);
  const bodyStart = newtabSource.indexOf('{', start);
  const functionStart = newtabSource.slice(Math.max(0, start - 6), start) === 'async '
    ? start - 6
    : start;
  if (start < 0 || bodyStart < 0) throw new Error(`未找到函数 ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < newtabSource.length; i += 1) {
    if (newtabSource[i] === '{') depth += 1;
    else if (newtabSource[i] === '}' && --depth === 0) {
      return newtabSource.slice(functionStart, i + 1);
    }
  }
  throw new Error(`未找到函数结尾 ${name}`);
}

const escapeHtml = value => String(value == null ? '' : value);

describe('侧边栏单条删除的撤销', () => {
  it('提供「撤销」入口，并把被删除的书签交给回收站恢复', async () => {
    const item = { id: 'b1', title: '示例', url: 'https://one.example/', parentId: 'f1' };
    const DATA = { itemById: new Map([['b1', item]]) };
    const getItemById = id => DATA.itemById.get(id) || null;
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const softDelete = vi.fn().mockResolvedValue({ n: 1, items: [item] });
    const toast = vi.fn();
    const undoDelete = vi.fn().mockResolvedValue();
    const refresh = vi.fn();
    const softDeleteBookmark = eval(`(${getFunctionSource('softDeleteBookmark')})`);

    await softDeleteBookmark('b1');

    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '删除书签？',
        message: expect.stringContaining('「示例」'),
        confirmText: '移入回收站'
      })
    );
    expect(softDelete).toHaveBeenCalledWith(['b1'], '删除书签', { pruneEmptyFolders: false });
    expect(refresh).toHaveBeenCalledOnce();

    const undoCall = toast.mock.calls.find(call => call[2] && call[2].label === '撤销');
    expect(undoCall).toBeTruthy();
    expect(undoCall[1]).toBe('ok');
    await undoCall[2].onClick();
    expect(undoDelete).toHaveBeenCalledWith([item]);
  });

  it('确认框取消时不删除', async () => {
    const DATA = { itemById: new Map([['b1', { id: 'b1', title: '示例' }]]) };
    const getItemById = id => DATA.itemById.get(id) || null;
    const confirmDialog = vi.fn().mockResolvedValue(false);
    const softDelete = vi.fn();
    const toast = vi.fn();
    const undoDelete = vi.fn();
    const refresh = vi.fn();
    const softDeleteBookmark = eval(`(${getFunctionSource('softDeleteBookmark')})`);

    await softDeleteBookmark('b1');

    expect(softDelete).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('实际未删除时不给出撤销入口', async () => {
    const DATA = { itemById: new Map([['b1', { id: 'b1', title: '示例' }]]) };
    const getItemById = id => DATA.itemById.get(id) || null;
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const softDelete = vi.fn().mockResolvedValue({ n: 0, items: [] });
    const toast = vi.fn();
    const undoDelete = vi.fn();
    const refresh = vi.fn();
    const softDeleteBookmark = eval(`(${getFunctionSource('softDeleteBookmark')})`);

    await softDeleteBookmark('b1');

    expect(toast).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('撤销删除的反馈', () => {
  it('成功恢复时提示恢复数量', async () => {
    const BM = { restoreTrashItems: vi.fn().mockResolvedValue({ restored: 2, failed: [] }) };
    const toast = vi.fn();
    const refresh = vi.fn();
    const undoDelete = eval(`(${getFunctionSource('undoDelete')})`);

    await undoDelete([{ id: 'a' }, { id: 'b' }]);

    expect(BM.restoreTrashItems).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
    expect(toast).toHaveBeenCalledWith('已撤销删除 2 项 ✓', 'ok');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('没有任何可恢复记录时也给出提示（不静默无反应）', async () => {
    const BM = { restoreTrashItems: vi.fn().mockResolvedValue({ restored: 0, failed: [] }) };
    const toast = vi.fn();
    const refresh = vi.fn();
    const undoDelete = eval(`(${getFunctionSource('undoDelete')})`);

    await undoDelete([{ id: 'gone' }]);

    expect(toast).toHaveBeenCalledWith(expect.stringContaining('没有可撤销的删除记录'), 'warn');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('恢复失败时带出后台给出的具体原因', async () => {
    const BM = {
      restoreTrashItems: vi.fn().mockResolvedValue({
        restored: 0,
        failed: [{ id: 'a', error: '书签删除仍在进行，请稍后重试' }]
      })
    };
    const toast = vi.fn();
    const refresh = vi.fn();
    const undoDelete = eval(`(${getFunctionSource('undoDelete')})`);

    await undoDelete([{ id: 'a' }]);

    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('书签删除仍在进行，请稍后重试'),
      'warn'
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('恢复接口抛错时提示失败原因', async () => {
    const BM = { restoreTrashItems: vi.fn().mockRejectedValue(new Error('回收站后台服务不可用')) };
    const toast = vi.fn();
    const refresh = vi.fn();
    const console = { warn: vi.fn() };
    const undoDelete = eval(`(${getFunctionSource('undoDelete')})`);

    await undoDelete([{ id: 'a' }]);

    expect(toast).toHaveBeenCalledWith('撤销失败：回收站后台服务不可用', 'danger');
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('删除失败的可见性', () => {
  it('全部书签都没能移除时给出失败提示', async () => {
    const getItemById = id => ({ id, title: 't', url: 'https://x.example/', parentId: 'f' });
    const BM = {
      addToTrash: vi.fn().mockResolvedValue(2),
      completeTrashDelete: vi.fn().mockResolvedValue(),
      touchTrashDelete: vi.fn().mockResolvedValue()
    };
    const removeForIds = vi.fn().mockResolvedValue({ count: 0, removedIds: [] });
    const pruneDuplicateEmptyFolders = vi.fn();
    const toast = vi.fn();
    const console = { warn: vi.fn() };
    const TRASH_DELETE_HEARTBEAT_INTERVAL_MS = 5000;
    let trashRestoreInProgress = false;
    const softDelete = eval(`(${getFunctionSource('softDelete')})`);

    const result = await softDelete(['a', 'b'], '删除中');

    expect(result).toEqual({ n: 0, items: [], prunedFolders: 0 });
    expect(toast).toHaveBeenCalledWith('删除失败：书签未能从浏览器移除，请重试', 'danger');
    // 失败项不能留在回收站里冒充「可恢复的删除」
    expect(BM.completeTrashDelete).toHaveBeenCalledWith([], ['a', 'b']);
  });
});

describe('新标签页撤销竞态', () => {
  it('撤销等待删除收尾，完成后清理视图状态，避免长时间残留删除 ID', async () => {
    const harness = await new Function(`
      return (async () => {
        const pendingDeletes = new Set(['a']);
        const completedDeletes = new Set(['a']);
        const finalizeDeletes = new Map();
        ${getNewtabFunctionSource('clearDeleteViewState')}
        ${getNewtabFunctionSource('trackDeleteFinalize')}
        ${getNewtabFunctionSource('waitDeleteFinalize')}
        return { pendingDeletes, completedDeletes, finalizeDeletes, trackDeleteFinalize, waitDeleteFinalize };
      })();
    `)();
    let resolveFinalize;
    const task = new Promise(resolve => {
      resolveFinalize = resolve;
    });

    harness.trackDeleteFinalize('a', task);
    let waitCompleted = false;
    const waiting = harness.waitDeleteFinalize('a').then(() => {
      waitCompleted = true;
    });
    await Promise.resolve();
    expect(waitCompleted).toBe(false);
    expect(harness.pendingDeletes.has('a')).toBe(true);
    expect(harness.finalizeDeletes.has('a')).toBe(true);

    resolveFinalize();
    await waiting;

    expect(harness.pendingDeletes.has('a')).toBe(false);
    expect(harness.completedDeletes.has('a')).toBe(false);
    expect(harness.finalizeDeletes.has('a')).toBe(false);
  });

  it('撤销前等待删除收尾，避免被后台判为「删除仍在进行」', () => {
    expect(newtabSource).toContain('function trackDeleteFinalize(id, task)');
    expect(newtabSource).toContain('async function waitDeleteFinalize(id)');
    // 只登记「回收站确认」这一步：标签清理继续后台收尾，不拖住撤销
    expect(newtabSource).toContain('trackDeleteFinalize(it.id, confirmDelete);');
    expect(newtabSource).toContain('void confirmDelete.then(');
    const waitAt = newtabSource.indexOf('await waitDeleteFinalize(it.id);');
    const restoreAt = newtabSource.indexOf('restoreTrashItems([{ id: it.id }])');
    expect(waitAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(waitAt);
  });

  it('恢复失败时展示后台给出的原因，而不是笼统的「可能已被永久删除」', () => {
    expect(newtabSource).toContain("(r.failed[0] && r.failed[0].error) || '该记录可能已被永久删除'");
    expect(newtabSource).not.toContain("showToast(\n              r.restored ? '已恢复书签 ✓' : '恢复失败：该记录可能已被永久删除',");
  });
});
