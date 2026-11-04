<#
.SYNOPSIS
  一键部署：MySQL + Spring Boot + Nginx（Docker Compose）

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipBuild
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Logs
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Down
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Down,
    [switch]$Logs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-EnvFile([string]$path) {
    $map = @{}
    if (Test-Path $path) {
        Get-Content $path | ForEach-Object {
            if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $map[$matches[1]] = $matches[2] }
        }
    }
    return $map
}

function Assert-Docker {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker 未运行：请先启动 Docker Desktop，再执行本脚本'
    }
}

Assert-Docker

# ---------- 停止 / 看日志 ----------
if ($Down) {
    Write-Host '[down] 停止并移除容器（数据卷保留）' -ForegroundColor Cyan
    docker compose --env-file .env down
    exit $LASTEXITCODE
}
if ($Logs) {
    docker compose --env-file .env logs -f --tail=100
    exit $LASTEXITCODE
}

# ---------- 1. 准备 .env ----------
if (-not (Test-Path '.env')) {
    Copy-Item '.env.deploy.example' '.env'
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    (Get-Content '.env') -replace '^AUTH_SECRET=\s*$', "AUTH_SECRET=$secret" | Set-Content -Encoding UTF8 '.env'
    Write-Host '[init] 已生成 .env 并写入随机 AUTH_SECRET' -ForegroundColor Yellow
    Write-Host '       请检查 MYSQL_ROOT_PASSWORD / OPERATOR_PASSWORD / INGEST_PROXY' -ForegroundColor Yellow
}

$envMap = Read-EnvFile (Join-Path $root '.env')
$webPort = if ($envMap['WEB_PORT']) { $envMap['WEB_PORT'] } else { '8081' }
$apiPort = if ($envMap['API_PORT']) { $envMap['API_PORT'] } else { '18080' }

# ---------- 2. 构建并启动 ----------
$upArgs = @('compose', '--env-file', '.env', 'up', '-d')
if (-not $SkipBuild) { $upArgs += '--build' }

Write-Host "[build] docker $($upArgs -join ' ')" -ForegroundColor Cyan
& docker @upArgs
if ($LASTEXITCODE -ne 0) { throw 'docker compose up 失败，请查看上面的日志' }

# ---------- 3. 等待健康检查 ----------
$webUrl = "http://127.0.0.1:$webPort"
$apiUrl = "http://127.0.0.1:$apiPort/api/v1/health"
Write-Host '[wait] 等待服务就绪（首次构建 + 导入种子约 1-3 分钟）' -ForegroundColor Cyan

$ready = $false
for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 3
    $web = curl.exe -s -o NUL -w '%{http_code}' "$webUrl/healthz"
    $api = curl.exe -s -o NUL -w '%{http_code}' $apiUrl
    Write-Host ("  [{0,4}s] web={1}  api={2}" -f ($i * 3), $web, $api)
    if ($web -eq '200' -and $api -eq '200') { $ready = $true; break }
}

if (-not $ready) {
    Write-Warning '等待超时。排查：docker compose logs -f backend'
    exit 1
}

# ---------- 4. 输出 ----------
Write-Host ''
Write-Host '部署完成' -ForegroundColor Green
Write-Host "  前端      $webUrl"
Write-Host "  运营后台  $webUrl/admin"
Write-Host "  接口      $apiUrl"
Write-Host "  数据库    127.0.0.1:$($envMap['MYSQL_PORT'])/$($envMap['DB_NAME'])"
Write-Host ''
Write-Host '  默认账号  operator /（.env 里的 OPERATOR_PASSWORD）'
Write-Host '  常用命令  docker compose --env-file .env ps | logs -f backend | down'
