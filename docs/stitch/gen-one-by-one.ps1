# 逐屏生成：每屏启动一个独立 pwsh 进程
# 原因：实测同一进程内连续调用 generate_screen_from_text，第一屏成功后后续必失败
#       （耗时 0s、无 HTTP 状态码、连接层错误）；独立进程可稳定成功。
# 用法: pwsh -File docs/stitch/gen-one-by-one.ps1 -Screens add-drawer,help-drawer
param(
  [string]$Screens = 'add-drawer,help-drawer,dialogs,feedback,states,ai-flow',
  [int]$PauseSeconds = 25
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path $root 'docs\stitch\gen-screens.ps1'
$list = @($Screens -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

Write-Host ("will generate: " + ($list -join ', '))
Write-Host ''
foreach ($s in $list) {
  Write-Host ("########## {0} ##########" -f $s)
  & pwsh -NoProfile -File $script -Only $s -GapSeconds 0 2>&1 | ForEach-Object { $_ }
  Write-Host ("---------- {0} done ----------" -f $s)
  Start-Sleep -Seconds $PauseSeconds
}
Write-Host 'ALL DONE'
