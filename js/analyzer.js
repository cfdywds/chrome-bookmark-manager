// ===== 书签管家 · 分析引擎 (analyzer.js) =====
// 暴露 window.BMAnalyzer.analyze()
(async function () {
  'use strict';
  const BM = window.BM;
  const metadataCache = new Map();
  const ANALYZE_CHUNK_SIZE = 250;

  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

  function flatten(tree) {
    const items = [];
    function walk(nodes, path, inInternalTree) {
      for (const n of nodes) {
        const internal = inInternalTree || !!(BM.isNativeSyncRoot && BM.isNativeSyncRoot(n));
        if (internal) continue;
        if (n.url) {
          items.push({
            id: n.id,
            title: (n.title || '').trim() || n.url,
            url: n.url,
            path: path.slice(),
            parentId: n.parentId,
            dateAdded: n.dateAdded || 0
          });
        }
        if (n.children) {
          const np = n.title ? path.concat(n.title) : path;
          walk(n.children, np, internal);
        }
      }
    }
    walk(tree, [], false);
    return items;
  }

  function collectItemsAndEmptyFolders(tree) {
    const items = [];
    const emptyFolders = [];
    function walk(nodes, path, depth, inInternalTree) {
      let hasBookmark = false;
      for (const n of nodes) {
        const internal = inInternalTree || !!(BM.isNativeSyncRoot && BM.isNativeSyncRoot(n));
        // 同步目录本身不展示，但其父目录必须被视为非空，防止清理空文件夹时递归删除它。
        if (internal) {
          hasBookmark = true;
          continue;
        }
        if (n.url) {
          items.push({
            id: n.id,
            title: (n.title || '').trim() || n.url,
            url: n.url,
            path: path.slice(),
            parentId: n.parentId,
            dateAdded: n.dateAdded || 0
          });
          hasBookmark = true;
        }
        if (n.children) {
          const nextPath = n.title ? path.concat(n.title) : path;
          const childrenHaveBookmark = walk(n.children, nextPath, depth + 1, internal);
          // 根节点及其直属的书签栏/其他书签/移动设备是 Chrome 系统容器，不能删除。
          if (!n.url && !childrenHaveBookmark && depth > 1) {
            emptyFolders.push({ id: n.id, title: n.title || '(未命名)', path: nextPath });
          }
          if (childrenHaveBookmark) hasBookmark = true;
        }
      }
      return hasBookmark;
    }
    walk(tree, [], 0, false);
    return { items, emptyFolders };
  }

  function domainGroupsSignature() {
    const groups = BM.getDomainGroups ? (BM.getDomainGroups() || {}) : {};
    return Object.keys(groups).sort().map(key => key + '\u0000' + groups[key]).join('\u0001');
  }

  function getMetadata(url, title) {
    if (BM.getBookmarkMetadata) return BM.getBookmarkMetadata(url, title);
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { host = ''; }
    return {
      host,
      domain: BM.getRegisteredDomain(host),
      key: BM.urlKey(url),
      route: BM.routeKeyOf(url),
      category: BM.categorize(host, url, title),
      sensitive: BM.detectSensitive(host, url, title),
      searchText: (host + ' ' + url + ' ' + title).toLowerCase()
    };
  }

  async function analyze() {
    const tree = await chrome.bookmarks.getTree();
    const { items, emptyFolders } = collectItemsAndEmptyFolders(tree);

    // 配置相互独立；并行加载可缩短首次扫描的 storage 等待时间。
    await Promise.all([
      Promise.resolve().then(() => BM.loadDomainGroups()).catch(() => {}),
      Promise.resolve().then(() => BM.loadTags()).catch(() => {}),
      Promise.resolve().then(() => BM.loadFixedTags()).catch(() => {}),
      Promise.resolve().then(() => BM.loadTagRules()).catch(() => {}),
      Promise.resolve().then(() => BM.loadHiddenIds()).catch(() => {})
    ]);

    const tagsById = BM.getTags() || {};
    const byUrl = new Map();
    const categories = {};
    const tagStats = {};
    const allTagStats = {};
    const itemById = new Map();
    const itemsByUrl = new Map();
    const itemsByUrlKey = new Map();
    const tagItemsByName = new Map();
    const visibleTagItemsByName = new Map();
    const visibleItems = [];
    const taggedItems = [];
    const visibleTaggedItems = [];
    let hiddenItemCount = 0;
    let taggedItemCount = 0;
    let visibleTaggedItemCount = 0;
    let otherTaggedItemCount = 0;
    let visibleOtherTaggedItemCount = 0;
    let fallbackTaggedItemCount = 0;
    let visibleFallbackTaggedItemCount = 0;
    const groupSignature = domainGroupsSignature();
    const seenIds = new Set();

    // 单轮聚合，并在大书签库中分批让出主线程，避免侧边栏长时间无响应。
    for (let start = 0; start < items.length; start += ANALYZE_CHUNK_SIZE) {
      const end = Math.min(start + ANALYZE_CHUNK_SIZE, items.length);
      for (let index = start; index < end; index++) {
        const it = items[index];
        seenIds.add(it.id);
        const cached = metadataCache.get(it.id);
        const metadata = cached && cached.url === it.url && cached.title === it.title && cached.groupSignature === groupSignature
          ? cached.metadata
          : getMetadata(it.url, it.title);
        if (!cached || cached.metadata !== metadata) {
          metadataCache.set(it.id, { url: it.url, title: it.title, groupSignature, metadata });
        }
        Object.assign(it, metadata);
        it.dead = null; // 失效链接状态，由 popup 扫描填充
        it.tags = tagsById[it.id] || []; // 多标签（来自 bmTags 映射）
        it.hidden = BM.isHidden ? BM.isHidden(it.id) : false; // 隐藏书签（日常视图排除）
        itemById.set(it.id, it);
        const sameUrlItems = itemsByUrl.get(it.url);
        if (sameUrlItems) sameUrlItems.push(it);
        else itemsByUrl.set(it.url, [it]);
        // 归一化 URL 键分组：跨协议/www/末尾斜杠/普通锚点视为同一地址，用于统一同址标签。
        if (it.key) {
          const keyItems = itemsByUrlKey.get(it.key);
          if (keyItems) keyItems.push(it);
          else itemsByUrlKey.set(it.key, [it]);
        }
        (categories[it.category] = categories[it.category] || []).push(it);
        const tags = it.tags;
        const hasUsableTag = tags.some(tag => tag !== BM.FALLBACK_TAG);
        const onlyFallbackTag = tags.length > 0 && !hasUsableTag;
        const hasFallbackTag = tags.includes(BM.FALLBACK_TAG);
        if (tags.length) taggedItems.push(it);
        if (hasUsableTag) taggedItemCount++;
        if (onlyFallbackTag) otherTaggedItemCount++;
        if (hasFallbackTag) fallbackTaggedItemCount++;
        for (const tag of tags) {
          const allTagItems = tagItemsByName.get(tag);
          if (allTagItems) allTagItems.push(it);
          else tagItemsByName.set(tag, [it]);
          if (tag !== BM.FALLBACK_TAG) allTagStats[tag] = (allTagStats[tag] || 0) + 1;
        }
        if (!it.hidden) {
          visibleItems.push(it);
          if (tags.length) visibleTaggedItems.push(it);
          if (hasUsableTag) visibleTaggedItemCount++;
          if (onlyFallbackTag) visibleOtherTaggedItemCount++;
          if (hasFallbackTag) visibleFallbackTaggedItemCount++;
          if (!byUrl.has(it.url)) byUrl.set(it.url, []);
          byUrl.get(it.url).push(it);
          for (const tag of tags) {
            const visibleTagItems = visibleTagItemsByName.get(tag);
            if (visibleTagItems) visibleTagItems.push(it);
            else visibleTagItemsByName.set(tag, [it]);
            if (tag !== BM.FALLBACK_TAG) tagStats[tag] = (tagStats[tag] || 0) + 1;
          }
        } else hiddenItemCount++;
      }
      if (end < items.length) await yieldToBrowser();
    }
    metadataCache.forEach((_metadata, id) => {
      if (!seenIds.has(id)) metadataCache.delete(id);
    });

    const exactDuplicates = [];
    byUrl.forEach((groupItems, url) => {
      if (groupItems.length > 1) exactDuplicates.push({ url, items: groupItems });
    });

    return {
      total: items.length,
      items,
      exactDuplicates,
      categories,
      tagStats,
      emptyFolders,
      itemById,
      itemsByUrl,
      itemsByUrlKey,
      // 标签页直接使用此索引，切换时无需再次遍历完整书签库。
      tagView: {
        tagItemsByName,
        visibleTagItemsByName,
        allTagStats,
        visibleItems,
        taggedItems,
        visibleTaggedItems,
        hiddenItemCount,
        taggedItemCount,
        visibleTaggedItemCount,
        otherTaggedItemCount,
        visibleOtherTaggedItemCount,
        fallbackTaggedItemCount,
        visibleFallbackTaggedItemCount
      }
    };
  }

  // 兼容浏览器/Popup 与 Service Worker 上下文：Chrome MV3 下没有 Node 的 `global`
  globalThis.BMAnalyzer = { analyze, flatten };
})();
