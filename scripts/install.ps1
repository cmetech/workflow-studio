[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repository = 'cmetech/workflow-studio'
$ApiUrl = "https://api.github.com/repos/$Repository/releases/latest"
$ReleaseRoot = "https://github.com/$Repository/releases/download"

function Write-Status([string] $Message) {
  Write-Host "Workflow Studio: $Message"
}

function Get-WindowsArchitecture {
  try {
    $Processor = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
      Select-Object -First 1
    if ($null -ne $Processor -and $null -ne $Processor.Architecture) {
      switch ([int] $Processor.Architecture) {
        9 { return 'X64' }
        12 { return 'Arm64' }
        0 { return 'X86' }
        5 { return 'Arm' }
      }
    }
  }
  catch {
    # Locked-down hosts may not allow CIM. Fall back to native Windows
    # architecture variables, preferring the WoW64 real-OS value.
  }

  $EnvironmentArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
  }
  else {
    $env:PROCESSOR_ARCHITECTURE
  }
  switch ([string] $EnvironmentArchitecture) {
    'AMD64' { return 'X64' }
    'ARM64' { return 'Arm64' }
    'x86' { return 'X86' }
    default { return [string] $EnvironmentArchitecture }
  }
}

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
  )) {
  throw 'Unsupported operating system: this installer requires Windows'
}

$RuntimeArchitecture = Get-WindowsArchitecture
switch ($RuntimeArchitecture) {
  'X64' { $AssetSuffix = 'windows_x86_64-setup.exe' }
  default { throw "Unsupported architecture: $RuntimeArchitecture on Windows" }
}

Write-Status 'checking the latest public release'
$Headers = @{
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$Tag = [string] $Release.tag_name
if ($Tag -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$') {
  throw 'Latest release returned an invalid tag'
}
$Version = $Tag.Substring(1)
$InstallerName = "LOOP24-Workflow-Studio_${Version}_${AssetSuffix}"

$TempDirectory = [IO.Path]::Combine(
  [IO.Path]::GetTempPath(),
  "loop24-workflow-studio-$([Guid]::NewGuid().ToString('N'))"
)
[IO.Directory]::CreateDirectory($TempDirectory) | Out-Null
$InstallerPath = [IO.Path]::Combine($TempDirectory, $InstallerName)
$ChecksumPath = [IO.Path]::Combine($TempDirectory, 'SHA256SUMS')

try {
  Write-Status "downloading $InstallerName"
  Invoke-WebRequest -Uri "$ReleaseRoot/$Tag/$InstallerName" -OutFile $InstallerPath
  Invoke-WebRequest -Uri "$ReleaseRoot/$Tag/SHA256SUMS" -OutFile $ChecksumPath

  $MatchingLines = @(Get-Content -LiteralPath $ChecksumPath | Where-Object {
    $_ -match '^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$' -and $Matches[2] -ceq $InstallerName
  })
  if ($MatchingLines.Count -ne 1) {
    throw "Checksum manifest does not contain exactly one entry for $InstallerName"
  }
  $EXPECTED_CHECKSUM = ([regex]::Match($MatchingLines[0], '^([0-9a-f]{64})  ')).Groups[1].Value
  $ActualChecksum = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($EXPECTED_CHECKSUM -cne $ActualChecksum) {
    throw 'SHA-256 verification failed'
  }

  Write-Status 'SHA-256 verified'
  Write-Status 'launching the unsigned NSIS installer; Windows may show More info / Run anyway'
  Start-Process -FilePath $InstallerPath -Wait
}
finally {
  Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ChecksumPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $TempDirectory -Force -ErrorAction SilentlyContinue
}
