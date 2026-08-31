# Cross-Device Extension Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Distribute one stable extension identity across devices and synchronize fixed tag pools and custom tag rules alongside existing URL-keyed bookmark tags.

**Architecture:** Chrome Web Store distribution supplies the stable production ID. A local public-key manifest is only an unpacked-development fallback. js/lib.js owns versioned configuration chunks, monotonic revisions, initialization, and UI watchers. js/background.js independently validates and hydrates newer configuration before automatic bookmark tagging. UI configuration edits are isolated from LLM persistence and every surface pulls configuration before rendering or analysis.

**Tech Stack:** Manifest V3 Chrome extension APIs, classic JavaScript, Node.js 20, Vitest, ESLint.

**Spec:** docs/superpowers/specs/2026-08-28-cross-device-extension-sync-design.md

## Global Constraints

- Production installs must come from one Chrome Web Store listing.
- Never commit, display, or sync a private extension key.
- Never include a development manifest key in the Chrome Web Store ZIP.
- Sync only bmFixedTags, bmTagRules, and existing bookmark tags.
- Keep LLM profiles, credentials, endpoints, models, permissions, and automatic-AI settings local.
- Only a fixed-tag or rule edit may create and upload a configuration revision.
- A missing fixed-tag value uses built-in defaults; an explicit empty array means only the fallback tag remains selectable.
- On first enable, a valid cloud configuration wins; local configuration uploads only when cloud has no valid envelope.
- Preserve existing bmTags, V1 safety, and the six-tags-per-bookmark limit.
- Chunk every sync payload at 2,500 characters.
- Keep background and UI URL-key semantics identical, including non-default ports.

---

## File Structure

- js/lib.js: configuration payload serialization, revisions, pull/push, and UI watcher.
- js/background.js: background configuration hydration and URL-key parity.
- js/options.js and options.html: configuration writes, status, extension-ID diagnostics, and privacy copy.
- js/popup.js and js/newtab.js: initial configuration pull and cache invalidation.
- docs/release/chrome-web-store.md: release, backup, install, and rollback runbook.
- README.md, SECURITY.md, CHANGELOG.md: public installation and privacy boundaries.
- tests/lib.test.js, tests/background-trash.test.js, tests/options-profiles.test.js, tests/popup-performance.test.js, tests/newtab-search.test.js, tests/release.test.js: regression coverage.

### Task 1: Define Stable-ID Distribution And Recovery

**Files:**

- Create: docs/release/chrome-web-store.md
- Modify: README.md
- Modify: SECURITY.md
- Modify: CHANGELOG.md
- Modify: tests/release.test.js

**Interfaces:**

- Produces a Chrome Web Store release runbook that records the listing URL and extension ID after upload.
- Produces a development-key procedure where only a public key enters a local unpacked-development manifest and is removed before upload.

- [x] **Step 1: Write documentation assertions**

~~~js
expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('Chrome Web Store');
expect(readFileSync(join(root, 'SECURITY.md'), 'utf8')).toContain('private key');
expect(existsSync(join(root, 'docs/release/chrome-web-store.md'))).toBe(true);
~~~

- [x] **Step 2: Verify the assertions fail**

Run: npm test -- tests/release.test.js

Expected: FAIL because the runbook and stable-ID documentation do not exist.

- [x] **Step 3: Write the production and development procedures**

The runbook must require this sequence:

~~~text
1. Export bookmark JSON from the authoritative device.
2. Build the reviewed repository root into the Chrome Web Store upload ZIP.
3. Upload it to one unlisted Chrome Web Store item.
4. Install that same listing on two Chrome profiles and record the identical chrome.runtime.id.
5. Import the backup only on the authoritative profile, enable cloud sync, and verify success.
6. For unpacked development only, generate one RSA key pair, keep extension-private.pem outside Git, put only the Base64 DER public key in a local manifest copy, and remove that key before creating the store ZIP.
~~~

Update README so Chrome Web Store is the production path and unpacked loading is development-only. State that private keys, API keys, and personal backups must not be committed.

- [x] **Step 4: Verify documentation tests pass**

Run: npm test -- tests/release.test.js

Expected: PASS.

- [ ] **Step 5: Commit the task**

~~~bash
git add README.md SECURITY.md CHANGELOG.md docs/release/chrome-web-store.md tests/release.test.js
git commit -m "docs: define stable extension distribution"
~~~

### Task 2: Add Versioned, Chunked Configuration Sync

**Files:**

- Modify: js/lib.js
- Modify: tests/lib.test.js

**Interfaces:**

- Produces BM.serializeSyncConfig(config), BM.deserializeSyncConfig(json), and BM.compareConfigRevision(left, right).
- Produces BM.initializeSyncedTagConfiguration(), BM.saveSyncedTagConfiguration(fixedTags, tagRules), BM.pushConfigToCloud(), and BM.pullConfigFromCloud().
- Writes no configuration revision for a profile, credential, permission, or automatic-AI save.
- Treats undefined bmFixedTags as defaults and [] as the explicit fallback-only pool.
- Reads and applies a newer cloud revision before constructing a user configuration revision.
- Exports BM.SYNC_CONFIG_PREFIX, BM.SYNC_CONFIG_CNT, BM.SYNC_CONFIG_REVISION_KEY, and BM.watchTagConfiguration.

- [x] **Step 1: Write failing pure-function and storage tests**

~~~js
const config = {
  version: 1,
  revision: { updatedAt: 100, deviceId: 'device-a' },
  fixedTags: ['代码', '工具'],
  tagRules: { domain: { github: ['代码'] }, keyword: { roadmap: ['工作'] } }
};

const chunked = BM.serializeSyncConfig(config);
expect(BM.deserializeSyncConfig(chunked.bmSyncConfig_p0)).toEqual(config);
expect(BM.compareConfigRevision(config.revision, { updatedAt: 100, deviceId: 'device-b' })).toBeLessThan(0);

await BM.saveSyncedTagConfiguration(['代码'], { domain: { github: ['代码'] }, keyword: {} });
const explicitEmpty = { ...config, fixedTags: [], tagRules: { domain: {}, keyword: {} } };
expect(BM.deserializeSyncConfig(JSON.stringify(explicitEmpty)))
  .toMatchObject({ fixedTags: [], tagRules: { domain: {}, keyword: {} } });
expect(syncSet).toHaveBeenCalledWith(expect.objectContaining({ bmSyncConfig_cnt: 1 }));
expect(JSON.stringify(syncSet.mock.calls)).not.toContain('apiKey');
~~~

- [x] **Step 2: Run the focused test before implementation**

Run: npm test -- tests/lib.test.js

Expected: FAIL because configuration-sync helpers do not exist.

- [x] **Step 3: Implement validation, chunks, and revisions**

Add distinct keys and preserve explicit empty values:

~~~js
const SYNC_CONFIG_PREFIX = 'bmSyncConfig_p';
const SYNC_CONFIG_CNT = 'bmSyncConfig_cnt';
const SYNC_CONFIG_REVISION_KEY = 'bmSyncConfigRevision';

function compareConfigRevision(left, right) {
  const time = Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0);
  if (time) return time;
  return String(left?.deviceId || '').localeCompare(String(right?.deviceId || ''));
}
~~~

Use the existing fixed-tag and tag-rule normalization before serializing. Store one random local device ID and serialize every config operation through one promise queue. Reject malformed payloads without changing local data. A user configuration save first reads and applies a newer cloud configuration, then gives the explicit edit a revision later than every observed revision. When sync first enables, valid cloud data wins; only an absent cloud envelope triggers an upload from local state. Keep [] intact, keep absent fixed tags distinct from [], and never invoke configuration helpers from an LLM persistence path.

- [x] **Step 4: Add a cloud-pull test**

~~~js
await expect(BM.pullConfigFromCloud()).resolves.toBe(true);
expect(localData.bmFixedTags).toEqual(['代码']);
expect(localData.bmTagRules).toEqual({ domain: { github: ['代码'] }, keyword: {} });
~~~

- [x] **Step 5: Run focused tests**

Run: npm test -- tests/lib.test.js

Expected: PASS.

- [ ] **Step 6: Commit the task**

~~~bash
git add js/lib.js tests/lib.test.js
git commit -m "feat: sync tag configuration"
~~~

### Task 3: Route Options And UI Through Configuration Sync

**Files:**

- Modify: js/options.js
- Modify: js/popup.js
- Modify: js/newtab.js
- Modify: tests/options-profiles.test.js
- Modify: tests/popup-performance.test.js
- Modify: tests/newtab-search.test.js

**Interfaces:**

- Options calls BM.saveSyncedTagConfiguration(fixedTags, tagRules) only from fixed-tag and rule handlers; LLM profile writes stay local.
- Side-panel create, rename, and remove pool actions call the same helper.
- BM.initializeSyncedTagConfiguration() runs before fixed tags, rules, and bookmark analysis are loaded.
- BM.watchTagConfiguration(onChange) refreshes a surface only after newer cloud configuration changes local values.

- [x] **Step 1: Write failing UI tests**

~~~js
expect(getFunctionSource('persistSilent')).not.toContain('BM.saveSyncedTagConfiguration');
expect(getFunctionSource('persistFixedTags')).toContain('BM.saveSyncedTagConfiguration');
expect(popupSource).toContain('await BM.initializeSyncedTagConfiguration()');
expect(popupSource).toContain('BM.saveSyncedTagConfiguration(pool');
expect(newtabSource).toContain('await window.BM.initializeSyncedTagConfiguration()');
expect(optionsSource).not.toContain('chrome.storage.sync.set({ bmSettings');
~~~

- [x] **Step 2: Run focused UI tests before implementation**

Run: npm test -- tests/options-profiles.test.js tests/popup-performance.test.js tests/newtab-search.test.js

Expected: FAIL because options currently write fixed tags and rules only to local storage.

- [x] **Step 3: Refactor options persistence**

Split persistence: persistSilent writes only the active LLM profile; persistFixedTags and persistTagRules call the shared helper with the current fixed tags and rules. The side-panel pool mutations load the current rules and call that same helper instead of chrome.storage.local.set.

~~~js
await queueProfileWrite({
  [LLM_PROFILES_KEY]: llmProfiles,
  [ACTIVE_LLM_PROFILE_KEY]: activeLlmProfileId,
  bmSettings: profileSettings(profile)
});
await BM.saveSyncedTagConfiguration(ft, tagRules);
~~~

Run configuration initialization before fillFixedTags, fillTagRules, BMAnalyzer.analyze, and side-panel rendering. Register the watcher to invalidate fixed-tag and rule caches. A remote apply only updates local state; it never uploads again.

- [x] **Step 4: Run focused UI tests**

Run: npm test -- tests/options-profiles.test.js tests/popup-performance.test.js tests/newtab-search.test.js

Expected: PASS.

- [ ] **Step 5: Commit the task**

~~~bash
git add js/options.js js/popup.js js/newtab.js tests/options-profiles.test.js tests/popup-performance.test.js tests/newtab-search.test.js
git commit -m "feat: pull synced tag configuration in UI"
~~~

### Task 4: Align Background Configuration And URL Identity

**Files:**

- Modify: js/background.js
- Modify: tests/background-trash.test.js

**Interfaces:**

- Background syncUrlKey(rawUrl) matches BM.urlKey(rawUrl), including url.port.
- Background applies a newer configuration payload before automatic bookmark tagging uses local rules.
- Background never writes configuration chunks; it only adopts valid newer cloud configuration before it tags a bookmark.

- [x] **Step 1: Write failing background tests**

~~~js
expect(JSON.parse(payload.bmSyncTag_p0).tags).toEqual({
  'git.example:8443/project': ['代码']
});

await harness.triggerSyncConfigChange(configChunks);
expect(harness.localData.bmTagRules).toEqual({
  domain: { git: ['代码'] },
  keyword: {}
});
~~~

- [x] **Step 2: Run the focused background test**

Run: npm test -- tests/background-trash.test.js

Expected: FAIL because syncUrlKey currently omits non-default ports and the worker ignores configuration changes.

- [x] **Step 3: Implement background parity**

Use the same port-preserving key construction:

~~~js
const host = String(url.hostname || '').toLowerCase().replace(/^www\./, '');
const port = url.port ? ':' + url.port : '';
return (host + port + path + url.search + hashRoute).toLowerCase();
~~~

Add configuration chunk parsing and revision comparison equivalent to js/lib.js. Start one shared hydration promise during worker startup, refresh it on chrome.storage.sync.onChanged, and await it inside autoTagBrowserBookmarks before reading its local pool or rules. Apply only a valid newer configuration, preserve explicit empty values, and do not read or write LLM storage keys as part of the configuration payload.

- [x] **Step 4: Run focused background tests**

Run: npm test -- tests/background-trash.test.js

Expected: PASS.

- [ ] **Step 5: Commit the task**

~~~bash
git add js/background.js tests/background-trash.test.js
git commit -m "fix: align background sync identity"
~~~

### Task 5: Add Diagnostics And Accurate Privacy Copy

**Files:**

- Modify: options.html
- Modify: js/options.js
- Modify: README.md
- Modify: CHANGELOG.md
- Modify: tests/options-profiles.test.js

**Interfaces:**

- Options renders chrome.runtime.id, last sync success, and last sync failure.
- UI copy names tags, fixed tag pools, and custom rules as synchronized fields.
- UI copy explicitly excludes LLM profiles, API keys, endpoints, and models.

- [x] **Step 1: Write failing diagnostics tests**

~~~js
expect(optionsHtml).toContain('tagSyncExtensionId');
expect(optionsSource).toContain('chrome.runtime.id');
expect(readme).toContain('自定义标签规则');
expect(readme).toContain('不包含 API Key');
~~~

- [x] **Step 2: Run focused tests before implementation**

Run: npm test -- tests/options-profiles.test.js

Expected: FAIL because the extension ID and configuration-sync boundary are not rendered.

- [x] **Step 3: Render non-sensitive diagnostics**

~~~js
const id = chrome.runtime && chrome.runtime.id ? chrome.runtime.id : '';
$('#tagSyncExtensionId').textContent = id ? '扩展 ID：' + id : '';
~~~

Update success text and documentation to describe the exact data boundary. Do not render payload contents or any LLM configuration.

- [x] **Step 4: Run focused tests**

Run: npm test -- tests/options-profiles.test.js

Expected: PASS.

- [ ] **Step 5: Commit the task**

~~~bash
git add options.html js/options.js README.md CHANGELOG.md tests/options-profiles.test.js
git commit -m "docs: clarify synchronized configuration"
~~~

### Task 6: Verify Release And Cross-Device Behavior

**Files:**

- Verify: manifest.json, js/lib.js, js/background.js, js/options.js, js/popup.js, js/newtab.js, options.html, README.md, docs/release/chrome-web-store.md, tests

- [x] **Step 1: Run all automated tests**

Run: npm test

Expected: PASS with no failed tests.

- [x] **Step 2: Run lint and whitespace checks**

Run: npm run lint

Expected: PASS with no lint errors.

Run: git diff --check

Expected: no output.

- [ ] **Step 3: Run manual production verification**

1. Export a backup from the authoritative device.
2. Install one Chrome Web Store listing on two Chrome profiles using the same Chrome Sync account.
3. Confirm the options page shows the same extension ID.
4. On the source profile add a fixed tag, a domain rule, and the label 代码 to https://git.example:8443/project.
5. Wait for success, open the side panel on the target profile, and confirm all three changes arrived.
6. Delete the tag and rule on the source profile; confirm removals arrive on target.
7. Confirm target options never receives an LLM API key, endpoint, model, or profile.

- [ ] **Step 4: Validate rollback**

Disable cloud sync in a test profile, restore the former extension ID, and import the exported JSON backup. Confirm bookmark tags and rules restore without deleting cloud data.

- [ ] **Step 5: Commit only after all checks pass**

~~~bash
git add manifest.json js/lib.js js/background.js js/options.js js/popup.js js/newtab.js options.html README.md SECURITY.md CHANGELOG.md docs/release/chrome-web-store.md tests
git commit -m "feat: synchronize extension configuration"
~~~

