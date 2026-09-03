# Design Notes

## Architecture

The extension is a zero-build Chrome / Edge Manifest V3 project. `popup.html` provides the side-panel workflow, `newtab.html` provides bookmark browsing on new tabs, `options.html` manages preferences, and `js/background.js` owns bookmark events, alarms, and cross-context coordination. Shared bookmark, tag, backup, and AI utilities live in `js/lib.js`.

Chrome bookmarks remain the source of truth for bookmark nodes. Extension-only state, including tags, fixed tag pools, rules, hidden state, recycle-bin records, and LLM profiles, is stored locally. JSON backup and restore use the compact V4 format; it preserves recoverable bookmark and extension data while excluding browser-generated node metadata.

## Native Tag Sync

Native tag sync is optional. When enabled, tags keyed by normalized URL, fixed tag pools, and custom tag rules are serialized into the protected `书签管家同步数据（请勿修改）` bookmark folder. Chrome bookmark sync carries that folder to Chrome devices signed into the same Google account.

The payload uses revisioned chunks and a head pointer. A reader only applies a complete revision, so Chrome bookmark events arriving out of order cannot overwrite local state with partial data. The protected folder is ignored by bookmark listing, cleanup, search, and backup workflows. Each device must load the unpacked extension manually; matching extension IDs are unnecessary.

## Security Decisions

- Bookmark-derived text is escaped before it is inserted into extension HTML.
- A shared HTTP(S) URL normalizer rejects executable and non-web protocols at creation, import, and navigation boundaries.
- The manifest requests optional, origin-specific host permissions for user-configured LLM endpoints instead of permanent access to all sites.
- LLM payloads exclude URL queries and fragments. Local privacy rules block requests for login endpoints, credential parameters, and financial or wallet services.
- Background AI tagging is opt-in, skips native bulk imports and high-confidence rule matches, and falls back to local rules when a remote request fails.
- Backups omit LLM settings and API keys. Native tag sync omits bookmark titles, API keys, LLM profiles, hidden state, and recycle-bin records.

## Trust Boundaries

Chrome bookmark APIs, Chrome bookmark sync, imported JSON, and local extension storage are user-data inputs. Configured LLM endpoints are remote trust boundaries. Network access to an LLM origin requires explicit user approval.

## Accepted Risks

Bookmark titles and paths can still contain private information. AI privacy rules are best-effort outbound safeguards; they do not encrypt, hide, or isolate browser data. Native tag sync exposes tag and rule text to Chrome bookmark sync under the user's Google account, so users should not use it for confidential labels.
