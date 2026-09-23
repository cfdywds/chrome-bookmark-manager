/**
 * 管理面板打开即聚焦搜索框的回归
 *
 * 背景：面板宿主是侧边栏（点扩展图标 / 新标签页的「打开管理面板」）与独立标签页
 * （新标签页的「在独立标签页中打开管理界面」）。两者打开后都会把键盘焦点交给文档，
 * 但 Chrome 在面板刚加载的一瞬间可能仍把焦点留在浏览器 UI（地址栏 / 工具栏），
 * 此时页面的 focus() 会被忽略——所以只写 autofocus 不够，必须有时间窗重试，
 * 以及「用户一旦接管就立即停止」的约束，否则面板会在用户已经点开弹层或开始编辑后
 * 把光标抢回搜索框。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const popupHtml = readFileSync(join(root, 'popup.html'), 'utf-8');
const popupSource = readFileSync(join(root, 'js', 'popup.js'), 'utf-8');

// 按缩进取完整函数体（源码为 CRLF，顶层函数收尾行形如 "\r\n}\r\n"）
function bodyOf(source, signature, indent = '  ') {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`未找到源码片段：${signature}`);
  const rest = source.slice(start);
  const end = new RegExp(`\\r?\\n${indent}\\}\\r?\\n`).exec(rest);
  if (!end) throw new Error(`未找到函数收尾：${signature}`);
  return rest.slice(0, end.index + end[0].length);
}

const focusBody = bodyOf(popupSource, 'function focusSearchOnOpen()', '');
const armBody = bodyOf(popupSource, 'function armSearchAutofocus()', '');
const stopBody = bodyOf(popupSource, 'function stopSearchAutofocus()', '');
const setupBody = bodyOf(popupSource, 'function setupSearchAutofocus()', '');
const initBody = bodyOf(popupSource, 'async function init()', '');

describe('管理面板打开即聚焦搜索框', () => {
  it('搜索框带 autofocus（宿主支持时零延迟生效）', () => {
    const at = popupHtml.indexOf('id="searchInput"');
    expect(at).toBeGreaterThan(-1);
    const inputTag = popupHtml.slice(at, popupHtml.indexOf('/>', at));
    expect(inputTag).toContain('autofocus');
  });

  it('以「文档持有焦点且焦点就在搜索框」为成功判据，不只看 activeElement', () => {
    expect(focusBody).toContain('document.hasFocus()');
    expect(focusBody).toContain('document.activeElement !== input');
  });

  it('聚焦不抢滚动位置，框内已有内容时全选', () => {
    expect(focusBody).toContain('preventScroll: true');
    expect(focusBody).toContain('input.select()');
  });

  it('按时间窗重试，覆盖面板刚打开、文档还没拿到键盘焦点的瞬间', () => {
    expect(armBody).toMatch(/\[\s*0\s*,/);
    expect(armBody).toContain('setTimeout(focusSearchOnOpen');
    // 重新武装前必须清掉上一轮定时器，避免侧边栏反复开关时堆积
    expect(armBody).toContain('clearTimeout');
  });

  it('用户点击或按键后立即停止抢焦点', () => {
    expect(stopBody).toContain('searchAutofocusStopped = true');
    expect(setupBody).toContain(
      "document.addEventListener('pointerdown', stopSearchAutofocus, { capture: true })"
    );
    expect(setupBody).toContain(
      "document.addEventListener('keydown', stopSearchAutofocus, { capture: true })"
    );
    // 不能用 once：文档被复用后重新武装时，同一次交互仍要能叫停
    expect(setupBody).not.toContain('once: true');
  });

  it('文档被复用（不重跑 init）时靠再次可见重新武装，但不抢用户正在编辑的焦点', () => {
    expect(setupBody).toContain("document.addEventListener('visibilitychange'");
    expect(setupBody).toContain("document.visibilityState !== 'visible'");
    expect(setupBody).toContain('isEditableElement(document.activeElement)');
    expect(setupBody).toContain('searchAutofocusStopped = false');
  });

  it('初始化时立刻武装，不等首轮书签分析完成', () => {
    const callIdx = initBody.indexOf('setupSearchAutofocus();');
    const firstAwait = initBody.indexOf('await ');
    expect(callIdx).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(firstAwait);
  });
});
