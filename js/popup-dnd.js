// ===== 书签管家 · 侧边栏拖拽排序模块 (popup-dnd.js) =====
(function (global) {
  'use strict';

  const FLIP_DURATION_MS = 200;
  let dragState = null;

  function flipKey(el) {
    if (el.classList.contains('group-head')) {
      const group = el.closest('.group');
      return 'head:' + ((group && group.dataset.group) || '');
    }
    return 'row:' + ((el.dataset && el.dataset.id) || '');
  }

  // 记录可投放元素的当前位置（首）
  function flipSnapshot() {
    const map = new Map();
    document
      .querySelectorAll('#content .row.clickable.draggable, #content .group-head')
      .forEach(el => {
        const rect = el.getBoundingClientRect();
        map.set(flipKey(el), { top: rect.top, left: rect.left });
      });
    return map;
  }

  // 与投放后的位置比较，对发生位移的元素播放 transform 过渡（末）
  function playFlip(before) {
    if (!before || !before.size || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      document
        .querySelectorAll('#content .row.clickable.draggable, #content .group-head')
        .forEach(el => {
          const prev = before.get(flipKey(el));
          if (!prev) return;
          const rect = el.getBoundingClientRect();
          const dx = prev.left - rect.left;
          const dy = prev.top - rect.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          el.style.transition = 'none';
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          requestAnimationFrame(() => {
            el.classList.add('flip-in');
            el.style.transition = 'transform ' + FLIP_DURATION_MS + 'ms ease';
            el.style.transform = '';
            setTimeout(() => {
              el.classList.remove('flip-in');
              el.style.transition = '';
            }, FLIP_DURATION_MS + 40);
          });
        });
    });
  }

  function clearDragHints() {
    document
      .querySelectorAll(
        '#content .drop-before, #content .drop-after, #content .drop-inside, #content .drop-target, #content .group.drag-target'
      )
      .forEach(el =>
        el.classList.remove(
          'drop-before',
          'drop-after',
          'drop-inside',
          'drop-target',
          'drag-target'
        )
      );
  }

  const dsFromSameParent = (a, b) => String(a) === String(b);

  function bindDrag(ctx) {
    const contentEl = ctx.contentEl || document.querySelector('#content');
    if (!contentEl) return;
    const { getData, getItemById, getCurrentTab, getOrgView, toast, refresh, ensureFolder } = ctx;

    contentEl.addEventListener('dragstart', e => {
      const handle = e.target.closest('.drag-handle');
      const row = handle ? handle.closest('.row.clickable.draggable') : null;
      if (!row || !row.dataset.id) return;
      const id = row.dataset.id;
      const DATA = getData();
      if (row.dataset.type === 'folder') {
        const node = DATA.folderTree && DATA.folderTree.folderById.get(id);
        if (!node) return;
        dragState = { id, type: 'folder', fromParent: node.parentId };
      } else {
        const it = getItemById(id);
        if (!it) return;
        dragState = { id, type: 'bookmark', fromParent: it.parentId };
      }
      try {
        e.dataTransfer.setData('text/plain', id);
      } catch (err) {
        /* ignore */
      }
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });

    contentEl.addEventListener('dragend', () => {
      clearDragHints();
      dragState = null;
      contentEl.querySelectorAll('.row.dragging').forEach(row => row.classList.remove('dragging'));
    });

    contentEl.addEventListener('dragover', e => {
      const row = e.target.closest('.row.clickable.draggable');
      const head = e.target.closest('.group-head');
      if (!row && !head) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDragHints();
      if (row) {
        const rect = row.getBoundingClientRect();
        const isFolderRow = row.dataset.type === 'folder';
        row.classList.add('drop-target');
        if (isFolderRow && dragState && dragState.type === 'folder') {
          row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
        } else if (isFolderRow) {
          row.classList.add('drop-inside');
        } else {
          row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
        }
      } else if (head) {
        head.classList.add('drop-target');
        head.closest('.group').classList.add('drag-target');
      }
    });

    async function dropOntoRow(row, drag) {
      if (!drag) return;
      const targetIt = getItemById(row.dataset.id);
      if (!targetIt) return;
      const children = await chrome.bookmarks.getChildren(targetIt.parentId);
      let index = children.findIndex(c => c.id === targetIt.id);
      if (dsFromSameParent(drag.fromParent, targetIt.parentId)) {
        const fromIndex = children.findIndex(c => c.id === drag.id);
        if (fromIndex >= 0 && fromIndex < index) index -= 1;
      }
      await chrome.bookmarks.move(drag.id, {
        parentId: targetIt.parentId,
        index: index < 0 ? 0 : index
      });
      toast('已移动书签 ✓', 'ok');
    }

    async function dropOntoGroup(head, drag) {
      if (!drag) return;
      const group = head.closest('.group');
      const gkey = group.dataset.group;
      const gnameEl = head.querySelector('.g-name');
      const name = gnameEl ? gnameEl.textContent : '';
      if (!gkey || !name) {
        toast('该分组不支持拖入', 'warn');
        return;
      }
      if (gkey.startsWith('tag-')) {
        const tag = name.replace(/^#/, '').trim();
        const BM = global.BM || {};
        if (!tag || tag === BM.FALLBACK_TAG) {
          toast('该标签不支持拖入', 'warn');
          return;
        }
        if (drag.type === 'folder') {
          toast('文件夹不能加标签，请在文件夹视图操作', 'warn');
          return;
        }
        await BM.persistTagChanges({ [drag.id]: [tag] }, 'merge');
        toast('已加标签 #' + tag + ' ✓', 'ok');
        refresh();
        return;
      }
      let folderTitle;
      if (gkey.startsWith('exact-')) folderTitle = name;
      else if (gkey.startsWith('cat-')) folderTitle = '书签管家·' + name;
      else {
        toast('该分组不支持拖入', 'warn');
        return;
      }
      const folderId = await ensureFolder(folderTitle);
      await chrome.bookmarks.move(drag.id, { parentId: folderId });
      toast('已移动到「' + name + '」✓', 'ok');
    }

    async function dropFolderOntoTarget(targetId, drag) {
      let targetParentId, targetNodeId;
      const DATA = getData();
      const folderNode = DATA.folderTree && DATA.folderTree.folderById.get(targetId);
      if (folderNode) {
        targetParentId = folderNode.parentId;
        targetNodeId = targetId;
      } else {
        const it = getItemById(targetId);
        if (!it) return;
        targetParentId = it.parentId;
        targetNodeId = targetId;
      }
      if (String(drag.id) === String(targetParentId)) {
        toast('不能移动到原位置', 'warn');
        return;
      }
      const children = await chrome.bookmarks.getChildren(targetParentId);
      let index = children.findIndex(c => String(c.id) === String(targetNodeId));
      if (index < 0) index = 0;
      if (String(drag.fromParent) === String(targetParentId)) {
        const fromIndex = children.findIndex(c => String(c.id) === String(drag.id));
        if (fromIndex >= 0 && fromIndex < index) index -= 1;
      }
      if (index < 0) index = 0;
      await chrome.bookmarks.move(drag.id, { parentId: targetParentId, index });
      toast('已移动文件夹 ✓', 'ok');
    }

    async function dropBookmarkIntoFolder(folderId, drag) {
      const DATA = getData();
      const node = DATA.folderTree && DATA.folderTree.folderById.get(folderId);
      if (!node) return;
      if (String(drag.id) === String(folderId)) return;
      await chrome.bookmarks.move(drag.id, { parentId: folderId });
      toast('已移入「' + node.title + '」 ✓', 'ok');
    }

    async function dropInheritTags(row, drag) {
      if (!drag) return;
      const targetIt = getItemById(row.dataset.id);
      if (!targetIt) return;
      const BM = global.BM || {};
      const targetTags = (targetIt.tags || []).filter(t => t && t !== BM.FALLBACK_TAG);
      if (!targetTags.length) {
        toast('目标书签无可继承的标签', 'warn');
        return;
      }
      await BM.persistTagChanges({ [drag.id]: targetTags }, 'merge');
      toast('已继承 ' + targetTags.length + ' 个标签 ✓', 'ok');
      refresh();
    }

    contentEl.addEventListener('drop', async e => {
      e.preventDefault();
      const drag = dragState;
      if (!drag) return;
      const flipBefore = flipSnapshot();
      const row = e.target.closest('.row.clickable.draggable');
      const head = e.target.closest('.group-head');
      const currentTab = getCurrentTab();
      const ORG_VIEW = getOrgView();
      try {
        if (currentTab === 'organize' && ORG_VIEW === 'tags' && drag.type === 'bookmark') {
          if (head) await dropOntoGroup(head, drag);
          else if (row && row.dataset.id !== drag.id) await dropInheritTags(row, drag);
        } else if (row && row.dataset.id !== drag.id) {
          const isFolderRow = row.dataset.type === 'folder';
          if (isFolderRow && drag.type === 'folder')
            await dropFolderOntoTarget(row.dataset.id, drag);
          else if (isFolderRow) await dropBookmarkIntoFolder(row.dataset.id, drag);
          else if (drag.type === 'folder') await dropFolderOntoTarget(row.dataset.id, drag);
          else await dropOntoRow(row, drag);
        } else if (head) {
          await dropOntoGroup(head, drag);
        }
      } catch (err) {
        toast('移动失败：' + (err.message || err), 'danger');
        try {
          if (global.BM && typeof global.BM.logError === 'function') {
            global.BM.logError('drag', err);
          }
        } catch (e2) {
          /* ignore */
        }
      } finally {
        dragState = null;
        clearDragHints();
        refresh()
          .then(() => playFlip(flipBefore))
          .catch(() => {});
      }
    });
  }

  global.BMPopupDnd = {
    bindDrag,
    flipSnapshot,
    playFlip,
    clearDragHints
  };
})(typeof window !== 'undefined' ? window : globalThis);
