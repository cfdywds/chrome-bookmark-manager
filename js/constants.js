// js/constants.js —— 零构建共享常量；经典脚本，挂 globalThis.BM_CONST
(function (global) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    TAGS: 'bmTags',
    HIDDEN_IDS: 'bmHiddenIds',
    HIDDEN_URLS: 'bmHiddenUrls',
    FIXED_TAGS: 'bmFixedTags',
    TAG_RULES: 'bmTagRules',
    TRASH: 'bmTrash',
    STORAGE_VERSION: 'bmStorageVersion',
    DOMAIN_GROUPS_MIGRATED: 'bmDomainGroupsMigrated',
    STAR_HOOK: 'bmStarHook',
    AUTO_AI_TAG: 'bmAutoAiTag',
    TAG_SYNC_STATUS: 'bmTagSyncStatus',
    NATIVE_SYNC_ENABLED: 'bmNativeTagSyncEnabled',
    NATIVE_SYNC_REQUEST: 'bmNativeTagSyncRequest',
    NATIVE_SYNC_COMPLETED_REQUEST: 'bmNativeTagSyncCompletedRequest',
    NATIVE_SYNC_STATE: 'bmNativeTagSyncState',
    NATIVE_SYNC_RECORDS: 'bmNativeTagSyncRecords',
    NATIVE_SYNC_CONFIG: 'bmNativeTagSyncConfig',
    NATIVE_SYNC_CONFIG_REQUEST: 'bmNativeTagSyncConfigRequest',
    NATIVE_SYNC_URLS: 'bmNativeTagSyncUrls',
    ERROR_LOG: 'bmErrorLog'
  });

  const MESSAGES = Object.freeze({
    TAG_MUTATION: 'bmTagMutation',
    AUTO_TAG: 'bmAutoTagBookmark',
    NATIVE_SYNC: 'bmNativeTagSync',
    NATIVE_SYNC_WAKE: 'wakePendingSetting',
    BACKUP_IMPORT: 'bmBackupImportBookmark',
    TRASH_MUTATION: 'bmTrashMutation'
  });

  const LIMITS = Object.freeze({
    FALLBACK_TAG: '其他',
    MAX_FIXED_TAGS: 50,
    MAX_TAGS_PER_BOOKMARK: 6,
    MAX_TAG_LEN: 20,
    TRASH_MAX: 5000,
    TRASH_TTL_DAYS: 30,
    NATIVE_SYNC_PROTOCOL: 'BMN1',
    NATIVE_SYNC_BUCKETS: 32,
    NATIVE_SYNC_CHUNK_CHARS: 180,
    NATIVE_SYNC_ROOT_TITLE: '书签管家同步数据（请勿修改）'
  });

  global.BM_CONST = Object.freeze({ STORAGE_KEYS, MESSAGES, LIMITS });
})(typeof self !== 'undefined' ? self : globalThis);
