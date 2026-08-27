# Security Policy

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private security advisory form for this repository and include reproduction steps, affected version, and impact. Once the repository is public, maintainers must enable private vulnerability reporting in the repository security settings before accepting external reports.

## Supported Versions

Only the latest release is supported with security fixes.

## Security Boundaries

- Bookmark titles, URLs, folders, tags, imported backups, and release notes are untrusted input.
- New, edited, imported, and opened bookmarks are limited to HTTP(S) URLs.
- LLM requests require a user-granted, origin-specific optional host permission. Remote HTTP endpoints are rejected; HTTP is limited to local Ollama endpoints.
- LLM requests exclude high-sensitivity bookmarks and strip URL queries and fragments.
- Backups do not contain API keys or LLM configuration.

## Known Limitations

Sensitivity detection is heuristic and cannot guarantee that a bookmark title or path contains no private data. Review AI batches before confirming them, and do not use an untrusted LLM endpoint.
