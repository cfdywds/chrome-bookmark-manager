import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiSource = readFileSync(join(__dirname, '..', 'js', 'ui.js'), 'utf-8').replace(/\r\n/g, '\n');

// ---------- 极简 DOM 替身：ui.js 只依赖少量 DOM API，无需 jsdom ----------
function createElement(name) {
  const listeners = Object.create(null);
  const el = {
    name,
    tagName: name.toUpperCase(),
    tabIndex: 0,
    disabled: false,
    offsetParent: {},
    id: '',
    focused: 0,
    attrs: Object.create(null),
    focusable: [],
    children: [],
    listeners,
    getClientRects: () => [{}],
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(el.attrs, key) ? el.attrs[key] : null;
    },
    setAttribute(key, value) {
      el.attrs[key] = String(value);
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      listeners[type] = (listeners[type] || []).filter(entry => entry !== handler);
    },
    contains(node) {
      return node === el || el.children.indexOf(node) >= 0;
    },
    querySelectorAll() {
      return el.focusable;
    },
    focus() {
      el.focused += 1;
      doc.activeElement = el;
    },
    getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 10, width: 80 }),
    style: {},
    textContent: '',
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {
      el.removed = true;
    },
    classList: {
      value: new Set(),
      add(className) {
        this.value.add(className);
      },
      remove(className) {
        this.value.delete(className);
      },
      toggle(className, force) {
        const on = force === undefined ? !this.value.has(className) : !!force;
        if (on) this.value.add(className);
        else this.value.delete(className);
        return on;
      },
      contains(className) {
        return this.value.has(className);
      }
    }
  };
  return el;
}

// 可控计时器：runTimers() 手动推进，用于验证 150ms 延迟提示的取消逻辑
const timers = [];
const fakeSetTimeout = (callback, delay) => {
  timers.push({ callback, delay, cleared: false });
  return timers.length;
};
const fakeClearTimeout = id => {
  const timer = timers[id - 1];
  if (timer) timer.cleared = true;
};
function runTimers() {
  const pending = timers.splice(0, timers.length);
  pending.forEach(timer => {
    if (!timer.cleared) timer.callback();
  });
}

const doc = createElement('#document');
doc.body = {
  children: [],
  appendChild(el) {
    doc.body.children.push(el);
    return el;
  },
  contains: () => true
};
doc.createElement = tag => createElement(tag);
doc.getElementById = () => null;
doc.contains = () => true;

function loadUI() {
  const win = { innerWidth: 1200, listeners: Object.create(null) };
  win.addEventListener = (type, handler) => {
    (win.listeners[type] = win.listeners[type] || []).push(handler);
  };
  const factory = new Function(
    'window',
    'document',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    uiSource
  );
  factory(win, doc, handler => handler(), fakeSetTimeout, fakeClearTimeout);
  return win.UI;
}

const UI = loadUI();
UI.initTooltip();

function keyEvent(key, extra) {
  return Object.assign({ key, preventDefault: vi.fn(), shiftKey: false, target: doc }, extra || {});
}

function dispatchDocumentKeydown(event) {
  (doc.listeners.keydown || []).forEach(handler => handler(event));
}

describe('共享 UI 原语', () => {
  it('导出焦点陷阱 / tooltip / toast / 快捷键注册表', () => {
    expect(typeof UI.focusTrap).toBe('function');
    expect(typeof UI.releaseTrap).toBe('function');
    expect(typeof UI.onEscape).toBe('function');
    expect(typeof UI.initTooltip).toBe('function');
    expect(typeof UI.toast).toBe('function');
    expect(typeof UI.registerShortcut).toBe('function');
    expect(typeof UI.shortcutHtml).toBe('function');
  });

  it('toast 级别归一化：布尔与未知值都有稳定兜底', () => {
    expect(UI.normalizeLevel('danger')).toBe('danger');
    expect(UI.normalizeLevel('warn')).toBe('warn');
    expect(UI.normalizeLevel('info')).toBe('info');
    expect(UI.normalizeLevel(true)).toBe('danger');
    expect(UI.normalizeLevel(undefined)).toBe('ok');
    expect(UI.normalizeLevel('unexpected')).toBe('ok');
  });

  it('compact toast 使用短样式和短停留时间', () => {
    const toast = UI.toast('已隐藏', 'ok', undefined, { compact: true });
    expect(toast.className).toContain('toast ok compact');
    expect(timers[timers.length - 1].delay).toBe(1700);
  });

  it('快捷键注册表按分组渲染帮助文档，避免文档与实现漂移', () => {
    const html = UI.shortcutHtml([
      { keys: 'j / k', desc: '上下移动高亮行', group: '键盘快捷键' },
      { keys: 'Enter', desc: '打开高亮书签', group: '键盘快捷键' },
      { keys: '/', desc: '聚焦搜索框', group: '键盘快捷键' }
    ]);

    expect(html).toContain('<div class="help-group-title">键盘快捷键</div>');
    expect(html).toContain('<div class="help-item"><b>j / k</b> 上下移动高亮行</div>');
    expect(html).toContain('<div class="help-item"><b>Enter</b> 打开高亮书签</div>');
    expect((html.match(/help-group-title/g) || [])).toHaveLength(1);
    expect(UI.shortcutHtml([])).toBe('');
  });

  it('焦点陷阱在首尾元素之间循环 Tab，释放后归还焦点', () => {
    const trigger = createElement('trigger');
    const container = createElement('modal');
    const first = createElement('first');
    const last = createElement('last');
    container.focusable = [first, last];
    container.children = [first, last];
    doc.activeElement = trigger;

    const release = UI.focusTrap(container, { initialFocus: first });
    expect(doc.activeElement).toBe(first);

    // 末尾 + Tab → 回到首元素
    doc.activeElement = last;
    const forward = keyEvent('Tab');
    dispatchDocumentKeydown(forward);
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(first);

    // 首元素 + Shift+Tab → 回到末元素
    doc.activeElement = first;
    const backward = keyEvent('Tab', { shiftKey: true });
    dispatchDocumentKeydown(backward);
    expect(backward.preventDefault).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(last);

    // 焦点被点击 / 脚本移出弹层后（监听挂在 document 上），Tab 仍被拦回容器内
    doc.activeElement = trigger;
    const escaped = keyEvent('Tab');
    dispatchDocumentKeydown(escaped);
    expect(escaped.preventDefault).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(first);

    release();
    expect(doc.activeElement).toBe(trigger);
  });

  it('Esc 按栈顶优先消费：弹层先关，再轮到页面级快捷键', () => {
    const order = [];
    const offPageLevel = UI.onEscape(() => order.push('page'));
    const container = createElement('modal');
    container.focusable = [];
    const release = UI.focusTrap(container, { onEscape: () => order.push('modal') });

    dispatchDocumentKeydown(keyEvent('Escape'));
    expect(order).toEqual(['modal']);

    release();
    dispatchDocumentKeydown(keyEvent('Escape'));
    expect(order).toEqual(['modal', 'page']);

    offPageLevel();
    dispatchDocumentKeydown(keyEvent('Escape'));
    expect(order).toEqual(['modal', 'page']);
  });

  it('重复释放陷阱不会报错，也不会抢走焦点', () => {
    const container = createElement('modal');
    container.focusable = [];
    const release = UI.focusTrap(container);
    release();
    expect(() => UI.releaseTrap(container)).not.toThrow();
  });

  it('重复调用 initTooltip 不会重复绑定全局监听', () => {
    // 重复绑定会让 Esc 被 onDocumentKeydown 消费多次，弹层被连续关闭两次
    const before = (doc.listeners.keydown || []).length;
    expect(before).toBe(1);
    UI.initTooltip();
    UI.initTooltip();
    expect((doc.listeners.keydown || []).length).toBe(before);
  });

  it('多层弹层只有最上层陷阱处理 Tab', () => {
    const lower = createElement('lower');
    const upper = createElement('upper');
    const lowerFirst = createElement('lower-first');
    const upperFirst = createElement('upper-first');
    lower.focusable = [lowerFirst];
    lower.children = [lowerFirst];
    upper.focusable = [upperFirst];
    upper.children = [upperFirst];

    const releaseLower = UI.focusTrap(lower, { autofocus: false });
    const releaseUpper = UI.focusTrap(upper, { autofocus: false });

    doc.activeElement = createElement('outside');
    dispatchDocumentKeydown(keyEvent('Tab'));
    expect(doc.activeElement).toBe(upperFirst);

    releaseUpper();
    doc.activeElement = createElement('outside-2');
    dispatchDocumentKeydown(keyEvent('Tab'));
    expect(doc.activeElement).toBe(lowerFirst);
    releaseLower();
  });

  it('提示延迟窗口内移出后不再补弹（stale tooltip 回归）', () => {
    const target = createElement('a');
    target.attrs['data-tip'] = '提示文本';
    const hoverEvent = el => ({ target: { closest: () => el } });

    (doc.listeners.mouseover || []).forEach(handler => handler(hoverEvent(target)));
    (doc.listeners.mouseout || []).forEach(handler => handler(hoverEvent(target)));
    runTimers();

    const openTips = doc.body.children.filter(
      el => el.className === 'ui-tip' && el.classList.contains('is-open')
    );
    expect(openTips).toHaveLength(0);
  });

  it('指针停留超过延迟后显示提示，移出即隐藏', () => {
    const target = createElement('a');
    target.attrs['data-tip'] = '提示文本';
    const hoverEvent = el => ({ target: { closest: () => el } });

    (doc.listeners.mouseover || []).forEach(handler => handler(hoverEvent(target)));
    runTimers();

    const tipEl = doc.body.children.find(el => el.className === 'ui-tip');
    expect(tipEl).toBeTruthy();
    expect(tipEl.classList.contains('is-open')).toBe(true);
    expect(tipEl.textContent).toBe('提示文本');

    (doc.listeners.mouseout || []).forEach(handler => handler(hoverEvent(target)));
    expect(tipEl.classList.contains('is-open')).toBe(false);
  });

  it('无陷阱时 Esc 不被消费，有陷阱时由陷阱消费', () => {
    expect(UI.hasOpenTrap()).toBe(false);
    const idle = keyEvent('Escape');
    dispatchDocumentKeydown(idle);
    // 栈底只有「不消费 Esc」的 tooltip 处理器，页面级 Esc 语义应保持可用
    expect(idle.preventDefault).not.toHaveBeenCalled();

    const container = createElement('modal');
    container.focusable = [];
    const release = UI.focusTrap(container, { autofocus: false, onEscape: () => {} });
    expect(UI.hasOpenTrap()).toBe(true);

    const during = keyEvent('Escape');
    dispatchDocumentKeydown(during);
    expect(during.preventDefault).toHaveBeenCalledOnce();

    release();
    expect(UI.hasOpenTrap()).toBe(false);
  });
});
