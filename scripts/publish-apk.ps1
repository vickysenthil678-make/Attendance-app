param(
  [Parameter(Mandatory = $true)][string]$ApkPath,
  [string]$Version = "1.0.0",
  [int]$VersionCode = 1,
  [string]$Owner = "rishikumar2722",
  [string]$Repository = "attendence-website"
)

$ErrorActionPreference = "Stop"

$resolvedApk = (Resolve-Path $ApkPath).Path
if ([System.IO.Path]::GetExtension($resolvedApk) -ne ".apk") {
  throw "The release file must be an .apk."
}
$token = $env:GITHUB_TOKEN
if (-not $token) {
  throw "Set GITHUB_TOKEN to a fine-grained GitHub token that can write contents/releases for $Owner/$Repository."
}

$tag = "v$Version"
$assetName = "College-Attendance-System-v$Version.apk"
$sizeBytes = (Get-Item $resolvedApk).Length
$sizeMb = [Math]::Round($sizeBytes / 1MB, 2)
$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "attendance-apk-publisher"
}
$apiBase = "https://api.github.com/repos/$Owner/$Repository"

$releaseBody = @{
  tag_name = $tag
  name = "College Attendance System $tag"
  prerelease = $false
  generate_release_notes = $true
} | ConvertTo-Json

$release = $null
try {
  $release = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$tag" -Headers $headers
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
if ($release) {
  $existingAsset = $release.assets | Where-Object { $_.name -eq $assetName }
  if ($existingAsset) {
    throw "Asset '$assetName' already exists on release '$tag'. Use a new version instead of overwriting."
  }
} else {
  $release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -ContentType "application/json" -Body $releaseBody
}

$uploadUrl = $release.upload_url -replace "\{.*$", ""
$uploadUrl = "$uploadUrl?name=$([Uri]::EscapeDataString($assetName))"
$uploadHeaders = $headers.Clone()
$uploadHeaders.Accept = "application/octet-stream"
Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -ContentType "application/vnd.android.package-archive" -InFile $resolvedApk | Out-Null

$downloadUrl = "https://github.com/$Owner/$Repository/releases/download/$tag/$([Uri]::EscapeDataString($assetName))"
$releaseJson = @{
  version = $Version
  versionCode = $VersionCode
  fileName = $assetName
  downloadUrl = $downloadUrl
  sizeMb = $sizeMb
  publishedAt = (Get-Date).ToString("yyyy-MM-dd")
} | ConvertTo-Json -Depth 3

$distributionDir = Join-Path $PSScriptRoot "..\distribution"
Set-Content -Path (Join-Path $distributionDir "release.json") -Value $releaseJson -Encoding UTF8

Write-Host "Published: $downloadUrl"
