#requires -Version 5.1
# Tonnetz Lite local static server. Loopback only.
param(
  [int]$Port = 8850,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = [System.IO.Path]::GetFullPath($root)
$runtime = Join-Path $root '.runtime'
if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.webp' = 'image/webp'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.map'  = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$prefix = "http://127.0.0.1:$Port/"
try {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add($prefix)
  $listener.Start()
} catch {
  $message = "Cannot start server on port $Port : $($_.Exception.Message)"
  Write-Host $message -ForegroundColor Red
  try {
    $runtime = Join-Path $root '.runtime'
    if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
    Add-Content -LiteralPath (Join-Path $runtime 'server-error.log') -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
  } catch { }
  Write-Host "Fallback: python serve.py --port $Port --no-browser" -ForegroundColor Yellow
  exit 1
}

$PID | Out-String | Set-Content -Path (Join-Path $runtime 'server.pid') -Encoding ASCII
if (-not $Quiet) {
  Write-Host "Tonnetz Lite server started: $prefix" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop."
}

function Send-Bytes {
  param($Context, [byte[]]$Bytes, [string]$ContentType, [int]$Status = 200, [string]$Cache = 'no-store')
  $res = $Context.Response
  $res.StatusCode = $Status
  $res.ContentType = $ContentType
  $res.Headers['Cache-Control'] = $Cache
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  $res.ContentLength64 = $Bytes.Length
  if ($Context.Request.HttpMethod -ne 'HEAD') {
    $res.OutputStream.Write($Bytes, 0, $Bytes.Length)
  }
  $res.OutputStream.Close()
}

function Send-Text {
  param($Context, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8', [int]$Status = 200)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Send-Bytes -Context $Context -Bytes $bytes -ContentType $ContentType -Status $Status
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $req = $context.Request
      $path = $req.Url.AbsolutePath
      if ($path -eq '/api/ping') {
        Send-Text -Context $context -Text '{"app":"tonnetz-lite","ok":true}' -ContentType 'application/json; charset=utf-8'
        continue
      }
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
      $rel = [System.Uri]::UnescapeDataString($path).TrimStart('/')
      $rel = $rel -replace '/', [System.IO.Path]::DirectorySeparatorChar
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      $rootFull = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Text -Context $context -Text '403 Forbidden' -Status 403
        continue
      }
      if (Test-Path -LiteralPath $full -PathType Container) {
        $full = Join-Path $full 'index.html'
      }
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text -Context $context -Text "404 Not Found: $rel" -Status 404
        continue
      }
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $ctype = $mime[$ext]
      if (-not $ctype) { $ctype = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $cache = if ($ext -eq '.png' -or $ext -eq '.jpg' -or $ext -eq '.ico' -or $ext -eq '.woff2') { 'public, max-age=3600' } else { 'no-store' }
      Send-Bytes -Context $context -Bytes $bytes -ContentType $ctype -Cache $cache
    } catch {
      try { Send-Text -Context $context -Text '500 Internal Server Error' -Status 500 } catch { }
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch { }
  try { Remove-Item -LiteralPath (Join-Path $runtime 'server.pid') -Force -ErrorAction SilentlyContinue } catch { }
}