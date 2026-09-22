# Removes the Vector Iris panel. The saved API key (%APPDATA%\IrisCocreative\VectorIris) is left in place.
#   uninstall.ps1               remove the plugin
#   uninstall.ps1 -ResetDebug   also turn Adobe's PlayerDebugMode back off
#                               (skip this if you use other unsigned panels)

param([switch]$ResetDebug)

$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.iriscocreative.vectoriris'

if (Test-Path $dest) {
    $item = Get-Item $dest -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($dest) }
    else { Remove-Item $dest -Recurse -Force }
    Write-Host "Removed $dest"
} else {
    Write-Host 'Vector Iris is not installed.'
}

if ($ResetDebug) {
    foreach ($v in 9..13) {
        $key = "HKCU:\Software\Adobe\CSXS.$v"
        if (Test-Path $key) { Remove-ItemProperty -Path $key -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue }
    }
    Write-Host 'PlayerDebugMode reset.'
}
Write-Host 'Restart Illustrator to finish.'
