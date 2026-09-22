# 生成指定屏并做合规检查（含重试与请求间隔）
# 用法: pwsh -File docs/stitch/gen-screens.ps1 -Only nt-cards,nt-list,options
param(
  [string]$Only = 'folders,add-drawer,help-drawer,dialogs,feedback,states,ai-flow',
  [int]$GapSeconds = 75
)
$ErrorActionPreference = 'Continue'
$onlyList = @($Only -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$keyPath = Join-Path $env:TEMP 'stitch.key'
if (-not (Test-Path $keyPath)) { Write-Host "missing key file: $keyPath"; exit 1 }
$key = (Get-Content $keyPath -Raw).Trim()
$H = @{ 'X-Goog-Api-Key' = $key; 'Accept' = 'application/json' }
$PROJ = '11811208946110591566'

function Invoke-StitchTool {
  param([string]$Tool, [hashtable]$ToolArgs)
  $p = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'
          params = @{ name = $Tool; arguments = $ToolArgs } } | ConvertTo-Json -Depth 12 -Compress
  try {
    return (Invoke-WebRequest -Uri 'https://stitch.googleapis.com/mcp' -Method Post -Headers $H `
      -ContentType 'application/json' -Body $p -TimeoutSec 300).Content
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $b = ''
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $b = $sr.ReadToEnd() } catch {}
    return "HTTP_ERROR $code $b"
  }
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$md = Get-Content (Join-Path $root 'docs\stitch\prompts.md') -Raw
$sec1 = [regex]::Match($md, '(?s)## 1\. 通用约束块.*?```text\r?\n(.*?)```').Groups[1].Value.Trim()
$sec1 = $sec1.Replace(
  'The attached screenshot shows the CURRENT implementation — use it to understand the existing',
  'The current implementation is described below — use it to understand the existing')

# 新标签页两屏共用同一个头部，且是分两次调用生成的：
# 必须把共享头部块一起拼进去，否则 Stitch 看不到它、会自己编一个（实测会丢掉搜索引擎选择器）
$secHead = [regex]::Match($md, '(?s)## 共享头部.*?```text\r?\n(.*?)```').Groups[1].Value.Trim()
if (-not $secHead) { Write-Host 'WARN: shared-header block not found in prompts.md' }

$all = @(
  @{ key = '2';  name = 'overview';  device = 'MOBILE'  },
  @{ key = '3b'; name = 'hidden';    device = 'MOBILE'  },
  @{ key = '4';  name = 'nt-cards';  device = 'DESKTOP' },
  @{ key = '5';  name = 'nt-list';   device = 'DESKTOP' },
  @{ key = '6';  name = 'options';   device = 'DESKTOP' },
  # 补充屏：子视图 / 抽屉 / 弹层 / 反馈 / 状态 / AI 流程
  @{ key = '7';  name = 'folders';   device = 'MOBILE'  },
  @{ key = '8';  name = 'add-drawer'; device = 'MOBILE' },
  @{ key = '9';  name = 'help-drawer'; device = 'MOBILE' },
  @{ key = '10'; name = 'dialogs';   device = 'MOBILE'  },
  @{ key = '11'; name = 'feedback';  device = 'MOBILE'  },
  @{ key = '12'; name = 'states';    device = 'MOBILE'  },
  @{ key = '13'; name = 'ai-flow';   device = 'MOBILE'  }
)
$screens = $all | Where-Object { $onlyList -contains $_.name }
Write-Host ("targets: " + (($screens | ForEach-Object { $_.name }) -join ', '))
Write-Host ''

$outDir = Join-Path $root 'docs\stitch\output'
$palette = @('#f3f5f8','#ffffff','#0f1117','#171b24','#1b202b','#1e2430','#101828','#344054',
  '#667085','#8b93a3','#c3c9d4','#f2f4f8','#e7ebf0','#dce1e8','#242a36','#303845','#2563eb',
  '#5da2f5','#e9f1fe','#1a2436','#be123c','#fb7185','#b45309','#fbbf24','#059669','#34d399',
  '#202633','#1d4ed8','#fde68a','#7a5d10','#ffe7ec','#3a2229','#fdf1d7','#332a14','#d5f5e7',
  '#12332a','#047857','#6ee7b7')

$first = $true
foreach ($s in $screens) {
  $idx = $s.key
  $nm  = $s.name
  $pattern = '(?s)## ' + $idx + '\. .*?```text\r?\n(.*?)```'
  $sec = [regex]::Match($md, $pattern).Groups[1].Value.Trim()
  if (-not $sec) { Write-Host ("screen {0}: prompt section not found" -f $nm); continue }
  if ($nm -eq 'nt-cards' -or $nm -eq 'nt-list') {
    $prompt = $sec1 + "`n`n" + $secHead + "`n`n" + $sec
  } else {
    $prompt = $sec1 + "`n`n" + $sec
  }

  if (-not $first) { Start-Sleep -Seconds $GapSeconds }
  $first = $false

  Write-Host ("=== {0}  ({1} chars, device={2}) ===" -f $nm, $prompt.Length, $s.device)
  $o = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $o = Invoke-StitchTool 'generate_screen_from_text' @{ projectId = $PROJ; prompt = $prompt; deviceType = $s.device }
    $sw.Stop()
    if ($o -notmatch '^HTTP_ERROR') { break }
    Write-Host ("  attempt {0} failed after {1}s: {2}" -f $attempt, [math]::Round($sw.Elapsed.TotalSeconds,1), $o.Substring(0, [Math]::Min(160, $o.Length)))
    Start-Sleep -Seconds (20 * $attempt)
  }
  if ($o -match '^HTTP_ERROR') { Write-Host "  giving up on $nm"; Write-Host ''; continue }

  $j = $null
  try { $j = $o | ConvertFrom-Json } catch { Write-Host ("  JSON parse failed: " + $o.Substring(0,[Math]::Min(200,$o.Length))); continue }
  if ($j.result.isError) { Write-Host ("  tool error: " + $j.result.content[0].text); continue }

  $sc = ($j.result.structuredContent.outputComponents | Where-Object { $_.design }).design.screens[0]
  $htmlPath = Join-Path $outDir ($nm + '-v1.html')
  Invoke-WebRequest -Uri $sc.screenshot.downloadUrl -OutFile (Join-Path $outDir ($nm + '-v1.png')) -TimeoutSec 120
  Invoke-WebRequest -Uri $sc.htmlCode.downloadUrl -OutFile $htmlPath -TimeoutSec 120
  $h = Get-Content $htmlPath -Raw

  $fs = [regex]::Matches($h, 'font-size:\s*([\d\.]+)px') | ForEach-Object { [double]$_.Groups[1].Value }
  $minfs = ($fs | Measure-Object -Minimum).Minimum
  $found = [regex]::Matches($h, '#[0-9a-fA-F]{6}') | ForEach-Object { $_.Value.ToLower() } | Sort-Object -Unique
  # 搜索引擎图标的品牌色属合理例外（Google/Bing/百度/DuckDuckGo 的 logo），不算设计用色逃逸
  $brandOk = @('#4285f4', '#ea4335', '#fbbc05', '#34a853', '#0078d4', '#008373', '#2932e1', '#de5833')
  $bad = @($found | Where-Object { $palette -notcontains $_ -and $brandOk -notcontains $_ })
  $leak = 0
  foreach ($k in @('Loading State', 'Empty State', 'Error State', 'Required States')) {
    $leak += ([regex]::Matches($h, [regex]::Escape($k))).Count
  }

  Write-Host ("  OK  {0} KB   screen={1}" -f [math]::Round((Get-Item $htmlPath).Length / 1KB, 1), $sc.id)
  Write-Host ("  minFont={0}px | paletteEscapes={1} | promptLeak={2} | prefersColorScheme={3}" -f `
    $minfs, $bad.Count, $leak, $(if ($h -match 'prefers-color-scheme') { 'yes' } else { 'no' }))
  if ($bad.Count -gt 0) { Write-Host ("    escapes: " + ($bad -join ' ')) }
  Write-Host ''
}
