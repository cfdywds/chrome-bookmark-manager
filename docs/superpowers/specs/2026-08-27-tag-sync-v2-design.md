# Tag Sync V2 Design

## Goal

Synchronize bookmark tags reliably between Chrome devices without relying on device-local bookmark IDs. Existing users keep their local tags, and a legacy cloud payload must never be applied to unrelated bookmarks.

## Scope

- Replace the cloud payload's `bookmarkId -> tags` map with a versioned `urlKey -> tags` map.
- Treat duplicate bookmarks with the same normalized URL as one logical bookmark for synchronization and union their tags. This matches the existing JSON import merge policy.
- Upgrade legacy cloud data only on a device that can resolve its local bookmark IDs. Devices that only see legacy cloud data ignore it safely.
- Store the opt-in flag in `chrome.storage.sync` so enabling it once covers the Chrome profile on other devices.
- Pull on both side-panel and new-tab initialization. Background writes caused by the browser's star action also schedule an upload.
- Store the latest sync failure in local storage and render it in settings.

## Cloud Format

The existing chunk keys remain `bmSyncTag_p<N>` and `bmSyncTag_cnt`. Their combined JSON value becomes:

```json
{
  "version": 2,
  "tags": {
    "github.com/openai": ["AI", "GitHub"]
  }
}
```

`urlKey` is the existing normalized URL key, which preserves query strings and SPA hash routes. Tags remain normalized, deduplicated, and capped at six per bookmark.

## Data Flow

1. Any local `bmTags` mutation wakes the background service worker.
2. If `bmSyncEnabled` is enabled in sync storage, the worker reads the bookmark tree, projects local ID-keyed tags to URL keys, chunks the V2 payload, and writes it to sync storage.
3. At UI startup or on sync storage change, the UI loads the V2 payload, resolves each URL key to the target device's local bookmark IDs, and merges tags into every matching bookmark.
4. A successful source-device write replaces old V1 data. A V1 payload without `version: 2` is ignored rather than mapping source IDs onto target bookmarks.

## Errors And Limits

Serialization and write failures are recorded as `{ lastError, at }` under `bmTagSyncStatus` in local storage. The settings page shows this state. Reads that fail or contain invalid payloads leave local tags unchanged.

The existing chunk size remains below the per-item sync limit. Total sync quota errors are surfaced through status rather than silently ignored.

## Tests

- A V2 payload maps a source URL key to a different target bookmark ID.
- Legacy V1 payloads are ignored.
- A local tag map projects duplicate IDs sharing one URL into a union.
- New-tab initialization invokes the initial cloud pull.
- Background local tag mutations schedule a cloud upload when enabled.
- Sync failure status is persisted and settings display it.
