param(
  [string]$AppUrl = $env:OPENGAME_APP_URL,
  [string]$ApkOutput = "public/downloads/opengame.apk",
  [ValidateSet("debug", "release")]
  [string]$BuildType = "release"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$CacheBase = if ([string]::IsNullOrWhiteSpace($env:TEMP)) { $Root } else { $env:TEMP }
$CacheDir = Join-Path $CacheBase "OpenGameAndroidBuild"
$DownloadDir = Join-Path $CacheDir "downloads"
$ToolsDir = Join-Path $CacheDir "tools"
$AndroidHome = Join-Path $CacheDir "android-sdk"
$JdkDir = Join-Path $ToolsDir "jdk-17"
$GradleDir = Join-Path $ToolsDir "gradle-8.7"
$AndroidProject = Join-Path $Root "android-shell"
$OutputPath = Join-Path $Root $ApkOutput

if ([string]::IsNullOrWhiteSpace($AppUrl)) {
  $AppUrl = "https://opengame.zz-fancy.cloud"
}

function Get-EnvValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    return $value
  }
  return [Environment]::GetEnvironmentVariable($Name, "User")
}

function Ensure-Directory([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Download-File([string]$Url, [string]$Path) {
  if (Test-Path $Path) {
    Write-Host "[android] Reusing $(Split-Path $Path -Leaf)"
    return
  }
  Write-Host "[android] Downloading $Url"
  $partial = "$Path.part"
  if (Test-Path $partial) {
    Remove-Item -Force $partial
  }

  $curl = Get-Command "curl.exe" -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source -L --fail --retry 5 --retry-delay 3 --connect-timeout 30 --output $partial $Url
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to download $Url"
    }
    Move-Item -Force $partial $Path
    return
  }

  Invoke-WebRequest -Uri $Url -OutFile $partial
  Move-Item -Force $partial $Path
}

function Expand-Fresh([string]$ZipPath, [string]$Destination) {
  if (Test-Path $Destination) {
    Remove-Item -Recurse -Force $Destination
  }
  Ensure-Directory $Destination
  Expand-Archive -Path $ZipPath -DestinationPath $Destination -Force
}

function Ensure-Jdk {
  $javaExe = Join-Path $JdkDir "bin/java.exe"
  if (Test-Path $javaExe) {
    return
  }

  $zip = Join-Path $DownloadDir "temurin-jdk-17.zip"
  Download-File "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" $zip
  $tmp = Join-Path $ToolsDir "jdk-extract"
  Expand-Fresh $zip $tmp
  $java = Get-ChildItem $tmp -Recurse -Filter "java.exe" | Where-Object { $_.FullName -like "*\bin\java.exe" } | Select-Object -First 1
  if (-not $java) {
    throw "JDK archive did not contain bin/java.exe."
  }
  $inner = Split-Path (Split-Path $java.FullName -Parent) -Parent
  if (Test-Path $JdkDir) {
    Remove-Item -Recurse -Force $JdkDir
  }
  Move-Item $inner $JdkDir
  Remove-Item -Recurse -Force $tmp
}

function Resolve-JdkHome {
  $preferredJava = Join-Path $JdkDir "bin/java.exe"
  if (Test-Path $preferredJava) {
    return $JdkDir
  }

  $java = Get-ChildItem $ToolsDir -Recurse -Filter "java.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\bin\java.exe" } |
    Select-Object -First 1
  if (-not $java) {
    throw "JDK installation is missing bin/java.exe."
  }

  return Split-Path (Split-Path $java.FullName -Parent) -Parent
}

function Ensure-Gradle {
  $gradleBat = Join-Path $GradleDir "bin/gradle.bat"
  if (Test-Path $gradleBat) {
    return
  }

  $zip = Join-Path $DownloadDir "gradle-8.7-bin.zip"
  Download-File "https://services.gradle.org/distributions/gradle-8.7-bin.zip" $zip
  Expand-Fresh $zip $ToolsDir
}

function Ensure-AndroidSdk {
  $sdkManager = Join-Path $AndroidHome "cmdline-tools/latest/bin/sdkmanager.bat"
  if (-not (Test-Path $sdkManager)) {
    $zip = Join-Path $DownloadDir "android-commandlinetools-win.zip"
    Download-File "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" $zip

    $tmp = Join-Path $CacheDir "cmdline-tools-extract"
    Expand-Fresh $zip $tmp
    $latest = Join-Path $AndroidHome "cmdline-tools/latest"
    if (Test-Path $latest) {
      Remove-Item -Recurse -Force $latest
    }
    Ensure-Directory (Split-Path $latest -Parent)
    Move-Item (Join-Path $tmp "cmdline-tools") $latest
    Remove-Item -Recurse -Force $tmp
  }

  $licensesDir = Join-Path $AndroidHome "licenses"
  Ensure-Directory $licensesDir
  Set-Content -Encoding ASCII -Path (Join-Path $licensesDir "android-sdk-license") -Value @(
    "8933bad161af4178b1185d1a37fbf41ea5269c55",
    "d56f5187479451eabf01fb78af6dfcb131a6481e",
    "24333f8a63b6825ea9c5514f83c2829b004d1fee"
  )
  Set-Content -Encoding ASCII -Path (Join-Path $licensesDir "android-sdk-preview-license") -Value "84831b9409646a918e30573bab4c9c91346d8abd"

  & $sdkManager --sdk_root=$AndroidHome "platform-tools" "platforms;android-35" "build-tools;35.0.0"
}

Ensure-Directory $CacheDir
Ensure-Directory $DownloadDir
Ensure-Directory $ToolsDir
Ensure-Directory (Split-Path $OutputPath -Parent)

Ensure-Jdk
$ResolvedJdkDir = Resolve-JdkHome
$env:JAVA_HOME = $ResolvedJdkDir
$env:Path = "$(Join-Path $ResolvedJdkDir "bin");$env:Path"
Ensure-Gradle
Ensure-AndroidSdk

$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:Path = "$(Join-Path $ResolvedJdkDir "bin");$(Join-Path $GradleDir "bin");$(Join-Path $AndroidHome "platform-tools");$env:Path"

if (
  [string]::IsNullOrWhiteSpace((Get-EnvValue "OPENGAME_ANDROID_KEYSTORE_PATH")) -and
  -not [string]::IsNullOrWhiteSpace((Get-EnvValue "OPENGAME_ANDROID_KEYSTORE_BASE64"))
) {
  $releaseKeystorePath = Join-Path $CacheDir "release/opengame-release.jks"
  Ensure-Directory (Split-Path $releaseKeystorePath -Parent)
  [IO.File]::WriteAllBytes($releaseKeystorePath, [Convert]::FromBase64String((Get-EnvValue "OPENGAME_ANDROID_KEYSTORE_BASE64")))
  Set-Item -Path "Env:OPENGAME_ANDROID_KEYSTORE_PATH" -Value $releaseKeystorePath
}

$releaseEnvNames = @(
  "OPENGAME_ANDROID_KEYSTORE_PATH",
  "OPENGAME_ANDROID_KEYSTORE_PASSWORD",
  "OPENGAME_ANDROID_KEY_ALIAS",
  "OPENGAME_ANDROID_KEY_PASSWORD"
)
foreach ($name in $releaseEnvNames) {
  $value = Get-EnvValue $name
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    Set-Item -Path "Env:$name" -Value $value
  }
}

if ($BuildType -eq "release") {
  foreach ($name in $releaseEnvNames) {
    if ([string]::IsNullOrWhiteSpace((Get-EnvValue $name))) {
      throw "Release signing is missing $name. Run npm run android:keystore first, then open a new terminal or rerun this command."
    }
  }
}

$sdkDirForGradle = $AndroidHome.Replace("\", "/")
Set-Content -Encoding ASCII -Path (Join-Path $AndroidProject "local.properties") -Value "sdk.dir=$sdkDirForGradle"

Write-Host "[android] Building OpenGame shell $BuildType APK for $AppUrl"
$gradleTask = if ($BuildType -eq "release") { ":app:assembleRelease" } else { ":app:assembleDebug" }
& (Join-Path $GradleDir "bin/gradle.bat") -p $AndroidProject --no-daemon $gradleTask "-POPENGAME_APP_URL=$AppUrl"

$builtApk = if ($BuildType -eq "release") {
  Join-Path $AndroidProject "app/build/outputs/apk/release/app-release.apk"
} else {
  Join-Path $AndroidProject "app/build/outputs/apk/debug/app-debug.apk"
}
if (-not (Test-Path $builtApk)) {
  throw "APK was not produced at $builtApk"
}

Copy-Item -Force $builtApk $OutputPath
Write-Host "[android] APK ready: $OutputPath"
