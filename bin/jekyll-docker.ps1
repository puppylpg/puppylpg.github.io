#Requires -Version 5.1
<#
.SYNOPSIS
    Windows 下的 Jekyll 开发服务器管理脚本（基于 Docker）。
.DESCRIPTION
    依赖：Docker Desktop（确保 docker compose 可用）。
    行为与 bin/jekyll-dev.sh 保持一致：start / stop / restart。
    端口可通过环境变量 JEKYLL_PORT 覆盖，默认 4000。
.EXAMPLE
    .\bin\jekyll-dev.ps1 start
    .\bin\jekyll-dev.ps1 stop
    .\bin\jekyll-dev.ps1 restart
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "logs")]
    [string]$Action = ""
)

$ErrorActionPreference = "Stop"

$port = if ($env:JEKYLL_PORT) { $env:JEKYLL_PORT } else { "4000" }

function Show-Usage {
    Write-Host "usage: $PSCommandPath {start|stop|restart|logs}"
}

function Start-Server {
    Write-Host "Starting at http://127.0.0.1:${port}/"
    docker compose up --build -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Server is running in background."
        Write-Host "View logs: $PSCommandPath logs"
        Write-Host "Open site: http://127.0.0.1:${port}/"
    }
}

function Stop-Server {
    docker compose down
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Stopped"
    }
}

function Show-Logs {
    docker compose logs -f
}

switch ($Action) {
    "start"   { Start-Server }
    "stop"    { Stop-Server }
    "restart" { Stop-Server; Start-Server }
    "logs"    { Show-Logs }
    default   { Show-Usage; exit 1 }
}
