<#
.SYNOPSIS
  Generic script: tag a local Docker image and push it to a private/local registry.

.DESCRIPTION
  Wraps the standard flow:
      docker tag  <SourceImage>  <Registry>/<Repository>:<Tag>
      docker push                <Registry>/<Repository>:<Tag>

  Works for any project / any image. Nothing here is MirrorClone-specific.

.PARAMETER SourceImage
  The local image to push, e.g. "my-app:latest" or an image ID.
  If omitted, falls back to "<Repository>:<Tag>" (assumes you already built with that name).

.PARAMETER Build
  If set, run "docker build" before tagging/pushing. The image will be built as
  <SourceImage> (or <Repository>:<Tag> if SourceImage is omitted).

.PARAMETER BuildContext
  Build context path (only used with -Build). Default: current directory.

.PARAMETER Dockerfile
  Path to a Dockerfile (only used with -Build). Default: "<BuildContext>/Dockerfile".

.PARAMETER Registry
  Registry host[:port]. Default: "192.168.0.7:5000" (private LAN registry).
  Override for any other host, e.g. "registry.local:5000".

.PARAMETER Repository
  Repository name inside the registry, e.g. "my-app".

.PARAMETER Tag
  Tag to push. Default: "latest".

.PARAMETER ExtraTags
  Optional extra tags to also tag & push (e.g. @("v1","stable")).

.PARAMETER NoLatest
  By default, when -Tag is not "latest", the image is also tagged & pushed as "latest".
  Pass -NoLatest to skip that.

.PARAMETER Insecure
  Informational flag. Reminds you to configure the daemon's
  "insecure-registries" if the registry is plain HTTP.

.PARAMETER SkipLogin
  Skip "docker login <Registry>". Default behavior also skips login
  unless -Login is provided, since local registries are often unauthenticated.

.PARAMETER Login
  Force "docker login <Registry>" before pushing.

.PARAMETER ConfigFile
  Path to a JSON config file. Default: "docker-push.config.json" next to this script,
  if it exists. Any field there acts as a default; CLI args always override.

  Example contents:
      {
        "Repository": "mirrorclone",
        "Registry":   "192.168.0.7:5000",
        "Tag":        "1.2.4",
        "Build":      true,
        "Insecure":   true,
        "ExtraTags":  ["stable"]
      }

.EXAMPLE
  ./scripts/docker-push-local.ps1 -SourceImage my-app:latest `
      -Registry 192.168.0.7:5000 -Repository my-app -Tag v1

.EXAMPLE
  ./scripts/docker-push-local.ps1 -Registry registry.local:5000 `
      -Repository mirrorclone -Tag 1.0.0 -ExtraTags latest
#>

[CmdletBinding()]
param(
    [string]$SourceImage,

    # Default points to my private LAN registry; override per call if needed.
    [string]$Registry,

    [string]$Repository,

    [string]$Tag,

    [string[]]$ExtraTags,

    [Nullable[bool]]$NoLatest,

    [Nullable[bool]]$Build,
    [string]$BuildContext,
    [string]$Dockerfile,

    [Nullable[bool]]$Insecure,
    [Nullable[bool]]$SkipLogin,
    [Nullable[bool]]$Login,

    [string]$ConfigFile
)

$ErrorActionPreference = "Stop"

# --- Load config file (JSON) ----------------------------------------------
# CLI args always win. Any value not provided on CLI falls back to config,
# and finally to hardcoded defaults below.
$ConfigData = $null
if ([string]::IsNullOrWhiteSpace($ConfigFile)) {
    $DefaultConfig = Join-Path $PSScriptRoot "docker-push.config.json"
    if (Test-Path $DefaultConfig) { $ConfigFile = $DefaultConfig }
}
if ($ConfigFile) {
    if (-not (Test-Path $ConfigFile)) {
        Write-Error "Config file not found: $ConfigFile"
        exit 1
    }
    try {
        $ConfigData = Get-Content -Raw -Path $ConfigFile | ConvertFrom-Json
    } catch {
        Write-Error "Failed to parse JSON in '$ConfigFile': $_"
        exit 1
    }
    Write-Host "Loaded config: $ConfigFile" -ForegroundColor DarkGray
}

function Resolve-Param {
    param($CliValue, $ConfigKey, $Default)
    # PSBoundParameters is the source of truth for "was this passed on CLI?"
    if ($PSCmdlet -and $PSCmdlet.MyInvocation.BoundParameters.ContainsKey($ConfigKey)) {
        return $CliValue
    }
    if ($ConfigData -and ($ConfigData.PSObject.Properties.Name -contains $ConfigKey)) {
        return $ConfigData.$ConfigKey
    }
    return $Default
}

$Registry     = Resolve-Param $Registry     "Registry"     "192.168.0.7:5000"
$Repository   = Resolve-Param $Repository   "Repository"   $null
$Tag          = Resolve-Param $Tag          "Tag"          "latest"
$SourceImage  = Resolve-Param $SourceImage  "SourceImage"  $null
$ExtraTags    = Resolve-Param $ExtraTags    "ExtraTags"    @()
$NoLatest     = [bool](Resolve-Param $NoLatest     "NoLatest"     $false)
$Build        = [bool](Resolve-Param $Build        "Build"        $false)
$BuildContext = Resolve-Param $BuildContext "BuildContext" (Get-Location).Path
$Dockerfile   = Resolve-Param $Dockerfile   "Dockerfile"   $null
$Insecure     = [bool](Resolve-Param $Insecure     "Insecure"     $false)
$SkipLogin    = [bool](Resolve-Param $SkipLogin    "SkipLogin"    $false)
$Login        = [bool](Resolve-Param $Login        "Login"        $false)

if ([string]::IsNullOrWhiteSpace($Repository)) {
    Write-Error "Repository is required (pass -Repository or set it in the config file)."
    exit 1
}

# Validate docker is available
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Error "docker CLI not found in PATH."
    exit 1
}

# Default source image to <Repository>:<Tag> if not supplied
if ([string]::IsNullOrWhiteSpace($SourceImage)) {
    $SourceImage = "${Repository}:${Tag}"
}

# If not building, verify the source image actually exists locally
if (-not $Build) {
    $null = docker image inspect $SourceImage 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Source image '$SourceImage' not found locally. Build it first (docker build ...) or pass -Build."
        exit 1
    }
}

# All tags to publish (auto-include "latest" unless -NoLatest or Tag already == latest)
$AllTags = @($Tag) + $ExtraTags
if (-not $NoLatest -and $Tag -ne "latest") {
    $AllTags += "latest"
}
$AllTags = $AllTags | Select-Object -Unique

Write-Host ""
Write-Host "=== Docker push to local registry ===" -ForegroundColor Cyan
Write-Host "Source image : $SourceImage"
Write-Host "Registry     : $Registry"
Write-Host "Repository   : $Repository"
Write-Host "Tags         : $($AllTags -join ', ')"
if ($Build) {
    Write-Host "Build        : yes (context=$BuildContext)"
}
if ($Insecure) {
    Write-Host "NOTE: -Insecure set. Make sure '$Registry' is listed under" -ForegroundColor Yellow
    Write-Host "      'insecure-registries' in your Docker daemon config if using HTTP." -ForegroundColor Yellow
}
Write-Host ""

# Optional login
if ($Login -and -not $SkipLogin) {
    Write-Host "--> docker login $Registry" -ForegroundColor Yellow
    docker login $Registry
    if ($LASTEXITCODE -ne 0) { throw "docker login failed for $Registry." }
}

# Optional build
if ($Build) {
    if (-not (Test-Path $BuildContext)) {
        throw "Build context not found: $BuildContext"
    }
    if ([string]::IsNullOrWhiteSpace($Dockerfile)) {
        $Dockerfile = Join-Path $BuildContext "Dockerfile"
    }
    if (-not (Test-Path $Dockerfile)) {
        throw "Dockerfile not found: $Dockerfile"
    }

    Write-Host "--> docker build -t $SourceImage -f $Dockerfile $BuildContext" -ForegroundColor Yellow
    docker build -t $SourceImage -f $Dockerfile $BuildContext
    if ($LASTEXITCODE -ne 0) { throw "docker build failed." }
    Write-Host ""
}

# Tag + push each
foreach ($t in $AllTags) {
    $TargetRef = "$Registry/${Repository}:${t}"

    Write-Host "--> docker tag $SourceImage $TargetRef" -ForegroundColor Yellow
    docker tag $SourceImage $TargetRef
    if ($LASTEXITCODE -ne 0) { throw "docker tag failed for $TargetRef." }

    Write-Host "--> docker push $TargetRef" -ForegroundColor Yellow
    docker push $TargetRef
    if ($LASTEXITCODE -ne 0) { throw "docker push failed for $TargetRef." }

    Write-Host ""
}

Write-Host "Done. Pushed:" -ForegroundColor Green
foreach ($t in $AllTags) {
    Write-Host "  - $Registry/${Repository}:${t}"
}
