<#
.SYNOPSIS
  Build and push the MirrorClone image to Docker Hub.

.PARAMETER User
  Docker Hub username. Defaults to env var DOCKERHUB_USER.

.PARAMETER Image
  Image/repository name. Defaults to "mirrorclone".

.PARAMETER Tag
  Version tag to push (in addition to "latest"). Defaults to "latest" only.
  Example: 1.0.0

.PARAMETER NoLatest
  If set, do NOT also tag/push "latest".

.PARAMETER SkipLogin
  Skip the `docker login` step (use if already logged in).

.EXAMPLE
  ./scripts/docker-push.ps1 -User nati -Tag 1.0.0

.EXAMPLE
  $env:DOCKERHUB_USER = "nati"
  ./scripts/docker-push.ps1 -Tag 1.0.1
#>

[CmdletBinding()]
param(
    [string]$User = $env:DOCKERHUB_USER,
    [string]$Image = "mirrorclone",
    [string]$Tag = "latest",
    [switch]$NoLatest,
    [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($User)) {
    Write-Error "Docker Hub username missing. Pass -User <name> or set `$env:DOCKERHUB_USER."
    exit 1
}

# Resolve repo root (this script lives in <root>/scripts)
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $RepoRoot "Dockerfile"))) {
    Write-Error "Dockerfile not found at $RepoRoot. Aborting."
    exit 1
}

$Repo = "$User/$Image"
$Tags = @($Tag)
if (-not $NoLatest -and $Tag -ne "latest") {
    $Tags += "latest"
}

Write-Host ""
Write-Host "=== MirrorClone Docker push ===" -ForegroundColor Cyan
Write-Host "Repository : $Repo"
Write-Host "Tags       : $($Tags -join ', ')"
Write-Host "Context    : $RepoRoot"
Write-Host ""

# 1. Login
if (-not $SkipLogin) {
    Write-Host "--> docker login" -ForegroundColor Yellow
    docker login
    if ($LASTEXITCODE -ne 0) { throw "docker login failed." }
}

# 2. Build with all tags in one pass
$BuildArgs = @("build")
foreach ($t in $Tags) {
    $BuildArgs += @("-t", "${Repo}:${t}")
}
$BuildArgs += $RepoRoot

Write-Host ""
Write-Host "--> docker $($BuildArgs -join ' ')" -ForegroundColor Yellow
docker @BuildArgs
if ($LASTEXITCODE -ne 0) { throw "docker build failed." }

# 3. Push each tag
foreach ($t in $Tags) {
    $FullRef = "${Repo}:${t}"
    Write-Host ""
    Write-Host "--> docker push $FullRef" -ForegroundColor Yellow
    docker push $FullRef
    if ($LASTEXITCODE -ne 0) { throw "docker push failed for $FullRef." }
}

Write-Host ""
Write-Host "Done. Pushed:" -ForegroundColor Green
foreach ($t in $Tags) {
    Write-Host "  - ${Repo}:${t}"
}
