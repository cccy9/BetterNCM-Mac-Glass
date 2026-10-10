param([switch]$SkipBuild, [string]$OutputDirectory = 'dist')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not $SkipBuild) {
        & "$projectRoot/assets/mac-glass-theme/native/build.ps1" -Architecture x86
        & "$projectRoot/assets/mac-glass-theme/native/build.ps1" -Architecture x64
        & cargo +nightly build --locked --release --target i686-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
    }
    $binary = Join-Path $projectRoot 'target\i686-pc-windows-msvc\release\betterncm_installer.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw 'Built installer not found.' }
    $version = [regex]::Match((Get-Content -LiteralPath 'Cargo.toml' -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    if ((Get-Item -LiteralPath $binary).VersionInfo.ProductVersion -ne $version) {
        throw 'Installer version does not match Cargo.toml. Rebuild before packaging.'
    }
    $output = Join-Path $projectRoot $OutputDirectory
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $installer = Join-Path $output 'BetterNCM-Mac-Glass-Installer.exe'
    Copy-Item -LiteralPath $binary -Destination $installer -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $output -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $output -Force
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  BetterNCM-Mac-Glass-Installer.exe" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII
    Compress-Archive -LiteralPath $installer,(Join-Path $output 'LICENSE'),(Join-Path $output 'README.md'),(Join-Path $output 'SHA256SUMS.txt') -DestinationPath (Join-Path $output 'BetterNCM-Mac-Glass-Installer.zip') -Force
    Get-ChildItem -LiteralPath $output -File | Select-Object Name,Length
} finally {
    Pop-Location
}
