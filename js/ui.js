/* =========================================================
   书签管家 · 共享 UI 原语（popup / newtab / options 三页共用）
   —— 提供：弹层焦点陷阱、统一 tooltip、分级 toast、快捷键注册表
   依赖：无（纯原生 DOM），加载顺序：lib.js → ui.js → 页面脚本
   ========================================================= */
(function () {
  'use strict';
  if (window.UI) return;

  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function isVisible(el) {
    return !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter(function (el) {
      return !el.disabled && el.tabIndex !== -1 && (isVisible(el) || el === document.activeElement);
    });
  }

  // ---------- 焦点陷阱（弹层 / 抽屉共用） ----------
  var traps = new Map();
  var trapStack = []; // 打开顺序：仅最上层陷阱参与 Tab 循环，多层弹层不互相抢焦点
  var escapeStack = [];

  function topTrap() {
    return trapStack.length ? trapStack[trapStack.length - 1] : null;
  }

  function onDocumentKeydown(e) {
    if (e.key !== 'Escape') return;
    // 后进先出：返回 false 表示「未消费」，继续交给下一层（tooltip 等非阻塞处理器）
    for (var i = escapeStack.length - 1; i >= 0; i -= 1) {
      if (escapeStack[i](e) === false) continue;
      e.preventDefault();
      return;
    }
  }

  function moveFocus(el) {
    if (!el || typeof el.focus !== 'function') return;
    el.focus();
    // 弹层刚从 hidden 切回可见时 offsetParent 仍为 null，下一帧再试一次
    if (document.activeElement !== el) {
      requestAnimationFrame(function () {
        if (document.activeElement !== el) el.focus();
      });
    }
  }

  function focusTrap(container, opts) {
    opts = opts || {};
    if (!container) return function () {};
    var existing = traps.get(container);
    if (existing) existing.release({ restore: false });

    var state = {
      trigger: opts.restoreFocusTo || document.activeElement,
      onEscape: opts.onEscape || null
    };

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      // 监听挂在 document（捕获阶段），因此必须自行判断是否为最上层陷阱
      if (topTrap() !== container) return;
      var list = focusables(container);
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      var active = document.activeElement;
      if (!container.contains(active)) {
        e.preventDefault();
        moveFocus(first);
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        moveFocus(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        moveFocus(first);
      }
    }

    function escapeToken() {
      // 返回 false 表示未消费，由栈内下一层继续处理（onDocumentKeydown 依此判定）
      var consumed = state.onEscape ? state.onEscape() : undefined;
      return consumed === false ? false : true;
    }

    function release(options) {
      var settings = options || {};
      document.removeEventListener('keydown', onKeydown, true);
      var stackIndex = trapStack.indexOf(container);
      if (stackIndex >= 0) trapStack.splice(stackIndex, 1);
      var index = escapeStack.indexOf(escapeToken);
      if (index >= 0) escapeStack.splice(index, 1);
      var current = traps.get(container);
      if (current && current.release === release) traps.delete(container);
      if (settings.restore !== false && state.trigger && document.contains(state.trigger)) {
        if (typeof state.trigger.focus === 'function') state.trigger.focus();
      }
    }

    // 挂 document（捕获）而非 container：焦点被点击/脚本移出弹层后，Tab 仍会被拦回
    document.addEventListener('keydown', onKeydown, true);
    trapStack.push(container);
    escapeStack.push(escapeToken);
    traps.set(container, { release: release });

    if (opts.autofocus !== false) moveFocus(opts.initialFocus || focusables(container)[0] || container);
    return release;
  }

  function releaseTrap(container, options) {
    var entry = traps.get(container);
    if (entry) entry.release(options);
  }

  // Esc 处理器栈：后进先出；返回函数可注销
  function onEscape(handler) {
    escapeStack.push(handler);
    return function () {
      var index = escapeStack.indexOf(handler);
      if (index >= 0) escapeStack.splice(index, 1);
    };
  }

  // ---------- 统一 Tooltip（150ms 延迟 / 自动翻转 / Esc 关闭） ----------
  var tipEl = null;
  var tipTimer = null;
  var tipOwner = null;
  var TIP_DELAY = 150;

  function ensureTip() {
    if (tipEl && document.body.contains(tipEl)) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'ui-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function placeTip(el) {
    var tip = ensureTip();
    var rect = el.getBoundingClientRect();
    var tipRect = tip.getBoundingClientRect();
    var gap = 8;
    var above = rect.top - tipRect.height - gap >= 8;
    var top = above ? rect.top - tipRect.height - gap : rect.bottom + gap;
    var left = rect.left + rect.width / 2 - tipRect.width / 2;
    var maxLeft = window.innerWidth - tipRect.width - 8;
    tip.style.left = Math.max(8, Math.min(left, Math.max(8, maxLeft))) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function showTip(el) {
    var text = el.getAttribute('data-tip');
    if (!text) return;
    tipOwner = el;
    var tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('is-open');
    placeTip(el);
  }

  function hideTip() {
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
    tipOwner = null;
    if (tipEl) tipEl.classList.remove('is-open');
  }

  function scheduleTip(el) {
    hideTip();
    // 立即接管所有权：指针在 150ms 内移出时，mouseout 才能匹配 tipOwner 并取消延迟显示
    tipOwner = el;
    tipTimer = setTimeout(function () {
      tipTimer = null;
      if (document.contains(el)) showTip(el);
    }, TIP_DELAY);
  }

  // 幂等：三页各自在初始化时调用一次；重复调用不得重复绑定全局监听，
  // 否则 Esc 会被 onDocumentKeydown 多消费一次，弹层被连续关闭两次。
  var tipEventsBound = false;

  function bindTipEvents() {
    if (tipEventsBound) return;
    tipEventsBound = true;
    document.addEventListener('mouseover', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el) scheduleTip(el);
      else if (tipOwner) hideTip();
    });
    document.addEventListener('focusin', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el) scheduleTip(el);
      else if (tipOwner) hideTip();
    });
    document.addEventListener('mouseout', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el && el === tipOwner) hideTip();
    });
    document.addEventListener('focusout', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el && el === tipOwner) hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
    // 返回 false：tooltip 不消费 Esc，页面级 Escape 语义（退出文件夹 / 关菜单）仍可生效
    onEscape(function () {
      hideTip();
      return false;
    });
    document.addEventListener('keydown', onDocumentKeydown);
  }
  // ---------- 分级 Toast（ok / info / warn / danger） ----------
  var LEVELS = { ok: 'ok', info: 'info', warn: 'warn', danger: 'danger' };

  function normalizeLevel(level) {
    if (level === true) return 'danger';
    if (typeof level !== 'string' || !level) return 'ok';
    return LEVELS[level] || 'ok';
  }

  function toastHost() {
    var host = document.getElementById('toasts');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'ui-toast-host';
    document.body.appendChild(host);
    return host;
  }

  function toast(msg, level, action) {
    var host = toastHost();
    var kind = normalizeLevel(level);
    var el = document.createElement('div');
    el.className = 'toast ' + kind;
    var alert = kind === 'danger' || kind === 'warn';
    el.setAttribute('role', alert ? 'alert' : 'status');
    el.setAttribute('aria-live', alert ? 'assertive' : 'polite');
    var text = document.createElement('span');
    text.textContent = String(msg == null ? '' : msg);
    el.appendChild(text);
    if (action && action.label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-act';
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        el.remove();
        if (action.onClick) action.onClick();
      });
      el.appendChild(btn);
    }
    host.appendChild(el);
    setTimeout(
      function () {
        el.classList.add('toast-out');
        setTimeout(function () {
          el.remove();
        }, 320);
      },
      action ? 10000 : 2500
    );
    return el;
  }

  // ---------- 快捷键注册表（帮助抽屉据此生成，避免文档与实现漂移） ----------
  var shortcuts = [];

  function registerShortcut(entry) {
    if (!entry || !entry.keys || !entry.desc) return;
    shortcuts.push({ keys: entry.keys, desc: entry.desc, group: entry.group || '键盘快捷键' });
  }

  function shortcutHtml(list) {
    var groups = {};
    var order = [];
    (list || shortcuts).forEach(function (item) {
      if (!groups[item.group]) {
        groups[item.group] = [];
        order.push(item.group);
      }
      groups[item.group].push(item);
    });
    return order
      .map(function (group) {
        var rows = groups[group]
          .map(function (item) {
            return '<div class="help-item"><b>' + item.keys + '</b> ' + item.desc + '</div>';
          })
          .join('');
        return '<div class="help-group-title">' + group + '</div>' + rows;
      })
      .join('');
  }

  window.UI = {
    focusable: focusables,
    focusTrap: focusTrap,
    releaseTrap: releaseTrap,
    onEscape: onEscape,
    showTip: showTip,
    hideTip: hideTip,
    initTooltip: bindTipEvents,
    hasOpenTrap: function () {
      return trapStack.length > 0;
    },
    toast: toast,
    normalizeLevel: normalizeLevel,
    registerShortcut: registerShortcut,
    shortcuts: shortcuts,
    shortcutHtml: shortcutHtml
  };
})();
