# Local Jekyll dev helper (Windows -> WSL).
# Usage: .\bin\jekyll-dev.ps1 start|stop|restart|status|sync

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "sync", "help")]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WslRepo = (wsl -e wslpath -a $RepoRoot).Trim()

if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    Write-Error "WSL is required. Install WSL or run bin/jekyll-dev.sh inside Linux."
}

# Run in repo dir; pass JEKYLL_REPO_ROOT so ROOT is never resolved as /
$bashCmd = "export JEKYLL_REPO_ROOT='$WslRepo'; cd '$WslRepo' && sed 's/\r$//' bin/jekyll-dev.sh | bash -s -- $Command"

wsl -e bash -lc $bashCmd

if ($Command -eq "start" -or $Command -eq "restart") {
    Write-Host ""
    Write-Host "Open: http://127.0.0.1:4000/"
}
