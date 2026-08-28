# Design Notes

## Threat Model

The extension processes user-controlled bookmark metadata, imported JSON backups, and responses from configured LLM services and GitHub Releases. The primary threats are scriptable URLs, HTML injection in extension pages, accidental secret export, and unnecessary disclosure of bookmark data.

## Security Decisions

- HTML rendering escapes bookmark-derived text before it is interpolated into templates.
- A shared HTTP(S) URL normalizer rejects executable and non-web protocols at creation, import, and navigation boundaries.
- The manifest uses optional host permissions for user-configured LLM origins instead of permanent access to all sites.
- LLM payloads omit URL queries and fragments. Local AI privacy rules exclude bookmarks only when their parsed URL shows a login endpoint, credential parameter, or financial/wallet service signal.
- Background LLM tagging is separately opt-in, skips native bulk imports and high-confidence public or user-configured rule matches, and falls back to local rules on any remote failure.
- Backup exports omit LLM settings and API keys.

## Trust Boundaries

Chrome bookmark APIs and local extension storage are local inputs. LLM endpoints and GitHub Releases are remote trust boundaries. Network access to an LLM origin is explicitly approved by the user.

## Accepted Risks

Bookmark titles and paths can still contain private information. AI privacy rules are best-effort and do not encrypt, hide, or isolate bookmarks from browser sync, so users remain responsible for reviewing data before AI processing.

## Change History

### 2026-08-28 - Local Custom Rule Application

**Changes**: Added an explicit tag-page action that applies user-defined hostname and title/path rules to existing bookmarks without an LLM. It offers untagged-only, append, and replace modes, and applies a shared tag result to same-URL bookmark siblings.

**Reason**: Saving a rule must not silently overwrite existing manual labels, while using a full AI retag solely to apply a deterministic rule is unnecessary and may disclose bookmark metadata.

**Impact**: Existing bookmarks remain unchanged until the user confirms a local rule application mode. The action respects the fixed tag pool, performs no network request, and preserves same-URL tag consistency. AI batch failures keep successful writes and retain the remaining representative bookmarks in the open sidebar so a local “Continue tagging” action can retry them without resending completed work.

### 2026-08-28 - Deterministic-First AI Tagging

**Changes**: Added generic semantic rules for code hosting, forum platforms, design collaboration, work tools, operations services, and AI sites. Default rules emit reusable topic tags rather than personal hostnames or site-specific labels. Users may add case-insensitive hostname keyword rules and title/hostname/pathname keyword rules with one or more fixed-pool tags. The first tag in a hostname rule also serves as that domain's overview category, replacing the separate domain-group setting. Manual AI results preserve high-confidence local tags. Browser-created bookmarks continue to receive local tags silently and may use the configured LLM only when a separate opt-in is enabled and no high-confidence public or user rule matched.

**Reason**: Hostnames often provide stronger evidence than titles or generic path words. Deterministic rules make known services predictable, reduce LLM cost, and keep background network disclosure under explicit user control.

**Impact**: Default tags now include the generic `代码` and `论坛` categories and remove site-specific defaults; storage V3 upgrades an exact legacy default pool and migrates `bmDomainGroups` into `bmTagRules.domain` without deleting the legacy value. `bmTagRules` stores separate `domain` and `keyword` mappings; rule outputs outside `bmFixedTags` are ignored. Keyword matching excludes query and fragment data. Backups use V3 and include unified tag rules; V2 backups remain import-compatible. Background LLM requests exclude native imports and protected URLs, strip query/fragment data, write local tags before the request, and merge a response only while that baseline is unchanged. Switching an active LLM profile revalidates optional host permission while background AI is enabled.

### 2026-08-27 - Public Release Baseline

**Changes**: Establish the public version baseline at 1.0.0 and add the repository's first public changelog entry.

**Reason**: The repository is being released as a new open-source project without prior public release history.

**Impact**: Release documentation and version metadata now begin at v1.0.0; no runtime behavior changes.

### 2026-08-27 - Bookmark Import Merge Policy

**Changes**: JSON backup recovery now merges bookmarks with the same complete normalized HTTP(S) URL by default and unions their tags. Users can explicitly retain duplicate copies; the existing six-tag limit remains, with existing tags taking priority.

**Reason**: Duplicate bookmarks mainly arise when backup sources or browser profiles are merged. Native bookmark APIs allow duplicate URLs, so a user-facing warning alone cannot prevent them.

**Impact**: Extension-managed JSON recovery avoids duplicate creation by default. Native browser imports remain post-creation events and are handled by the existing duplicate-cleanup workflow.

### 2026-08-27 - AI Privacy Protection

**Changes**: Replaced broad sensitivity keywords and the standalone sensitive-bookmark view with structured local checks for login endpoints, credential parameters, and financial/wallet services. Matching bookmarks are excluded from LLM requests.

**Reason**: The useful security boundary is preventing unintended disclosure to a configured LLM. A broad, user-facing sensitivity list produced false positives and did not provide encryption or access control.

**Impact**: The overview now exposes the recycle bin only. AI tagging and categorization retain a local high-risk exclusion rule; ordinary paths such as `/token/guide` and generic dashboards are no longer blocked.

### 2026-08-27 - Same-URL Tag Consistency

**Changes**: Bookmarks whose addresses normalize to the same URL key (ignoring scheme, `www.`, trailing slash, and plain anchors while preserving non-default ports) now share one consistent tag set. AI batch tagging deduplicates by URL key and back-fills the result to every bookmark at that address; manual editing and bulk tagging propagate the tag union to same-address siblings; a "统一同址标签" cleanup action reconciles pre-existing divergence.

**Reason**: Tags are stored per bookmark ID, so duplicates of the same URL could accumulate different tags, especially when the LLM tagged each duplicate separately in different batches.

**Impact**: Same-address bookmarks stay consistently tagged without removing the duplicates themselves (deduplication remains the user's choice via the clean tab).
