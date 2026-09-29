param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,
  [ValidateSet('Chrome', 'Edge')]
  [string]$Browser = 'Chrome'
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.xfollow.audit'
$exe = Join-Path $PSScriptRoot 'AuditHost.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $csc)) { throw 'Windows C# compiler not found.' }
  & $csc /nologo /target:exe /r:System.Web.Extensions.dll "/out:$exe" (Join-Path $PSScriptRoot 'AuditHost.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Native host compilation failed.' }
}
$manifest = Join-Path $PSScriptRoot 'com.xfollow.audit.json'
@{
  name = $hostName
  description = 'Local classifier feedback writer for X Follow Audit'
  path = $exe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4 | ForEach-Object { [System.IO.File]::WriteAllText($manifest, $_, (New-Object System.Text.UTF8Encoding($false))) }
$vendorPath = if ($Browser -eq 'Edge') { 'Microsoft\Edge' } else { 'Google\Chrome' }
$registryPath = "HKCU:\Software\$vendorPath\NativeMessagingHosts\$hostName"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifest
Write-Output "Installed $hostName for $Browser extension $ExtensionId"
Write-Output "Host manifest: $manifest"
