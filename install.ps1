# Installs Vector Iris for Illustrator (current Windows user only).
#
#   install.ps1          copy the plugin into Adobe's extensions folder
#   install.ps1 -Link    link it instead, so edits here show up after reopening the panel
#
# Unsigned panels only load when Adobe's "PlayerDebugMode" is on, so this also
# sets that flag for the CEP versions Illustrator 2021 and later use.
# Your Quiver API key is entered in the panel itself, not here.

param([switch]$Link)

$ErrorActionPreference = 'Stop'
$id   = 'com.iriscocreative.vectoriris'
$src  = $PSScriptRoot
$root = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $root $id

New-Item -ItemType Directory -Force -Path $root | Out-Null

# Remove an earlier install. A link is deleted as a link only, never its target.
if (Test-Path $dest) {
    $item = Get-Item $dest -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($dest) }
    else { Remove-Item $dest -Recurse -Force }
}

if ($Link) {
    New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
    Write-Host "Linked  $dest  ->  $src"
} else {
    New-Item -ItemType Directory -Path $dest | Out-Null
    foreach ($part in 'CSXS', 'css', 'js', 'jsx', 'index.html', 'LICENSE', 'NOTICE') {
        $from = Join-Path $src $part
        if (Test-Path $from) { Copy-Item $from -Destination $dest -Recurse -Force }
    }
    Write-Host "Copied to  $dest"
}

foreach ($v in 9..13) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Write-Host 'Enabled unsigned panels (PlayerDebugMode = 1 for CSXS 9-13).'
Write-Host ''
Write-Host 'Done. Restart Illustrator, then open Window > Extensions > Vector Iris.'
