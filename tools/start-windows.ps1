$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root

function Install-NodeRuntime {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (!$arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        AMD64 { $arch = 'x64' }
        ARM64 { $arch = 'arm64' }
        default { throw 'A 64-bit Windows installation is required.' }
    }
    $base = 'https://nodejs.org/dist'
    Write-Host 'Downloading Node.js 24 LTS from nodejs.org...'
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/latest-v24.x/SHASUMS256.txt" -TimeoutSec 60).Content
    $release = [regex]::Match($sums, "(?m)^([0-9a-f]{64})\s+(node-(v24\.\d+\.\d+)-win-$arch)\.zip\s*$")
    if (!$release.Success) { throw 'Could not find the official Node.js archive.' }
    $name = $release.Groups[2].Value
    $stage = New-Item -ItemType Directory -Path (Join-Path $root ('.tmp-node-' + [guid]::NewGuid().ToString('N')))
    try {
        $archive = Join-Path $stage.FullName "$name.zip"
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$($release.Groups[3].Value)/$name.zip" -OutFile $archive -TimeoutSec 600
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $release.Groups[1].Value) {
            throw 'Node.js archive checksum did not match.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $stage.FullName
        $runtime = New-Item -ItemType Directory -Path (Join-Path $root '.runtime-node') -Force
        Get-ChildItem -LiteralPath (Join-Path $stage.FullName $name) | Copy-Item -Destination $runtime.FullName -Recurse -Force
    } finally {
        if ((Split-Path -Parent $stage.FullName) -eq $root) {
            Remove-Item -LiteralPath $stage.FullName -Recurse -Force
        }
    }
}

try {
    $node = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $needPackages = @('ws', 'pinyin-pro', 'opencc-js') | Where-Object {
        !(Test-Path -LiteralPath (Join-Path $root "node_modules\$_\package.json") -PathType Leaf)
    }
    $localNode = Join-Path $root '.runtime-node\node.exe'
    $localNpm = Join-Path $root '.runtime-node\npm.cmd'
    if ((Test-Path -LiteralPath $localNode) -and (Test-Path -LiteralPath $localNpm)) {
        $node = $localNode
        $npm = $localNpm
    }
    $validNode = $false
    if ($node) {
        $version = & $node --version
        $validNode = $LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22
    }
    if (!$validNode -or ($needPackages -and !$npm)) {
        Install-NodeRuntime
        $node = $localNode
        $npm = $localNpm
    }
    if ($needPackages) {
        Write-Host 'Installing application dependencies...'
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Application dependency installation failed. Check the network and run start.cmd again.' }
    }
    & $node (Join-Path $root 'server\server.js')
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
