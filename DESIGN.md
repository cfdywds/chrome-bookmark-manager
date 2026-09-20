# Design Notes

## Architecture

The extension is a zero-build Chrome / Edge Manifest V3 project. `popup.html` provides the side-panel workflow, `newtab.html` provides bookmark browsing on new tabs, `options.html` manages preferences, and `js/background.js` owns bookmark events, alarms, and cross-context coordination. Shared bookmark, tag, backup, and AI utilities live in `js/lib.js`.

Chrome bookmarks remain the source of truth for bookmark nodes. Extension-only state, including tags, fixed tag pools, rules, hidden state, recycle-bin records, and LLM profiles, is stored locally. When native tag sync is enabled, tags and hidden state are additionally serialized by normalized URL for cross-device hydration. JSON backup and restore use the compact V4 format; it preserves recoverable bookmark and extension data while excluding browser-generated node metadata.

## Native Tag Sync

Native tag sync is optional. When enabled, tags and hidden state keyed by normalized URL, fixed tag pools, and custom tag rules are serialized into the protected `书签管家同步数据（请勿修改）` bookmark folder. Chrome bookmark sync carries that folder to Chrome devices signed into the same Google account. A URL's hidden state is applied to all matching local bookmark IDs because browser bookmark IDs are device-local.

The payload uses revisioned chunks and a head pointer. A reader only applies a complete revision, so Chrome bookmark events arriving out of order cannot overwrite local state with partial data. The protected folder is ignored by bookmark listing, cleanup, search, and backup workflows. Each device must load the unpacked extension manually; matching extension IDs are unnecessary.

## Security Decisions

- Bookmark-derived text is escaped before it is inserted into extension HTML.
- A shared HTTP(S) URL normalizer rejects executable and non-web protocols at creation, import, and navigation boundaries.
- The manifest requests optional, origin-specific host permissions for user-configured LLM endpoints instead of permanent access to all sites.
- LLM payloads exclude URL queries and fragments. Local privacy rules block requests for login endpoints, credential parameters, and financial or wallet services.
- Background AI tagging is opt-in, skips native bulk imports and high-confidence rule matches, and falls back to local rules when a remote request fails.
- Backups omit LLM settings and API keys. Native tag sync omits bookmark titles, API keys, LLM profiles, and recycle-bin records.

## UI Design System

`css/tokens.css` is the single design-token source for all three extension pages and both themes. Colour literals live once in the `--c-*` scale (`-l` light / `-d` dark variants); the semantic variables that components consume (`--bg`, `--panel`, `--ink`, `--line`, `--primary`, `--danger`, `--field-bg`, `--surface-sub`, …) only map onto those scale values. Dark mode and the new-tab explicit themes (`data-nt-theme`) are variable remaps on `:root`, so component rules contain no dark-mode patch selectors.

`js/ui.js` provides the shared interaction primitives: focus trapping with focus restore for modals and drawers (`UI.focusTrap` / `UI.releaseTrap`), an Esc-handler stack (`UI.onEscape`), one delayed tooltip driven by `data-tip`, level-aware toasts (`UI.toast(message, level, action, options)`), and a shortcut registry that renders the side-panel help drawer so documentation cannot drift from behaviour.

`icons/sprite.svg` is the only icon source. Pages and scripts reference `icons/sprite.svg#i-*` instead of inlining SVG markup.

## UI Redesign Follow-up

- 备份、恢复和清空回收站属于可能造成数据变化的操作，统一放在 options 页底部「危险操作」区；popup 保留日常回收站浏览和单项恢复能力。
- options 的危险操作确认复用 `UI.focusTrap`，避免原生 `window.confirm` 与其他页面交互不一致。
- newtab 文件夹计数使用可见书签数量，文件夹缓存签名包含根节点、父级、标题、计数和子目录顺序，保证隐藏状态与重排后的下拉内容及时更新。
- newtab 文件夹筛选使用自定义可访问 listbox，保留上下键、Home/End、Enter 和 Esc 操作，选项使用缩进引导线、文件夹图标与胶囊计数表达层级，并在加载期间显示状态。
- newtab 列表视图与卡片视图分工明确：卡片负责「看」，列表负责「找」。列表单行承载 favicon、标题、站点、目录、标签五列，行高 28px（卡片 112px），固定列宽保证跨行对齐，整块只有一条外框线和行分隔线，不再逐行叠卡片（那会退化成单列卡片网格）；目录列给出卡片给不出的所在文件夹，完整路径退到 tooltip。标签列最多两项加余数，操作区按需显出、触屏设备保持常驻。
- newtab 列表视图的窄屏策略是逐级收敛列而非换行：≤1040px 去掉目录列，≤900px 压缩站点与标签列，≤760px 退成「标题 + 站点/标签」两行（实际约 52px，仍远低于卡片）。虚拟化占位高度（桌面 28px、窄屏 52px）必须与行高同步，否则滚动条长度会跳；删除收尾后清理乐观状态，避免长时间打开的页面保留旧 ID。
- newtab 的隐藏与删除采用乐观列表更新，删除后的回收站确认和标签清理异步收尾；成功提示支持 compact 模式，短文本、短停留时间和轻量操作按钮降低打断感。
- 清理改造前未被 HTML/JS 引用的旧 CSS 选择器，保留动态生成和当前页面仍使用的样式。

## Trust Boundaries

Chrome bookmark APIs, Chrome bookmark sync, imported JSON, and local extension storage are user-data inputs. Configured LLM endpoints are remote trust boundaries. Network access to an LLM origin requires explicit user approval.

## Accepted Risks

Bookmark titles and paths can still contain private information. AI privacy rules are best-effort outbound safeguards; they do not encrypt, hide, or isolate browser data. Native tag sync exposes tag and rule text to Chrome bookmark sync under the user's Google account, so users should not use it for confidential labels.
