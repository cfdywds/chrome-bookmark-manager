# Native Tag Hydration Recovery

## Problem

Chrome synchronizes the project-owned bookmark directory `书签管家同步数据（请勿修改）`, including its `BMN1|D|...` device folders. On a newly loaded extension, those folders can already exist while the page-to-service-worker `hydrate` response channel closes. The extension then reports a sync failure and does not reliably refresh or retry applying the records to local tag storage.

The import must succeed independently of the lifetime of a popup, options page, or new-tab page. A missing message response is not evidence that Chrome bookmark synchronization failed.

## Design

The background service worker owns native-tag hydration:

1. A hydration request enters the existing serialized native-sync queue.
2. The worker reads the internal bookmark root and all `BMN1|D|...` device folders, validates each published head/chunk set, and applies records only when every discovered payload is complete.
3. Startup, installation, and native-bookmark change events schedule the same background hydration path. When the root or a complete payload is not yet available, the worker retries with bounded backoff instead of depending on the originating page remaining open.
4. A successful apply or verified no-op records a successful sync status. A payload validation failure records the existing actionable error and never overwrites local tags with partial remote data.
5. Extension pages request hydration only as an optional prompt. Concurrent initial requests share one in-flight operation, and a closed runtime message channel does not overwrite the background-owned status or suppress later storage-driven refreshes.

## Error Handling

- Actual read, bookmark API, encoding, or payload-validation failures remain visible in `bmTagSyncStatus`.
- A runtime error matching a closed message-channel condition is treated as an indeterminate request outcome. The background retry remains responsible for convergence; the UI does not call it a data-sync failure.
- Existing guards for incomplete chunks remain authoritative: no partial record or configuration is applied.

## Tests

- Reproduce an already-synchronized bookmark tree with device payloads and a closed UI message channel; verify hydration still writes matching `bmTags`.
- Verify repeated startup/UI hydration prompts coalesce rather than queue duplicate reads.
- Verify a transient unavailable or incomplete root causes a retry, while incomplete chunks preserve local values and retain their validation error.
- Preserve coverage for direct successful hydration, configuration import, and background write failures.

## Scope

The change is limited to native tag synchronization in `js/background.js`, request coordination/status behavior in `js/lib.js`, and the related Vitest suites. It does not alter the bookmark data protocol, expose sync data in the UI, or migrate data to Chrome extension sync storage.
