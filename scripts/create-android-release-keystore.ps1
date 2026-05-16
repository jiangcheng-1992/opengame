param(
  [string]$KeystorePath = "",
  [string]$Alias = "opengame-release",
  [string]$DName = "CN=OpenGame, OU=OpenGame, O=OpenGame, L=Beijing, ST=Beijing, C=CN"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$CacheBase = if ([string]::IsNullOrWhiteSpace($env:TEMP)) { $Root } else { $env:TEMP }
$CacheDir = Join-Path $CacheBase "OpenGameAndroidBuild"
$ToolsDir = Join-Path $CacheDir "tools"
$JdkDir = Join-Path $ToolsDir "jdk-17"

if ([string]::IsNullOrWhiteSpace($KeystorePath)) {
  $KeystorePath = Join-Path $CacheDir "release/opengame-release.jks"
}

function Ensure-Directory([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Resolve-Java {
  $preferred = Join-Path $JdkDir "bin/keytool.exe"
  if (Test-Path $preferred) {
    return $preferred
  }

  $keytool = Get-ChildItem $ToolsDir -Recurse -Filter "keytool.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\bin\keytool.exe" } |
    Select-Object -First 1
  if ($keytool) {
    return $keytool.FullName
  }

  $systemKeytool = Get-Command "keytool.exe" -ErrorAction SilentlyContinue
  if ($systemKeytool) {
    return $systemKeytool.Source
  }

  throw "keytool.exe was not found. Run npm run android:apk once so the portable JDK is downloaded."
}

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").Replace("=", "C")
}

$keytoolExe = Resolve-Java
Ensure-Directory (Split-Path $KeystorePath -Parent)

if (Test-Path $KeystorePath) {
  Write-Host "[android] Reusing existing release keystore."
} else {
  $storePassword = New-Secret
  $keyPassword = New-Secret

  & $keytoolExe `
    -genkeypair `
    -v `
    -keystore $KeystorePath `
    -storetype JKS `
    -alias $Alias `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $storePassword `
    -keypass $keyPassword `
    -dname $DName | Out-Null

  [Environment]::SetEnvironmentVariable("OPENGAME_ANDROID_KEYSTORE_PASSWORD", $storePassword, "User")
  [Environment]::SetEnvironmentVariable("OPENGAME_ANDROID_KEY_PASSWORD", $keyPassword, "User")
}

[Environment]::SetEnvironmentVariable("OPENGAME_ANDROID_KEYSTORE_PATH", $KeystorePath, "User")
[Environment]::SetEnvironmentVariable("OPENGAME_ANDROID_KEY_ALIAS", $Alias, "User")

Write-Host "[android] Release signing environment variables were configured for the current Windows user."
Write-Host "[android] Keystore path: $KeystorePath"
Write-Host "[android] Password values were not printed. Keep this keystore backed up securely."
