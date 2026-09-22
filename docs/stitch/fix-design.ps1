# 按评审反馈修正 13 屏设计稿（幂等：可重复执行，每次以最新修正为准）
# 用法: pwsh -File docs/stitch/fix-design.ps1
#
# 做法：
#   1) DOM 层：把引擎图标的字母色块替换为项目现有的官方 logo（icons/engines/*.svg）
#   2) CSS 层：在 </head> 前追加一个覆盖用 <style> 块（先移除旧块，保证幂等）
#
# 重要：本脚本作用于 *-cn.html。若重新跑了 localize.ps1，需要再跑一次本脚本。
#
# 修正项：
#   1a. 组织/文件夹/隐藏 三处的行操作按钮 → 统一悬浮显示（绝对定位，不占布局）
#   1b. 书签标题 → 占满整行宽度（靠 1a 的绝对定位释放空间）
#   2. 新标签页卡片/列表 内容宽度统一 1080px（以卡片视图为准）
#   3. 新标签页搜索引擎图标 → 官方 logo
#   4. 所有屏复选框 → 16px 方形
#   5. 新标签页搜索框内元素更自然
#   6. 新标签页列表视图搜索框与卡片视图统一
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $root 'docs\stitch\output'

# ---------------------------------------------------------------------------
# 通用块：复选框方形
# ---------------------------------------------------------------------------
$CHECKBOX = @'

    /* ==== 修正 4：复选框统一为 16px 方形 ==== */
    input[type="checkbox"], .checkbox, .item-checkbox,
    .custom-checkbox, .row-checkbox {
      width: 16px; height: 16px; border-radius: 2px;
      accent-color: var(--primary); flex-shrink: 0;
    }
    .custom-checkbox { border-width: 1px; }
'@

# ---------------------------------------------------------------------------
# 通用块：行操作按钮悬浮 + 标题占满整行（修正 1a / 1b）
# ---------------------------------------------------------------------------
$ROWACTIONS = @'

    /* ==== 修正 1a/1b：行操作按钮统一悬浮显示，标题占满整行 ====
       按钮绝对定位在行尾，不占布局空间 —— 因此标题始终使用整行宽度。
       hover / 键盘聚焦时淡入，并用渐变遮罩避免遮挡标题尾部。 */
    .bookmark-row, .item-row { position: relative; }

    .row-actions {
      position: absolute;
      right: var(--space-2);
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: 0;
      flex-shrink: 0;
      opacity: 0;
      pointer-events: none;
      border: none;
      background: linear-gradient(90deg, transparent 0, var(--panel) 26%);
      padding-left: var(--space-4);
      transition: opacity 120ms ease;
    }
    .bookmark-row:hover .row-actions,
    .bookmark-row:focus-within .row-actions,
    .item-row:hover .row-actions,
    .item-row:focus-within .row-actions,
    .row-actions:focus-within {
      opacity: 1;
      pointer-events: auto;
    }
    /* 行内按钮自身也统一为悬浮（原先 hidden 屏有无条件 opacity:1 的规则） */
    .action-secondary, .row-act-btn, .row-action-btn, .row-edit, .row-eye, .row-ai {
      transition: opacity 120ms ease, background-color 120ms ease;
    }
    .action-secondary { opacity: 0; pointer-events: none; }
    .bookmark-row:hover .action-secondary,
    .bookmark-row:focus-within .action-secondary,
    .action-secondary:focus-visible { opacity: 1; pointer-events: auto; }

    /* 标题占满整行并提供省略号 */
    .row-content { flex: 1; min-width: 0; }
    .row-title-line, .row-title { width: 100%; min-width: 0; }
    .row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
'@

# ---------------------------------------------------------------------------
# 通用块：新标签页搜索框内元素（修正 5 / 6）
# ---------------------------------------------------------------------------
$NTSEARCH = @'

    /* ==== 修正 5/6：搜索框内元素更自然 + 两视图统一 ==== */
    .search-bar, .search-bar-shell {
      padding: 0 var(--space-2) 0 6px;
      gap: var(--space-2);
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .search-bar:focus-within, .search-bar-shell:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-soft);
    }
    .engine-picker-btn, .engine-picker-wrapper .engine-picker-btn {
      height: 32px; padding: 0 6px; border-radius: var(--radius-xs);
      font-size: 11px;
      background: transparent; border-color: transparent;
    }
    .engine-picker-btn:hover {
      background: var(--sub); border-color: var(--line);
    }
    /* 官方 logo 取代字母色块（两屏类名不同） */
    .engine-icon, .engine-badge {
      width: 18px; height: 18px;
      border-radius: 4px;
      background: transparent !important;
      border: none !important;
      color: inherit;
      object-fit: contain;
      display: block;
      flex-shrink: 0;
    }
    .match-count, .result-count, .count-badge, .search-count, .results-count {
      background: transparent; border: none;
      color: var(--muted); font-size: 11px; font-weight: 400;
      padding: 0 var(--space-1);
    }

    /* ==== 修正 2b：补齐引擎下拉菜单（两视图一致）====
       注意：cards 原用 var(--shadow-dropdown)，项目 tokens.css 没有该变量，改用 --shadow-lg */
    .engine-menu {
      position: absolute;
      top: calc(100% + var(--space-1));
      left: 0;
      width: 168px;
      background: var(--panel);
      border: 1px solid var(--line-2);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
      padding: var(--space-1);
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 90;
    }
    .engine-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px var(--space-2);
      border: none; background: transparent;
      border-radius: var(--radius-xs);
      font-size: 13px; color: var(--ink-2);
      width: 100%; text-align: left; cursor: pointer;
      transition: background 120ms ease;
    }
    .engine-item:hover { background: var(--sub); }
    .engine-item-left { display: flex; align-items: center; gap: var(--space-2); }
    .engine-item.selected {
      color: var(--primary); font-weight: 500; background: var(--primary-soft);
    }
    .icon-svg-sm {
      width: 12px; height: 12px;
      fill: none; stroke: currentColor; stroke-width: 1.75;
      stroke-linecap: round; stroke-linejoin: round;
    }
'@

# ---------------------------------------------------------------------------
# 通用块：内容宽度统一 1080px（修正 2）
# ---------------------------------------------------------------------------
$NTWIDTH = @'

    /* ==== 修正 2：内容宽度统一 1080px（以卡片视图为准）==== */
    .header-container, .main-content, .header-content, .content-container {
      max-width: 1080px;
    }
'@

# 每屏要应用的块
$perFile = @{
  'organize-v5-cn.html'  = $CHECKBOX + $ROWACTIONS
  'folders-v1-cn.html'   = $CHECKBOX + $ROWACTIONS + @'

    /* ==== 修正 2（文件夹视图）：控件文字不换行 ==== */
    .toolbar-row { flex-wrap: wrap; row-gap: var(--space-1); }
    .segmented-control, .toolbar-actions { flex-shrink: 0; }
    .seg-btn, .tool-btn, .crumb-item { white-space: nowrap; }
    .seg-btn { flex-shrink: 0; }

    /* ==== 修正 1（文件夹视图）：行与「标签」视图一致，去卡片圆角 ==== */
    .item-row {
      height: 44px;
      padding: 0 var(--space-4);
      border: none;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      background-color: var(--panel);
    }
    .item-row:hover { background-color: var(--bg); }
    .item-row.selected {
      background-color: var(--primary-soft);
      border-color: transparent;
      box-shadow: inset 2px 0 0 0 var(--primary);
    }
'@
  'hidden-v1-cn.html'    = $CHECKBOX + $ROWACTIONS
  'overview-v1-cn.html'  = $CHECKBOX + $ROWACTIONS
  'nt-cards-v1-cn.html'  = $CHECKBOX + $NTSEARCH + $NTWIDTH
  'nt-list-v1-cn.html'   = $CHECKBOX + $NTSEARCH + $NTWIDTH
  'options-v1-cn.html'   = $CHECKBOX
  'add-drawer-v1-cn.html'  = $CHECKBOX
  'help-drawer-v1-cn.html' = $CHECKBOX
  'dialogs-v1-cn.html'   = $CHECKBOX
  'feedback-v1-cn.html'  = $CHECKBOX
  'states-v1-cn.html'    = $CHECKBOX
  'ai-flow-v1-cn.html'   = $CHECKBOX + $ROWACTIONS
}

# ---------------------------------------------------------------------------
# 引擎图标：字母色块 → 官方 logo（DOM 替换）
# ---------------------------------------------------------------------------
$logoFor = @{ 'G' = 'google'; 'B' = 'bing'; '百' = 'baidu'; 'D' = 'duckduckgo' }

foreach ($name in ($perFile.Keys | Sort-Object)) {
  $path = Join-Path $outDir $name
  if (-not (Test-Path $path)) { Write-Host ("missing: {0}" -f $name); continue }
  $html = Get-Content $path -Raw
  $notes = @()

  # --- DOM：引擎图标（两屏类名不同：engine-icon / engine-badge）---
  $before = $html
  $html = [regex]::Replace($html, '<span class="engine-(?:icon|badge)"[^>]*>([^<]{1,3})</span>', {
    param($m)
    $ch = $m.Groups[1].Value.Trim()
    if (-not $logoFor.ContainsKey($ch)) { return $m.Value }
    return '<img class="engine-icon" src="../../../icons/engines/' + $logoFor[$ch] + '.svg" alt="" />'
  })
  if ($html -ne $before) { $notes += 'logo' }

  # --- DOM：列表视图缺少引擎下拉菜单，按卡片视图补齐 ---
  if ($name -eq 'nt-list-v1-cn.html' -and $html -notmatch 'class="engine-menu"') {
    $engines = @(
      @{ id = 'google';     label = 'Google';     sel = $true  },
      @{ id = 'bing';       label = 'Bing';       sel = $false },
      @{ id = 'baidu';      label = '百度';        sel = $false },
      @{ id = 'duckduckgo'; label = 'DuckDuckGo'; sel = $false }
    )
    $items = foreach ($e in $engines) {
      $check = if ($e.sel) {
        '<svg class="icon-svg-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      } else { '' }
      '<button class="engine-item' + $(if ($e.sel) { ' selected' } else { '' }) +
      '" type="button" role="menuitem"><div class="engine-item-left">' +
      '<img class="engine-icon" src="../../../icons/engines/' + $e.id + '.svg" alt="" />' +
      '<span>' + $e.label + '</span></div>' + $check + '</button>'
    }
    $menu = '<div class="engine-menu" role="menu">' + ($items -join '') + '</div>'
    $html = [regex]::Replace($html, '(<button class="engine-picker-btn"[\s\S]*?</button>)', ('$1' + $menu), 1)
    if ($html -match 'class="engine-menu"') { $notes += 'menu' }
  }

  # --- CSS：先移除旧修正块（幂等），再追加新块 ---
  $html = $html -replace '(?s)<style>/\* ==== DESIGN FIX.*?</style>\s*', ''
  $block = "<style>/* ==== DESIGN FIX : 评审反馈修正 ==== */" + $perFile[$name] + "`n  </style>`n</head>"
  $html = $html -replace '</head>', $block

  Set-Content -Path $path -Value $html -Encoding UTF8
  Write-Host ("{0,-24} 已应用  {1,7:N1} KB  {2}" -f $name, ((Get-Item $path).Length / 1KB), ($notes -join ','))
}
Write-Host ''
Write-Host '完成。重新打开这些文件即可看到修正结果。'
