# Contributing

## Development

This extension has no runtime build step. Load the repository root through `chrome://extensions` with Developer mode enabled.

Run the required checks before opening a pull request:

```bash
npm test
npm run lint
git diff --check
```

## Pull Requests

- Keep changes focused and add tests for behavior changes.
- Do not commit API keys, exported bookmark backups, or personal browser data.
- Update `README.md`, `CHANGELOG.md`, and `SECURITY.md` when the public behavior or data boundary changes.
