# Design Notes

## Threat Model

The extension processes user-controlled bookmark metadata, imported JSON backups, and responses from configured LLM services and GitHub Releases. The primary threats are scriptable URLs, HTML injection in extension pages, accidental secret export, and unnecessary disclosure of bookmark data.

## Security Decisions

- HTML rendering escapes bookmark-derived text before it is interpolated into templates.
- A shared HTTP(S) URL normalizer rejects executable and non-web protocols at creation, import, and navigation boundaries.
- The manifest uses optional host permissions for user-configured LLM origins instead of permanent access to all sites.
- LLM payloads omit URL queries and fragments. Local AI privacy rules exclude bookmarks only when their parsed URL shows a login endpoint, credential parameter, or financial/wallet service signal.
- Backup exports omit LLM settings and API keys.

## Trust Boundaries

Chrome bookmark APIs and local extension storage are local inputs. LLM endpoints and GitHub Releases are remote trust boundaries. Network access to an LLM origin is explicitly approved by the user.

## Accepted Risks

Bookmark titles and paths can still contain private information. AI privacy rules are best-effort and do not encrypt, hide, or isolate bookmarks from browser sync, so users remain responsible for reviewing data before AI processing.

## Change History

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
