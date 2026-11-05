param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE). Publication stopped." }
}

function Read-Git {
    param([string[]]$Arguments)
    $output = & git -c "safe.directory=$($repoRoot.Replace('\', '/'))" -C $repoRoot @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Git check failed. Publication stopped.' }
    return $output
}

Push-Location $repoRoot
try {
    Invoke-Checked -Command node -Arguments @('scripts/check.mjs')
    Invoke-Checked -Command node -Arguments @('--test', 'scripts/voice.test.mjs', 'scripts/notifications.test.mjs', 'scripts/telegram.test.mjs', 'scripts/diary-backup.test.mjs')
    Invoke-Checked -Command npm.cmd -Arguments @('--prefix', 'worker', 'run', 'check')
    Invoke-Checked -Command npm.cmd -Arguments @('--prefix', 'worker', 'run', 'dry-run')
    if ($CheckOnly) { return }

    if ((Read-Git -Arguments @('branch', '--show-current')) -ne 'main') { throw 'Publish from main only.' }
    if (Read-Git -Arguments @('status', '--porcelain')) { throw 'Commit all intended changes before publication.' }
    if ((Read-Git -Arguments @('remote', 'get-url', 'origin')) -ne 'https://github.com/kolpakov-uz/kalorii.git') {
        throw 'Unexpected origin repository.'
    }
    Read-Git -Arguments @('fetch', 'origin', 'main')
    Read-Git -Arguments @('merge-base', '--is-ancestor', 'origin/main', 'HEAD')

    # Publish the server first so the new application can use it immediately.
    Invoke-Checked -Command npm.cmd -Arguments @('--prefix', 'worker', 'run', 'deploy')
    Read-Git -Arguments @('push', 'origin', 'main')
    Write-Host 'Worker deployed; GitHub Pages publication requested by pushing main.'
    Write-Host 'Check the Pages build before reporting the release as complete.'
} finally {
    Pop-Location
}
