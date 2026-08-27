# Design Notes

## Threat Model

The extension processes user-controlled bookmark metadata, imported JSON backups, and responses from configured LLM services and GitHub Releases. The primary threats are scriptable URLs, HTML injection in extension pages, accidental secret export, and unnecessary disclosure of bookmark data.

## Security Decisions

- HTML rendering escapes bookmark-derived text before it is interpolated into templates.
- A shared HTTP(S) URL normalizer rejects executable and non-web protocols at creation, import, and navigation boundaries.
- The manifest uses optional host permissions for user-configured LLM origins instead of permanent access to all sites.
- LLM payloads omit URL queries and fragments, and high-sensitivity bookmarks are excluded.
- Backup exports omit LLM settings and API keys.

## Trust Boundaries

Chrome bookmark APIs and local extension storage are local inputs. LLM endpoints and GitHub Releases are remote trust boundaries. Network access to an LLM origin is explicitly approved by the user.

## Accepted Risks

Bookmark titles and paths can still contain private information. Sensitivity detection is best-effort, so users remain responsible for reviewing data before AI processing.

## Change History

### 2026-08-27 - Public Release Baseline

**Changes**: Establish the public version baseline at 1.0.0 and add the repository's first public changelog entry.

**Reason**: The repository is being released as a new open-source project without prior public release history.

**Impact**: Release documentation and version metadata now begin at v1.0.0; no runtime behavior changes.
