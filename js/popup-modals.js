// ===== 书签管家 · 侧边栏模态弹层与进度模块 (popup-modals.js) =====
(function (global) {
  'use strict';

  let activeProgressCancel = null;

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const wrap = document.querySelector('#confirmWrap');
      if (!wrap) {
        resolve(false);
        return;
      }
      const restoreFocusTo = document.activeElement;
      document.querySelector('#confirmTitle').textContent = opts.title || '确认操作？';
      document.querySelector('#confirmMsg').innerHTML = opts.message || '';
      const yes = document.querySelector('#confirmYes');
      yes.textContent = opts.confirmText || '确认';
      yes.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
      const third = document.querySelector('#confirmThird');
      if (opts.thirdText) {
        third.textContent = opts.thirdText;
        third.classList.remove('hidden');
      } else {
        third.classList.add('hidden');
      }
      const fourth = document.querySelector('#confirmFourth');
      if (opts.fourthText) {
        fourth.textContent = opts.fourthText;
        fourth.classList.remove('hidden');
      } else {
        fourth.classList.add('hidden');
      }
      const no = document.querySelector('#confirmNo');
      let releaseTrap = null;
      let settled = false;
      const onWrapClick = e => {
        if (e.target === wrap) done(false);
      };
      const done = v => {
        if (settled) return;
        settled = true;
        wrap.classList.add('hidden');
        yes.onclick = no.onclick = third.onclick = fourth.onclick = null;
        wrap.removeEventListener('click', onWrapClick);
        wrap.removeEventListener('keydown', onKey);
        if (typeof releaseTrap === 'function') releaseTrap();
        else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
        resolve(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done(false);
          return;
        }
        if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) {
          done(true);
        }
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      if (opts.thirdText) third.onclick = () => done('third');
      if (opts.fourthText) fourth.onclick = () => done('fourth');
      wrap.addEventListener('click', onWrapClick);
      wrap.addEventListener('keydown', onKey);
      wrap.classList.remove('hidden');
      if (global.UI)
        releaseTrap = global.UI.focusTrap(wrap, {
          onEscape: () => done(false),
          autofocus: false,
          restoreFocusTo
        });
      yes.focus();
    });
  }

  function promptDialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const wrap = document.querySelector('#promptWrap');
      if (!wrap) {
        resolve(null);
        return;
      }
      const restoreFocusTo = document.activeElement;
      document.querySelector('#promptTitle').textContent = opts.title || '输入';
      document.querySelector('#promptMsg').textContent = opts.message || '';
      const input = document.querySelector('#promptInput');
      input.value = opts.value || '';
      input.placeholder = opts.placeholder || '输入内容…';
      const yes = document.querySelector('#promptYes');
      const no = document.querySelector('#promptNo');
      let releaseTrap = null;
      let settled = false;
      const onWrapClick = e => {
        if (e.target === wrap) done(null);
      };
      const done = v => {
        if (settled) return;
        settled = true;
        wrap.classList.add('hidden');
        yes.onclick = no.onclick = null;
        wrap.removeEventListener('click', onWrapClick);
        wrap.removeEventListener('keydown', onKey);
        if (typeof releaseTrap === 'function') releaseTrap();
        else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
        resolve(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done(null);
          return;
        }
        if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) {
          done(input.value.trim() || null);
        }
      };
      yes.onclick = () => done(input.value.trim() || null);
      no.onclick = () => done(null);
      wrap.addEventListener('click', onWrapClick);
      wrap.addEventListener('keydown', onKey);
      wrap.classList.remove('hidden');
      if (global.UI)
        releaseTrap = global.UI.focusTrap(wrap, {
          onEscape: () => done(null),
          autofocus: false,
          restoreFocusTo
        });
      input.focus();
      input.select();
    });
  }

  function startProgress(label, opts) {
    opts = opts || {};
    const w = document.querySelector('#progressWrap');
    if (!w) return;
    w.classList.remove('hidden');
    const bar = document.querySelector('#progressBar');
    if (bar) bar.style.width = '0%';
    const lbl = document.querySelector('#progressLabel');
    if (lbl) lbl.textContent = label || '处理中…';
    const cancel = document.querySelector('#progressCancel');
    if (!cancel) return;
    activeProgressCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;
    if (activeProgressCancel) {
      cancel.textContent = opts.cancelText || '终止';
      cancel.disabled = false;
      cancel.classList.remove('hidden');
      cancel.onclick = () => {
        if (!activeProgressCancel) return;
        activeProgressCancel();
        cancel.disabled = true;
        cancel.textContent = '终止中…';
      };
    } else {
      cancel.onclick = null;
      cancel.classList.add('hidden');
    }
  }

  function updateProgress(pct, label) {
    const bar = document.querySelector('#progressBar');
    if (bar) {
      bar.style.width = pct + '%';
      const container = bar.parentElement;
      if (container) container.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    if (label) {
      const lbl = document.querySelector('#progressLabel');
      if (lbl) lbl.textContent = label;
    }
  }

  function endProgress() {
    const w = document.querySelector('#progressWrap');
    if (w) w.classList.add('hidden');
    const cancel = document.querySelector('#progressCancel');
    if (cancel) {
      cancel.onclick = null;
      cancel.disabled = false;
      cancel.classList.add('hidden');
    }
    activeProgressCancel = null;
  }

  global.BMPopupModals = {
    confirmDialog,
    promptDialog,
    startProgress,
    updateProgress,
    endProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
