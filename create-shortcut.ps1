#requires -Version 5.1
# Creates local + desktop shortcuts for Tonnetz Lite (names do not collide with the full version).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = [System.IO.Path]::GetFullPath($root)
$icon = Join-Path $root 'assets\icon.ico'
$target = Join-Path $root 'launch.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')

function New-Shortcut([string]$path, [string]$description) {
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($path)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $root
  $sc.WindowStyle = 1
  $sc.Description = $description
  if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
}

$made = @()
try {
  $projectLnk = Join-Path $root 'Tonnetz Lite.lnk'
  New-Shortcut $projectLnk 'Launch Tonnetz Lite'
  $made += $projectLnk
} catch { }

try {
  if ($desktop -and (Test-Path -LiteralPath $desktop)) {
    $desktopLnk = Join-Path $desktop 'Tonnetz Lite.lnk'
    New-Shortcut $desktopLnk 'Launch Tonnetz Lite'
    $made += $desktopLnk
  }
} catch { }

try {
  Add-Type -AssemblyName System.Windows.Forms
  $msg = if ($made.Count) { "Shortcuts created:`n" + ($made -join "`n") } else { 'Could not create shortcuts.' }
  [System.Windows.Forms.MessageBox]::Show($msg, 'Tonnetz Lite', 'OK', 'Information') | Out-Null
} catch {
  $made | ForEach-Object { Write-Host $_ }
}