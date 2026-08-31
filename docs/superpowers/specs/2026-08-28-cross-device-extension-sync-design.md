# Cross-Device Extension Sync Design

## Goal

Make the extension reliable across Chrome devices: production installs share one stable extension ID, bookmark tags remain URL-keyed, and the fixed tag pool plus custom tag rules follow the user's cloud-sync opt-in without allowing an unrelated local settings save to overwrite a newer cloud configuration.

## Current Failure Mode

The repository is distributed as an unpacked extension. Its manifest has no public key and there is no Chrome Web Store build. Chrome assigns independent unpacked installations different extension IDs. chrome.storage.sync is namespaced by extension ID, so successful writes from one installation cannot be read by another installation with a different ID.

The existing V2 tag payload syncs only bookmark tags and bmSyncEnabled. bmFixedTags and bmTagRules stay in chrome.storage.local. The options page currently writes LLM settings, fixed tags, and rules as one local payload, while the side panel can change the tag pool directly. Neither path has a revision protocol. The background URL-key helper also omits non-default ports while BM.urlKey preserves them.

## Scope

- Publish one Chrome Web Store extension, initially unlisted if public discovery is not wanted.
- Document a fixed-public-key unpacked build as a development-only fallback. Its public key is a local development artifact, not a replacement for the production Chrome Web Store identity.
- Sync bmFixedTags and bmTagRules when bmSyncEnabled is enabled.
- Preserve V2 bookmark tag sync and make UI and background URL keys identical.
- Show extension ID and sync status in the options page.
- Provide backup-first migration, manual verification, and rollback instructions.

## Non-Goals

- Do not sync LLM profiles, API keys, base URLs, models, optional-host permissions, or automatic-AI settings.
- Do not synchronize bookmarks themselves.
- Do not map old data automatically between different extension IDs.
- Do not weaken V1 tag-payload rejection or change the six-tags-per-bookmark limit.

## Distribution

### Production

The release workflow publishes the reviewed extension ZIP to one Chrome Web Store listing. Chrome Web Store signing supplies the stable production extension ID. All devices install that exact listing. The options page displays chrome.runtime.id so users can verify that two devices share the same namespace.

### Development Fallback

For unpacked development across multiple machines, generate one RSA key pair. Store the private PEM outside Git. Place only its Base64 DER public key in a local development copy of the manifest key field and use that same public key on every development machine. Remove the development key before preparing the Chrome Web Store ZIP. This development extension ID is intentionally separate from the Chrome Web Store production ID.

## Configuration Payload

Use a new chunked payload namespace:

- bmSyncConfig_p<N>
- bmSyncConfig_cnt

The JSON envelope is:

~~~json
{
  "version": 1,
  "revision": {
    "updatedAt": 1780000000000,
    "deviceId": "local-random-id"
  },
  "fixedTags": ["AI", "代码", "工具"],
  "tagRules": {
    "domain": { "github": ["代码"] },
    "keyword": { "roadmap": ["工作"] }
  }
}
~~~

Configuration uses the same 2,500-character chunk size as bookmark tags. The local device ID is randomly generated once and only breaks same-millisecond timestamp ties; it contains no account information.

The greater tuple of updatedAt then deviceId wins. A winning cloud snapshot replaces both fixed tags and rules, including explicit empty values, so deletions propagate. `bmFixedTags` has three distinct states: a missing value means the built-in defaults, an array means that exact user pool, and an empty array means no selectable fixed tags except the required fallback tag. This removes the prior ambiguity where an explicitly emptied pool silently became the defaults.

Configuration writes are serialized. A user-initiated fixed-tag or rule edit first reads the current cloud envelope. If a newer cloud envelope exists, it is applied locally before the edit is built. The new revision uses a timestamp greater than every observed revision, then writes local configuration and uploads the chunked envelope. LLM profile, API-key, model, host-permission, and automatic-AI writes never invoke this path.

When cloud sync is enabled for the first time, a valid cloud envelope is authoritative and is adopted. Only when no valid cloud envelope exists does the device create a revision from its local configuration and upload it. A failed upload leaves the local revision intact so the next initialization can retry it; malformed cloud data never changes local data.

## Data Flow

1. Enabling bmSyncEnabled initializes configuration first: adopt valid cloud configuration, or create and upload a local revision only if no cloud configuration exists. It then pulls V2 bookmark tags and uploads local tags as before.
2. A central helper owns all fixed-tag and rule mutations from both options and side panel. It validates the values, serializes writes, creates a monotonic revision only for a user configuration edit, writes local storage, and uploads configuration chunks when opted in.
3. A sync-storage change parses the cloud configuration, applies it only when newer, and invalidates fixed-tag and rule caches before a UI surface renders or analyzes bookmarks.
4. Options separates local LLM persistence from configuration persistence. Changing an API key or active LLM profile cannot create a configuration revision or re-upload stale tag data.
5. The background worker hydrates a newer cloud configuration before automatic bookmark tagging reads its fixed-tag pool or custom rules. It uses the same config validation and revision comparison semantics as the UI.
6. Bookmark tags retain the V2 payload. UI and background both retain host, non-default port, path, query, and SPA hash-route semantics.
7. Read, parse, quota, and write errors update bmTagSyncStatus. The options page shows last success, last failure, and extension ID.

## Privacy

Cloud configuration contains fixed tag names and custom rule text, both of which can reveal browsing preferences. It is covered by the explicit cloud-sync toggle. The envelope contains only its version, revision, fixedTags, and tagRules. It never mirrors arbitrary local storage.

The payload must never include bmSettings, bmLlmProfiles, bmActiveLlmProfile, an API key, an API endpoint, a model, or an optional-host permission. The private development key must never be committed or copied into the manifest.

## Rollout And Recovery

1. Export a bookmark JSON backup from the authoritative device before changing extension IDs.
2. Install the same Chrome Web Store listing on all production devices, or use the shared-public-key build on all development devices.
3. Compare the options-page extension ID on both devices.
4. Import the backup on the authoritative device, enable cloud sync, and confirm a success status.
5. Open the side panel or new-tab page on the target device to pull settings and tags.
6. To roll back, disable cloud sync, reinstall the former extension ID, and import the backup. Do not delete cloud storage during rollback.

## Acceptance Criteria

- Two production installs show the same extension ID.
- Shared-key unpacked development installs show the same development extension ID.
- Fixed tags and domain/keyword rules reach a second device, including deletions.
- Saving an LLM profile after a remote configuration change does not upload or overwrite the configuration.
- A fixed-tag change made in the side panel follows the same configuration sync path as an options-page change.
- An empty fixed-tag pool and empty rule maps round-trip as explicit values rather than becoming implicit defaults.
- API keys and LLM settings are absent from the configuration payload.
- A bookmark using a non-default port has one identical V2 key in UI and background uploads.
- Sync failures are visible in the options page.

