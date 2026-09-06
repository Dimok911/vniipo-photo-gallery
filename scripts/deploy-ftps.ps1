[CmdletBinding()]
param(
  [string]$ExpectedVersion = "",
  [string]$ArtifactRoot = "",
  [string]$ConfigPath = "",
  [switch]$StageOnly,
  [string]$ActivateRecord = "",
  [string]$PublicUrl = "https://vniipo-help.ru/shared-ui/photo-gallery/"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path.TrimEnd("\")
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
  $ArtifactRoot = Join-Path $projectRoot "dist"
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $projectRoot ".vscode\sftp.json"
}
$ArtifactRoot = (Resolve-Path $ArtifactRoot).Path.TrimEnd("\")
$ConfigPath = (Resolve-Path $ConfigPath).Path
$curlPath = "C:\Windows\System32\curl.exe"
$productionRemotePath = "www/vniipo-help.ru/shared-ui/photo-gallery"
$productionParentPath = "www/vniipo-help.ru/shared-ui"
$ftpCanonicalHost = "vniipo-help.ru"
$ftpFallbackIp = "88.212.206.188"
$ftpPort = 21
$ftpPinnedPublicKey = "sha256//+gOwS0YQ8/CGtOD9zgyFzgYGLtl38K9YhxYssMpjz+Y="
if (-not (Test-Path -LiteralPath $curlPath -PathType Leaf)) {
  throw "Required curl.exe was not found at the project-approved path."
}

function Escape-CurlConfigValue([string]$value) {
  return $value.Replace("\", "\\").Replace('"', '\"').Replace("`r", "\r").Replace("`n", "\n")
}

function Curl-Line([string]$name, [string]$value) {
  return ('{0} = "{1}"' -f $name, (Escape-CurlConfigValue $value))
}

function Invoke-CurlConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Lines,
    [switch]$Ftps,
    [ValidateRange(1, 10)]
    [int]$Attempts = 1
  )
  $effectiveLines = @($Lines)
  if ($Ftps) {
    $effectiveLines = @(
      "ssl-reqd"
      "insecure"
      "ftp-pasv"
      (Curl-Line "pinnedpubkey" $ftpPinnedPublicKey)
      (Curl-Line "resolve" "${ftpCanonicalHost}:${ftpPort}:${ftpFallbackIp}")
    ) + $effectiveLines
  }
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    (($effectiveLines -join "`n") + "`n") | & $curlPath --config -
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { return 0 }
    if ($attempt -lt $Attempts) {
      Write-Warning "Transfer attempt $attempt of $Attempts failed; retrying."
      Start-Sleep -Seconds 2
    }
  }
  return $exitCode
}

$settings = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($name in @("host", "username", "password", "remotePath")) {
  if ([string]::IsNullOrWhiteSpace([string]$settings.$name)) {
    throw "Missing required FTP setting: $name"
  }
}
if ([string]$settings.protocol -ne "ftp") {
  throw "Production deployment requires protocol=ftp in .vscode/sftp.json."
}
if (([string]$settings.remotePath).Trim() -ne "/") {
  throw "The FTP account root configuration has changed; remotePath must remain '/'."
}
if ([int]$settings.port -ne $ftpPort) {
  throw "Production FTPS requires port 21."
}
if ([string]$settings.host -notin @($ftpCanonicalHost, $ftpFallbackIp)) {
  throw "Production FTPS host must remain vniipo-help.ru or its approved fallback IP."
}

$ftpAccountRootUrl = "ftp://${ftpCanonicalHost}:${ftpPort}/"
$credential = ([string]$settings.username) + ":" + ([string]$settings.password)

function Encode-RemotePath([string]$relativePath) {
  return (($relativePath.Replace("\", "/").TrimStart("/").Split("/") | ForEach-Object {
    [Uri]::EscapeDataString($_)
  }) -join "/")
}

function Get-FtpUrl([string]$accountRelativePath) {
  return $ftpAccountRootUrl + (Encode-RemotePath $accountRelativePath)
}

function Send-FtpFile([string]$localPath, [string]$accountRelativePath) {
  $exitCode = Invoke-CurlConfig -Ftps -Attempts 5 -Lines @(
    "silent"
    "show-error"
    "fail"
    "ftp-create-dirs"
    (Curl-Line "user" $credential)
    (Curl-Line "url" (Get-FtpUrl $accountRelativePath))
    (Curl-Line "upload-file" $localPath)
  )
  if ($exitCode -ne 0) { throw "FTP upload failed for: $accountRelativePath" }
}

function Receive-FtpFile([string]$accountRelativePath, [string]$localPath) {
  $parent = Split-Path -Path $localPath -Parent
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -Path $parent -ItemType Directory -Force | Out-Null
  }
  $exitCode = Invoke-CurlConfig -Ftps -Attempts 5 -Lines @(
    "silent"
    "show-error"
    "fail"
    (Curl-Line "user" $credential)
    (Curl-Line "url" (Get-FtpUrl $accountRelativePath))
    (Curl-Line "output" $localPath)
  )
  if ($exitCode -ne 0) { throw "FTP download failed for: $accountRelativePath" }
}

function Move-FtpDirectory([string]$fromPath, [string]$toPath) {
  $exitCode = Invoke-CurlConfig -Ftps -Lines @(
    "silent"
    "show-error"
    "fail"
    (Curl-Line "user" $credential)
    (Curl-Line "url" $ftpAccountRootUrl)
    (Curl-Line "output" "NUL")
    (Curl-Line "quote" "RNFR $fromPath")
    (Curl-Line "quote" "RNTO $toPath")
  )
  if ($exitCode -ne 0) { throw "FTP directory rename failed." }
}

function Assert-FilesEqual([string]$expectedPath, [string]$actualPath, [string]$label) {
  $expectedHash = (Get-FileHash -LiteralPath $expectedPath -Algorithm SHA256).Hash
  $actualHash = (Get-FileHash -LiteralPath $actualPath -Algorithm SHA256).Hash
  if ($expectedHash -ne $actualHash) { throw "SHA-256 mismatch for: $label" }
}

function Get-RelativeArtifactPath([System.IO.FileInfo]$file) {
  return $file.FullName.Substring($ArtifactRoot.Length + 1).Replace("\", "/")
}

function Receive-HttpsFile([string]$url, [string]$localPath, [int]$attempts = 5) {
  $parent = Split-Path -Path $localPath -Parent
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -Path $parent -ItemType Directory -Force | Out-Null
  }
  for ($attempt = 1; $attempt -le $attempts; $attempt += 1) {
    $exitCode = Invoke-CurlConfig -Lines @(
      "silent"
      "show-error"
      "fail"
      (Curl-Line "header" "Cache-Control: no-cache")
      (Curl-Line "url" $url)
      (Curl-Line "output" $localPath)
    )
    if ($exitCode -eq 0) { return }
    if ($attempt -lt $attempts) { Start-Sleep -Seconds 2 }
  }
  throw "HTTPS verification failed after $attempts attempts."
}

# Transport functions above follow the established Bike Packing explicit FTPS
# script. The shared runtime swaps the whole directory, retaining all immutable
# versions and the complete previous directory for rollback.
$manifest = Get-Content -LiteralPath (Join-Path $ArtifactRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($ExpectedVersion -and $ExpectedVersion -ne $manifest.version) { throw 'Artifact version mismatch.' }
$ExpectedVersion = [string]$manifest.version
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
if ((Get-FileHash -LiteralPath (Join-Path $ArtifactRoot 'photo-gallery.js') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Artifact hash mismatch.' }
if ($PublicUrl -ne 'https://vniipo-help.ru/shared-ui/photo-gallery/') { throw 'Unexpected public destination.' }

$releaseRoot = Join-Path $projectRoot '.release'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$localRoot = Join-Path $releaseRoot $stamp
$stageLeaf = "photo-gallery-stage-v$ExpectedVersion-$stamp"
$stagePath = "$productionParentPath/$stageLeaf"
$backupPath = "$productionParentPath/photo-gallery-backup-before-v$ExpectedVersion-$stamp"
$failedPath = "$productionParentPath/photo-gallery-failed-v$ExpectedVersion-$stamp"

function Get-RemoteTree([string]$remote, [string]$local, [int]$depth = 0) {
  if ($depth -gt 4) { throw 'Unexpected remote directory depth.' }
  New-Item -ItemType Directory -Path $local -Force | Out-Null
  $listing = Join-Path $releaseRoot "listing-$PID-$depth.txt"
  $code = Invoke-CurlConfig -Ftps -Lines @(
    'silent'; 'show-error'; 'fail'
    (Curl-Line 'user' $credential)
    (Curl-Line 'url' ((Get-FtpUrl $remote).TrimEnd('/') + '/'))
    (Curl-Line 'output' $listing)
  )
  if ($code -ne 0) { throw 'Cannot inventory current production.' }
  $entries = @(Get-Content -LiteralPath $listing)
  foreach ($entry in $entries) {
    if ($entry -match '^total\s+\d+$' -or [string]::IsNullOrWhiteSpace($entry)) { continue }
    if ($entry -notmatch '^([d-])[rwxstST-]{9}\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+[\d:]+\s+(.+)$') { throw 'Unsupported remote directory entry; no production changes made.' }
    $kind = $Matches[1]; $name = $Matches[2]
    if ($name -in @('.', '..')) { continue }
    if ($name -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unsafe remote entry name.' }
    if ($kind -eq 'd') { Get-RemoteTree "$remote/$name" (Join-Path $local $name) ($depth + 1) }
    else { Receive-FtpFile "$remote/$name" (Join-Path $local $name) }
  }
}

function Verify-Public([string]$base, [string]$local, [string[]]$files, [string]$tag) {
  foreach ($file in $files) {
    $download = Join-Path $releaseRoot "verify-$tag-$($file.Replace('/','-'))"
    Receive-HttpsFile "$($base.TrimEnd('/'))/${file}?release=$stamp" $download
    Assert-FilesEqual (Join-Path $local $file) $download "HTTPS/$file"
  }
}

if ($ActivateRecord) {
  $recordPath = (Resolve-Path -LiteralPath $ActivateRecord).Path
  if (-not $recordPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Activation record must be in this repository release directory.' }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  if ($record.version -ne $ExpectedVersion -or $record.sha256 -ne $manifest.sha256) { throw 'Staged artifact does not match this release.' }
  foreach ($path in @($record.stagePath, $record.backupPath, $record.failedPath)) {
    if ($path -notmatch '^www/vniipo-help.ru/shared-ui/photo-gallery-(stage|backup-before|failed)-v\d+\.\d+\.\d+-\d{8}T\d{6}Z$') { throw 'Invalid activation path.' }
  }
  $localRoot = [string]$record.localRoot
  if (-not $localRoot.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid local release directory.' }
  $stagePath = [string]$record.stagePath; $backupPath = [string]$record.backupPath; $failedPath = [string]$record.failedPath
  $stageLeaf = ($stagePath -split '/')[-1]
} else {
  $oldRoot = Join-Path $localRoot 'previous'
  Get-RemoteTree $productionRemotePath $oldRoot
  if (-not (Test-Path -LiteralPath (Join-Path $oldRoot 'stable.js'))) { throw 'Current stable artifact missing.' }
  $stageRoot = Join-Path $localRoot 'stage'
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $oldRoot '*') -Destination $stageRoot -Recurse
  $immutable = Join-Path $stageRoot "v$ExpectedVersion"
  if (Test-Path -LiteralPath $immutable) { throw 'Immutable version already exists; refusing overwrite.' }
  New-Item -ItemType Directory -Path $immutable | Out-Null
  Copy-Item -LiteralPath (Join-Path $ArtifactRoot 'photo-gallery.js') -Destination (Join-Path $immutable 'photo-gallery.js')
  Copy-Item -LiteralPath (Join-Path $ArtifactRoot 'photo-gallery.js') -Destination (Join-Path $stageRoot 'stable.js')
  Copy-Item -LiteralPath (Join-Path $ArtifactRoot 'manifest.json') -Destination (Join-Path $stageRoot 'manifest.json')
  foreach ($file in Get-ChildItem -LiteralPath $stageRoot -Recurse -File) {
    $relative = $file.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
    Send-FtpFile $file.FullName "$stagePath/$relative"
  }
  $recordPath = Join-Path $localRoot 'release.json'
  @{ version = $ExpectedVersion; sha256 = $manifest.sha256; stagePath = $stagePath; backupPath = $backupPath; failedPath = $failedPath; localRoot = $localRoot } | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
}

$stageRoot = Join-Path $localRoot 'stage'
$oldRoot = Join-Path $localRoot 'previous'
# Verify every retained immutable asset too, not only the new stable alias.
foreach ($file in Get-ChildItem -LiteralPath $stageRoot -Recurse -File) {
  $relative = $file.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
  $download = Join-Path $localRoot "verified/$relative"
  Receive-FtpFile "$stagePath/$relative" $download
  Assert-FilesEqual $file.FullName $download "FTPS/$relative"
}
$required = @('stable.js', 'manifest.json', "v$ExpectedVersion/photo-gallery.js")
Verify-Public "https://vniipo-help.ru/shared-ui/$stageLeaf/" $stageRoot $required 'stage'
if ($StageOnly) {
  Write-Output "Staging verified. Browser-check URL: https://vniipo-help.ru/shared-ui/$stageLeaf/stable.js"
  Write-Output "Activation record: $recordPath"
  exit 0
}
if (-not $ActivateRecord) { throw 'Use -StageOnly first; browser-check staging before -ActivateRecord.' }

# A concurrent release must not be silently overwritten.
foreach ($file in @('stable.js', 'manifest.json')) {
  $download = Join-Path $localRoot "pre-activation-$file"
  Receive-FtpFile "$productionRemotePath/$file" $download
  Assert-FilesEqual (Join-Path $oldRoot $file) $download "Current production/$file"
}
$backedUp = $false; $activated = $false
try {
  Move-FtpDirectory $productionRemotePath $backupPath
  $backedUp = $true
  Move-FtpDirectory $stagePath $productionRemotePath
  $activated = $true
  Verify-Public $PublicUrl $stageRoot $required 'production'
} catch {
  $failure = $_
  if ($activated) { Move-FtpDirectory $productionRemotePath $failedPath }
  if ($backedUp) {
    Move-FtpDirectory $backupPath $productionRemotePath
    Verify-Public $PublicUrl $oldRoot @('stable.js', 'manifest.json') 'rollback'
  }
  throw $failure
}
Write-Output "Published $ExpectedVersion sha256=$($manifest.sha256)"
Write-Output "Rollback directory: /$backupPath"
Write-Output "Release record: $recordPath"

