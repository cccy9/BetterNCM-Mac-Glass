param([ValidateSet('x64','x86')][string]$Architecture='x64')
$ErrorActionPreference = 'Stop'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Microsoft C++ build tools not found.' }
$compiler = Get-ChildItem (Join-Path $installation ('VC\Tools\MSVC\*\bin\Hostx64\' + $Architecture + '\cl.exe')) | Sort-Object FullName -Descending | Select-Object -First 1
$toolRoot = Split-Path (Split-Path (Split-Path (Split-Path $compiler.FullName)))
$sdk = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Include' -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkLib = Join-Path 'C:\Program Files (x86)\Windows Kits\10\Lib' $sdk.Name
$dllName = if ($Architecture -eq 'x64') { 'MacGlassNative.dll.x64.dll' } else { 'MacGlassNative.dll' }
$arguments = @('/nologo','/LD','/MT','/std:c++17','/EHsc','/W4','/O2',
    ('/I' + (Join-Path $toolRoot 'include')),
    ('/I' + (Join-Path $sdk.FullName 'ucrt')),('/I' + (Join-Path $sdk.FullName 'shared')),('/I' + (Join-Path $sdk.FullName 'um')),
    (Join-Path $PSScriptRoot 'MacGlassNative.cpp'),
    ('/Fo' + (Join-Path $PSScriptRoot ('MacGlassNative.' + $Architecture + '.obj'))),
    '/link',('/OUT:' + (Join-Path (Split-Path $PSScriptRoot) $dllName)),
    ('/LIBPATH:' + (Join-Path $toolRoot ('lib\' + $Architecture))),('/LIBPATH:' + (Join-Path $sdkLib ('ucrt\' + $Architecture))),('/LIBPATH:' + (Join-Path $sdkLib ('um\' + $Architecture))),
    'user32.lib','dwmapi.lib')
& $compiler.FullName @arguments
if ($LASTEXITCODE -ne 0) { throw 'Native plugin compilation failed.' }
