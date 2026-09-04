# Native Tag Hydration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Import tag records already synchronized as Chrome bookmarks even if an extension page loses its runtime-message response channel.

**Architecture:** The MV3 service worker owns hydration completion and retry decisions. It returns an internal \`{ changed, retry }\` outcome, while message callers retain the existing boolean response. Extension pages share one in-flight hydrate request and treat a closed response channel as indeterminate, not as a confirmed sync failure.

**Tech Stack:** Chrome Manifest V3 service worker APIs, \`chrome.bookmarks\`, \`chrome.storage.local\`, native JavaScript, Vitest 2.

---

## File Structure

- \`js/background.js\`: validates bookmark-backed payload availability, schedules bounded hydration retries, preserves message responses, and records actual success.
- \`js/lib.js\`: coalesces page-originated hydration and classifies closed message channels.
- \`tests/native-bookmark-sync.test.js\`: models lifecycle hydration with a delayed bookmark-sync root.
- \`tests/lib.test.js\`: covers shared requests and status behavior.

### Task 1: Background-Owned Hydration Retry

**Files:**
- Modify: \`tests/native-bookmark-sync.test.js:45-141\`
- Modify: \`tests/native-bookmark-sync.test.js:158-510\`
- Modify: \`js/background.js:558-697\`
- Modify: \`js/background.js:888-895\`
- Modify: \`js/background.js:1391-1408\`

- [ ] **Step 1: Write the failing lifecycle-retry test**

Extend \`createHarness\` to retain \`onInstalled\` and \`onStartup\` listeners, then expose \`emitInstalled()\` and \`emitStartup()\`. Add this test:

\`\`\`js
it('安装时在同步根目录稍后到达后重试并导入标签', async () => {
  vi.useFakeTimers();
  const source = createHarness(createTree([
    { id: 'source', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
  ]), { bmTags: { source: ['AI'] }, bmFixedTags: ['AI'], bmTagRules: { domain: {}, keyword: {} } });
  globalThis.chrome = source.chrome;
  new Function(backgroundCode)();
  await source.send({ type: 'bmNativeTagSync', action: 'setEnabled', enabled: true });

  const target = createHarness(createTree([
    { id: 'target', parentId: '1', title: 'OpenAI', url: 'https://openai.com/research' }
  ]), { bmTags: {}, bmNativeTagSyncEnabled: true });
  globalThis.chrome = target.chrome;
  new Function(backgroundCode)();
  target.emitInstalled();
  await vi.advanceTimersByTimeAsync(800);
  target.tree[0].children[0].children.push(clone(syncRoot(source.tree)));
  await vi.advanceTimersByTimeAsync(2000);

  expect(target.localData.bmTags).toEqual({ target: ['AI'] });
  expect(target.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
});
\`\`\`

- [ ] **Step 2: Verify RED**

Run: \`npm test -- tests/native-bookmark-sync.test.js\`

Expected: FAIL because the current 800 ms startup hydration does not schedule another attempt.

- [ ] **Step 3: Implement bounded retry outcomes**

Add:

\`\`\`js
const NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS = [2000, 10000, 30000];

function nativeTaskChanged(result) {
  return result && typeof result === 'object' ? result.changed === true : result === true;
}
\`\`\`

Make \`readNativeSyncData\` report a payload error for a valid \`BMN1|D|\` folder with no valid \`BMN1|H|\` entry. Make \`applyNativeSyncData\` return \`{ changed: false, retry: true }\` on payload errors and \`{ changed: tagsChanged || configChanged, retry: false }\` after a complete application. Make \`hydrateNativeSync\` return \`{ changed: false, retry: state.enabled }\` for a missing root and otherwise return the apply result.

Replace the scheduler with:

\`\`\`js
function scheduleNativeHydration(retryAttempt = 0) {
  if (nativeSyncTimer) clearTimeout(nativeSyncTimer);
  const delay = retryAttempt
    ? NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS[retryAttempt - 1]
    : NATIVE_SYNC_DELAY_MS;
  nativeSyncTimer = setTimeout(() => {
    nativeSyncTimer = null;
    nativeQueue(() => hydrateNativeSync(chrome))
      .then(result => {
        if (result.retry && retryAttempt < NATIVE_SYNC_HYDRATION_RETRY_DELAYS_MS.length) {
          scheduleNativeHydration(retryAttempt + 1);
        }
      })
      .catch(error => console.warn('[书签管家] 原生标签同步读取失败', error));
  }, delay);
}
\`\`\`

In the \`bmNativeTagSync\` listener, send \`changed: nativeTaskChanged(result)\`. If direct \`hydrate\` returns \`retry: true\`, schedule retry attempt 1 before responding. Keep \`return true\`.

- [ ] **Step 4: Verify GREEN**

Run: \`npm test -- tests/native-bookmark-sync.test.js\`

Expected: PASS; lifecycle hydration imports the source tag without a page \`send\` call.

- [ ] **Step 5: Commit**

\`\`\`bash
git add js/background.js tests/native-bookmark-sync.test.js
git commit -m "fix: retry native tag hydration after startup"
\`\`\`

### Task 2: Page Request Coalescing

**Files:**
- Modify: \`tests/lib.test.js:43-100\`
- Modify: \`tests/lib.test.js:102-260\`
- Modify: \`js/lib.js:795-903\`

- [ ] **Step 1: Write failing library tests**

Add a deferred \`runtime.sendMessage\` test that starts \`BM.initializeSyncedTagConfiguration()\`, then \`BM.pullTagsFromCloud()\`, and expects exactly one \`{ type: 'bmNativeTagSync', action: 'hydrate' }\` call before resolving \`{ ok: true, changed: false }\`.

Add a rejected-message test with:

\`\`\`js
const closed = new Error(
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
);
\`\`\`

With \`bmNativeTagSyncEnabled: true\`, assert initialization and pull both resolve \`false\`, and \`storage.local.set\` is not called.

- [ ] **Step 2: Verify RED**

Run: \`npm test -- tests/lib.test.js\`

Expected: FAIL because the existing implementation sends two requests and initialization rejects the closed-channel error.

- [ ] **Step 3: Implement one shared request and narrow error classification**

Add after \`requestNativeTagSync\`:

\`\`\`js
const CLOSED_NATIVE_SYNC_CHANNEL = /(?:message (?:channel|port) closed|asynchronous response.*channel closed)/i;
let nativeHydrationRequest = null;

function isClosedNativeSyncChannel(error) {
  return CLOSED_NATIVE_SYNC_CHANNEL.test(String(error && (error.message || error)));
}

function requestNativeTagHydration() {
  if (nativeHydrationRequest) return nativeHydrationRequest;
  const request = requestNativeTagSync('hydrate');
  nativeHydrationRequest = request;
  request.finally(() => {
    if (nativeHydrationRequest === request) nativeHydrationRequest = null;
  }).catch(() => {});
  return request;
}
\`\`\`

Use \`requestNativeTagHydration()\` from both initialization and pull. For \`isClosedNativeSyncChannel(error)\`, return \`false\` without \`setTagSyncStatus\`. Keep current behavior for a confirmed \`{ ok: false }\` background response and every other error.

- [ ] **Step 4: Verify GREEN**

Run: \`npm test -- tests/lib.test.js\`

Expected: PASS; only one hydrate message is sent and the transport closure does not persist \`bmTagSyncStatus.lastError\`.

- [ ] **Step 5: Commit**

\`\`\`bash
git add js/lib.js tests/lib.test.js
git commit -m "fix: recover native tag hydration from closed channels"
\`\`\`

### Task 3: Background Success Status and Full Verification

**Files:**
- Modify: \`tests/native-bookmark-sync.test.js\`
- Modify: \`js/background.js:519-548\`

- [ ] **Step 1: Write a failing successful-publish status test**

Seed a harness with \`bmTagSyncStatus: { lastError: '旧错误', at: 1 }\`, enable native sync, change \`bmTags\`, settle the storage listener, and assert:

\`\`\`js
expect(source.localData.bmTagSyncStatus).toMatchObject({ lastError: '' });
\`\`\`

- [ ] **Step 2: Verify RED**

Run: \`npm test -- tests/native-bookmark-sync.test.js\`

Expected: FAIL because \`publishNativeSync\` does not record a new successful status.

- [ ] **Step 3: Record success in the background authority**

Immediately before \`return true\` in \`publishNativeSync\`, add:

\`\`\`js
await setBackgroundTagSyncStatus(api, '');
\`\`\`

Do not add a page-side success write.

- [ ] **Step 4: Verify all affected behavior**

Run: \`npm test -- tests/native-bookmark-sync.test.js tests/lib.test.js\`

Expected: PASS.

Run: \`npm test\`

Expected: PASS with no Vitest failures.

Run: \`npm run lint\`

Expected: PASS with no ESLint errors.

- [ ] **Step 5: Commit**

\`\`\`bash
git add js/background.js tests/native-bookmark-sync.test.js
git commit -m "fix: clear native tag sync errors after publish"
\`\`\`
