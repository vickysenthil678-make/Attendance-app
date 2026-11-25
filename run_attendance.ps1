$projectRoot = $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path (Join-Path $projectRoot 'backend\.env'))) {
    Write-Error 'Create backend\.env from backend\.env.example and configure the existing database connection before starting.'
    exit 1
}

npm run dev
exit $LASTEXITCODE
