# 把 Stitch 生成的英文设计稿本地化为中文
# 用法: pwsh -File docs/stitch/localize.ps1
#
# 原则:
#   1. UI 文案取自项目真实用语（popup.html / newtab.html / options.html 的现有中文串），
#      保证设计稿与产品用词一致，移植时零翻译损耗。
#   2. 只替换文本节点（>text<）与少数属性（placeholder / title / aria-label），
#      不碰 CSS 类名、选择器、注释。
#   3. 域名保留英文（真实书签里域名本来就是英文）；书签标题与标签中文化。
#   4. 字体栈补入中文字体，否则中文会 fallback 到系统默认字形。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $root 'docs\stitch\output'

# ---------------------------------------------------------------- UI 文案
$ui = [ordered]@{
  # 导航与结构
  'Overview' = '概览'; 'Organize' = '组织'; 'Hidden' = '隐藏'
  'Tags' = '标签'; 'Folders' = '文件夹'; 'Directory tree' = '目录树'
  'All' = '全部'; 'All Bookmarks' = '全部书签'; 'All Folders' = '全部文件夹'
  'Actions' = '操作'; 'Selected' = '已选'; 'Drop here' = '拖到此处'
  'Move' = '移动'; 'Delete' = '删除'; 'Edit' = '编辑'; 'Copy' = '复制'
  'Copy link' = '复制链接'; 'Hide' = '隐藏'; 'Unhide' = '取消隐藏'
  'Add Tag' = '打标签'; 'AI Tag' = 'AI 打标'; 'Clear filters' = '清除筛选'
  'Open' = '打开'; 'Open link' = '打开链接'; 'Retry' = '重试'; 'Cancel' = '取消'
  'Confirm' = '确认'; 'Done' = '完成'; 'Close' = '关闭'; 'Save' = '保存'
  'Filters' = '筛选'; 'Filter' = '筛选'; 'Folder' = '文件夹'; 'Tag' = '标签'
  'New' = '新建'; 'Search' = '搜索';

  # 概览屏
  'Total' = '书签总数'; 'Cleanup' = '待清理'; 'Recycle Bin' = '回收站'
  'Trash Bin' = '回收站'; 'Duplicates' = '重复书签'; 'Empty Folders' = '空文件夹'
  'Popular Tags' = '热门标签'; 'Quick Maintenance' = '快捷维护'
  'Rescan Bookmarks' = '重新扫描'; 'More' = '更多'; 'Top 8' = '前 8 个'

  # 设置页
  'AI Tagging' = 'AI 分类'; 'Appearance' = '新标签页外观'
  'Browser & Sync' = '浏览器集成'; 'Danger Zone' = '危险操作'
  'Card View' = '卡片视图'; 'Compact List' = '紧凑列表'
  'Dark' = '始终深色'; 'Light' = '始终浅色'; 'System' = '跟随系统'
  'Color Theme' = '页面配色'; 'Content width' = '内容区宽度'
  'Model name' = '模型名'; 'Provider' = '服务商 / 协议'
  'Clear Recycle Bin' = '清空回收站'; 'Export Backup' = '导出备份'
  'Restore Backup' = '恢复备份'; 'Test Connection' = '测试连接'
  'Fetch models' = '获取模型列表'; 'Custom model name...' = '自定义模型名…'
  'API Key' = 'API Key'; 'Base URL' = 'Base URL'
  'Background Color' = '背景颜色'; 'Reset' = '重置'; 'Default' = '默认'
  'Connected' = '连接正常'; 'Active' = '已启用'; 'Configured' = '已配置'
  'Items' = '项'; 'matches' = '个匹配'; 'bookmarks' = '个书签'
  'Default View Mode' = '默认视图模式'; 'Empty Recycle Bin' = '清空回收站'
  'Export Full Bookmark Backup' = '导出完整书签备份'; 'Export JSON' = '导出 JSON'
  'Extension Settings' = '扩展设置'
  'Fixed Tag Pool' = '固定标签池'; 'Open manager panel' = '打开管理面板'
  'Backup & Restore' = '书签备份 / 恢复'; 'Tag System' = '标签体系'
  'Browser Integration' = '浏览器集成'; 'New Tab Appearance' = '新标签页外观'
  'Enabled' = '已启用'; 'Disabled' = '已关闭'; 'Never' = '从未'
  'Web Workers & SharedArrayBuffer Guide' = 'Web Workers 与 SharedArrayBuffer 指南'
  'Patterns of Distributed Systems Guide' = '分布式系统模式指南'
  'Sort by date added' = '按添加时间排序'; 'Sort by last visited' = '按最近访问排序'
  'Sort by title' = '按标题排序'
  'Sorted by date added' = '已按添加时间排序'; 'Sorted by last visited' = '已按最近访问排序'
  'Sorted by title' = '已按标题排序'
  'Source' = '来源'; 'Folder Path' = '所在文件夹'; 'Host' = '站点'
  'Navigation' = '导航'; 'Help' = '帮助'; 'Threading' = '线程'
  'Import JSON' = '导入 JSON'; 'Instant Save' = '即时保存'
  'LLM Provider' = 'LLM 服务商'; 'Maximum Content Width' = '最大内容宽度'
  'Metadata Storage Mode' = '元数据存储方式'; 'Dev, OpenSource' = '开发, 开源'
  'New-Tab Appearance' = '新标签页外观'; 'Rescan Now' = '立即重新扫描'
  'Reset All Custom Metadata' = '重置全部自定义元数据'; 'Reset Tag Data' = '重置标签数据'
  'Surface Background Tone' = '表面背景色调'; 'Sync Status Summary' = '同步状态摘要'
  'System Auto' = '跟随系统'; 'Target Model' = '目标模型'
  'Two-Way Browser Synchronization' = '浏览器双向同步'; 'Zero External Telemetry' = '零外部遥测'
  'Web API / Cryptography' = 'Web API / 加密'
  'Title' = '标题'; 'Theme' = '主题'; 'Sync' = '同步'

  # ---- 补充屏（文件夹视图 / 抽屉 / 弹层 / 反馈 / 状态 / AI 流程）----
  'Bookmark Manager - Organize Tab (Folders View)' = '书签管家 · 组织（文件夹视图）'
  'Bookmark Manager - Add Bookmark Drawer (360px Side Panel)' = '书签管家 · 新增书签抽屉'
  'Bookmark Manager - User Guide & Shortcuts Drawer' = '书签管家 · 操作指南抽屉'
  'Bookmark Manager - Dialog Family Component Sheet' = '书签管家 · 弹层族'
  'Bookmark Manager - Feedback & Notification Component Sheet' = '书签管家 · 反馈与提示'
  'Bookmark Manager - List Lifecycle States Sheet (360px)' = '书签管家 · 列表状态'
  'Bookmark Manager - AI Tagging Storyboard (360px Side Panel)' = '书签管家 · AI 打标流程'
  'Feedback & Notification' = '反馈与提示'; 'Toggle Theme' = '切换主题'
  'Dialog Family Component Sheet' = '弹层族规格板'
  'Lifecycle States Sheet' = '列表状态规格板'
  'List states component specifications' = '列表状态组件规范'
  'User Guide & Shortcuts' = '操作指南'
  # 文件夹视图
  'Bookmarks (4)' = '书签（4）'; 'Folders (3)' = '文件夹（3）'
  'Bookmarks Bar' = '书签栏'; 'Engineering' = '工程'; 'Frontend' = '前端'
  'Sort: Manual' = '排序：手动'; 'Tree' = '目录树'
  'Radix Primitives: Unstyled Accessible UI' = 'Radix Primitives：无样式无障碍组件'
  'Radix Primitives: Unstyled Accessible UI Components Guide' = 'Radix Primitives：无样式无障碍组件指南'
  'Ollama (Local localhost:11434)' = 'Ollama（本地 localhost:11434）'
  'RFC 9110: HTTP Semantics Specification' = 'RFC 9110：HTTP 语义规范'
  'RFC 9110: HTTP Semantics' = 'RFC 9110：HTTP 语义'
  # 新增书签抽屉
  'Add Bookmark' = '新增书签'; 'Save Bookmark' = '保存书签'
  'Architecture & Specs' = '架构与规范'; 'Specs' = '规范'
  'Design Tokens Spec 2024' = '设计令牌规范 2024'
  'Search folders or bookmarks...' = '搜索文件夹或书签…'
  'Suggested by domain rule:' = '域名规则建议：'
  'URL already exists in bookmarks. Saving will merge tags.' = '该网址已存在，保存后会合并标签'
  # 帮助抽屉
  'Primary Entries' = '主要入口'; 'General Tips' = '通用技巧'
  'Keyboard Shortcuts' = '键盘快捷键'; 'Quick search palette' = '快速搜索'
  'Focus search box' = '聚焦搜索框'; 'Navigate items up / down' = '上下移动高亮行'
  'Open highlighted bookmark' = '打开高亮书签'
  'Open link in background' = '后台打开高亮书签'
  'Move bookmark in folder' = '在文件夹内移动书签'
  'Open this user guide' = '打开本指南'
  'Close drawer or overlay' = '关闭抽屉 / 弹层'
  'to open in background tab.' = '在后台标签页打开。'
  'Click the four-pointed sparkle icon' = '点击四角星图标'
  'Engineering & Specs' = '工程与规范'; 'Engineering & Standards' = '工程与规范'
  'Design Tokens' = '设计令牌'
  'Preview Theme:' = '预览主题：'; 'View source on' = '查看源码：'
  # 弹层族
  'Confirm Delete' = '确认删除'; 'Rename Tag' = '重命名标签'
  'Manage Fixed Tag Pool' = '管理标签（固定池）'
  'Filter by Folder' = '按文件夹筛选'
  'This action cannot be undone' = '此操作不可撤销'
  'Existing folder structure will be updated' = '现有文件夹结构将被更新'
  'Curated tags constrain automated suggestion rules.' = '固定标签池会约束自动建议规则。'
  'Frontend Architecture' = '前端架构'; 'Design System' = '设计系统'
  'Overwrite' = '覆盖'; 'Skip' = '跳过'; 'Save Tag' = '保存标签'
  # 状态与 AI 流程
  'Scanning...' = '正在扫描…'; 'Processing' = '处理中'; 'Remaining' = '剩余'
  'Accounts & Security' = '账户与安全'
  'Internal VPN Access Dashboard' = '内部 VPN 访问面板'
  'Online Banking Login & Portal' = '网银登录与门户'
  'SQLite in the Browser: WASM & OPFS' = '浏览器中的 SQLite：WASM 与 OPFS'
}

# ---------------------------------------------------------------- 短语级替换（较长者优先）
$phrases = [ordered]@{
  'Bookmark Manager - Organize Tab'   = '书签管家 · 组织'
  'Bookmark Manager - Hidden Tab'     = '书签管家 · 隐藏'
  'Bookmark Manager - Compact List View' = '书签管家 · 紧凑列表视图'
  'Bookmark Manager - New Tab'        = '书签管家 · 新标签页'
  # 快捷键提示
  'Focus search' = '聚焦搜索'; 'Navigate' = '导航'
  'clear' = '清空'; 'Open URL' = '打开网址'; 'Showing' = '显示'
  # 长标题变体
  'Patterns of Distributed Systems Guide (Fowler)' = '分布式系统模式指南（Fowler）'
  'Design Tokens Community Group Spec (DTCG format 2024.1)' = '设计令牌社区组规范（DTCG 格式 2024.1）'
  'WebCrypto SubtleCrypto API Reference Documentation' = 'WebCrypto SubtleCrypto API 参考文档'
  # 设置页带括号的状态
  'Clear Recycle Bin (14 items)' = '清空回收站（14 项）'
  'Extension Storage (chrome.storage.local)' = '扩展存储（chrome.storage.local）'
  'High Contrast Clean (var(--panel))' = '高对比度清朗（var(--panel)）'
  'Standard Neutral (var(--bg))' = '标准中性（var(--bg)）'
  'New-Tab Appearance (Card view, Auto)' = '新标签页外观（卡片视图、自动）'
  'tag1, tag2' = '标签1, 标签2'
  'Bookmark Manager - Overview'       = '书签管家 · 概览'
  'Restore All' = '全部取消隐藏'; 'Restore' = '取消隐藏'
  'Hidden bookmarks:' = '已隐藏书签：'
  'Hidden Bookmarks' = '已隐藏书签'
  'Bookmark Manager - New Tab Card View'       = '书签管家 · 新标签页（卡片）'
  'Bookmark Manager - New Tab Compact List View' = '书签管家 · 新标签页（列表）'
  'Bookmark Manager - Settings'       = '书签管家 · 设置'
  'Bookmark Manager'                  = '书签管家'
  'AI tagging · DeepSeek configured'  = 'AI 分类 · 已配置 DeepSeek'
  'AI Tagging (DeepSeek configured)'  = 'AI 分类（已配置 DeepSeek）'
  'Browser & sync · Native tree synced' = '浏览器集成 · 已同步'
  'Browser & sync (Chrome bookmarks OK)' = '浏览器集成（Chrome 书签正常）'
  'Appearance · Card view, Auto width' = '新标签页外观 · 卡片视图、自动宽度'
  'Danger zone · 14 items in recycle bin' = '危险操作 · 回收站 14 项'
  'Danger Zone (Recycle bin, backup)' = '危险操作（回收站、备份）'
  'Automated Classification Rules'    = '自动分类规则'
  'Connection Diagnostic'             = '连接诊断'
  'Custom Endpoint (OpenAI spec)'     = '自定义端点（OpenAI 兼容）'
  'Anthropic (Claude Compatible)'     = 'Anthropic（Claude 兼容）'
  'Browser Cloud Sync (chrome.storage.sync - 100KB limit)' = '浏览器云同步（chrome.storage.sync，上限 100KB）'
  '1080px (Standard compact)'         = '1080px（紧凑）'
  '1440px (Default balanced)'         = '1440px（默认）'
  '1720px (Wide monitor)'             = '1720px（宽屏）'
  '2560px (4K expanded)'              = '2560px（超宽 2K）'
  'Auto (Full browser width)'         = '自动铺满（跟随屏幕）'
  'Connected (200 OK - latency 182ms)' = '连接正常（200 OK，延迟 182ms）'
  '212 tagged items'                  = '212 个已打标'
  '6 duplicates, 3 empty'             = '6 个重复、3 个空文件夹'
  'Across 18 folders'                 = '分布于 18 个文件夹'
  'Auto-delete in 12d'                = '12 天后自动清理'
  '2 Selected'                        = '已选 2 项'
  '4 items'                           = '4 项'
  '12 matches'                        = '12 个匹配'
  'Skeleton Loading State'            = '加载骨架屏'
  'Empty State (Filter Mismatch)'     = '空状态（筛选无结果）'
  'Loading State'                     = '加载中'
  'Empty State'                       = '空状态'
}

# ---------------------------------------------------------------- 分组名 / 书签标题 / 标签
$content = [ordered]@{
  # 分组名
  'Architecture & Standards'          = '架构与标准'
  'Architecture & Distributed Systems' = '架构与分布式系统'
  'Design Systems & Tokens'           = '设计系统与令牌'
  'Security & Privacy'                = '安全与隐私'
  'Security & Crypto'                 = '安全与加密'
  # 书签标题
  'Design Tokens Community Group Spec'          = '设计令牌社区组规范'
  'Design Tokens Community Group Spec (DTCG format)' = '设计令牌社区组规范（DTCG 格式）'
  'Patterns of Distributed Systems'             = '分布式系统模式'
  'Patterns for Building Resilient Microservices' = '构建弹性微服务的模式'
  'Modern CSS Fluid Typography Calculator'      = '现代 CSS 流式排版计算器'
  'Modern CSS Fluid Typography Calculator & Method' = '现代 CSS 流式排版计算器与方法'
  'Color Contrast Matrix & WCAG Checker'        = '色彩对比度矩阵与 WCAG 检查器'
  'Color Contrast Matrix & WCAG Contrast Algorithm Checker' = '色彩对比度矩阵与 WCAG 算法检查器'
  'Content Security Policy (CSP) Directives'    = '内容安全策略（CSP）指令'
  'Content Security Policy (CSP) Directives Reference' = '内容安全策略（CSP）指令参考'
  'OWASP Top 10 API Security Risks'             = 'OWASP Top 10 API 安全风险'
  'OWASP Top 10 API Security Risks & Mitigation' = 'OWASP Top 10 API 安全风险与缓解'
  'WebCrypto SubtleCrypto API Reference Specs'  = 'WebCrypto SubtleCrypto API 参考规范'
  'Legacy System API Deprecations Roadmap'      = '遗留系统 API 弃用路线图'
  'Archive' = '归档'; 'Deprecated' = '已弃用'
  'OWASP Top 10:2021 Security Risks'            = 'OWASP Top 10：2021 安全风险'
  'Passkeys & WebAuthn Integration Patterns'    = 'Passkey 与 WebAuthn 集成模式'
  'Passkeys & WebAuthn Integration Patterns (FIDO)' = 'Passkey 与 WebAuthn 集成模式（FIDO）'
  'SQLite in the Browser: Official WASM Build'  = '浏览器中的 SQLite：官方 WASM 构建'
  'WebCrypto SubtleCrypto API Reference'        = 'WebCrypto SubtleCrypto API 参考'
  'Math Routines & Algorithms'                  = '数学例程与算法'
  'Roboto Flexjure Acknowledged (H'             = '可变字体与排版实践'
  # 标签
  'a11y' = '无障碍'; 'api' = '接口'; 'arch' = '架构'; 'network' = '网络'
  'crypto' = '加密'; 'css' = '样式'; 'database' = '数据库'; 'databases' = '数据库'
  'browser' = '浏览器'; 'backend' = '后端'; 'audit' = '审计'; 'auth' = '认证'
  'headers' = '请求头'; 'standards' = '规范'; 'passkeys' = '通行密钥'
  'security' = '安全'; 'privacy' = '隐私'; 'tokens' = '令牌'; 'design' = '设计'
  'dev' = '开发'; 'docs' = '文档'; 'webapi' = 'Web API'; 'mv3' = 'MV3'
  'architecture' = '架构'; 'components' = '组件'; 'contrast' = '对比度'
  'typography' = '排版'; 'sqlite' = 'SQLite'
}

# 归一化：大小写不敏感匹配用的查找表
$lookup = @{}
foreach ($src in @($phrases, $content, $ui)) {
  foreach ($k in $src.Keys) { if (-not $lookup.ContainsKey($k)) { $lookup[$k] = $src[$k] } }
}
# 长键优先，避免 "Overview" 抢先替换掉 "Bookmark Manager - Overview"
$keysByLength = $lookup.Keys | Sort-Object { $_.Length } -Descending

$files = @('organize-v5.html', 'overview-v1.html', 'hidden-v1.html',
           'nt-cards-v1.html', 'nt-list-v1.html', 'options-v1.html',
           'folders-v1.html', 'add-drawer-v1.html', 'help-drawer-v1.html',
           'dialogs-v1.html', 'feedback-v1.html', 'states-v1.html', 'ai-flow-v1.html')

foreach ($f in $files) {
  $path = Join-Path $outDir $f
  if (-not (Test-Path $path)) { Write-Host "missing: $f"; continue }
  $html = Get-Content $path -Raw
  $before = $html

  # 1) 文本节点替换（只处理 >text<，不碰标签属性与 CSS）
  #    大小写不敏感；含 " / " 的路径类文本按段替换
  $html = [regex]::Replace($html, '>([^<>]+)<', {
    param($m)
    $inner = $m.Groups[1].Value
    $t = $inner.Trim()
    if ($t.Length -eq 0) { return $m.Value }
    foreach ($k in $keysByLength) {
      if ($t.Equals($k, [System.StringComparison]::OrdinalIgnoreCase)) {
        return '>' + $inner.Replace($t, $lookup[$k]) + '<'
      }
    }
    if ($t -match ' / ') {
      $segs = $t -split ' / '
      $out = @(); $hit = $false
      foreach ($s in $segs) {
        $s2 = $s.Trim(); $done = $false
        foreach ($k in $keysByLength) {
          if ($s2.Equals($k, [System.StringComparison]::OrdinalIgnoreCase)) {
            $out += $lookup[$k]; $hit = $true; $done = $true; break
          }
        }
        if (-not $done) { $out += $s2 }
      }
      if ($hit) { return '>' + $inner.Replace($t, ($out -join ' / ')) + '<' }
    }
    return $m.Value
  })

  # 2) 常见属性
  foreach ($attr in @('placeholder', 'title', 'aria-label')) {
    $ap = $attr + '="([^"]+)"'
    $html = [regex]::Replace($html, $ap, {
      param($m)
      $val = $m.Groups[1].Value
      foreach ($k in $keysByLength) {
        if ($val.Equals($k, [System.StringComparison]::OrdinalIgnoreCase)) { return $m.Value.Replace($val, $lookup[$k]) }
      }
      return $m.Value
    })
  }

  # 3) 字体栈补中文字体
  $html = [regex]::Replace($html, '(--font[a-z-]*:\s*)([^;}]+)(;)', {
    param($m)
    $val = $m.Groups[2].Value
    if ($val -match 'PingFang|YaHei|Hiragino') { return $m.Value }
    if ($val -match 'mono|Consolas|SF Mono') {
      return $m.Groups[1].Value + $val.TrimEnd() + ", 'PingFang SC', 'Microsoft YaHei'" + $m.Groups[3].Value
    }
    return $m.Groups[1].Value + "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif" + $m.Groups[3].Value
  })
  # 没有变量、直接写死字体栈的
  $html = [regex]::Replace($html, '(font-family:\s*)(-apple-system[^;}]+)(;)', {
    param($m)
    $val = $m.Groups[2].Value
    if ($val -match 'PingFang|YaHei') { return $m.Value }
    return $m.Groups[1].Value + "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif" + $m.Groups[3].Value
  })

  $outName = $f -replace '\.html$', '-cn.html'
  $outPath = Join-Path $outDir $outName
  Set-Content -Path $outPath -Value $html -Encoding UTF8

  $changed = if ($html -ne $before) { 'yes' } else { 'no' }
  Write-Host ("{0,-20} -> {1,-26} {2,7:N1} KB  changed={3}" -f $f, $outName, ((Get-Item $outPath).Length / 1KB), $changed)
}
