# C2 production pre-maintenance verification — Windows PowerShell 5.1+.
# Reads only: GETs Node /ready and Python /health, compares build SHAs.
# No access token required. Performs no writes, freezes, or migrations.
#
# Run:  powershell -ExecutionPolicy Bypass -File C2-verify-production.ps1
# Then paste the RESULTS BLOCK (printed at the end) back to chat.

$ErrorActionPreference = 'Stop'

$NodeReadyUrl = 'https://revluma-backend-lqve.onrender.com/ready'
$PythonHealthUrl = 'https://revluma-python-swwk.onrender.com/health'
# Known C2-identical commits: #519 merge, #522 merge (waitlist-only, verified).
$AcceptedPrefixes = @('9a133438', '48957cc')

$failures = @()

function Get-JsonEndpoint([string]$url, [string]$label) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 30 -UseBasicParsing
        $status = [int]$resp.StatusCode
        $body = $resp.Content | ConvertFrom-Json
        return @{ ok = $true; status = $status; body = $body; error = $null }
    } catch {
        $msg = $_.Exception.Message
        $webEx = $_.Exception
        if ($webEx.Response -ne $null) {
            try { $msg = 'HTTP ' + [int]$webEx.Response.StatusCode + ' ' + $msg } catch { }
        }
        return @{ ok = $false; status = -1; body = $null; error = $msg }
    }
}

function Test-AcceptedSha([string]$sha) {
    if ([string]::IsNullOrWhiteSpace($sha) -or $sha -eq 'unknown') { return 'UNKNOWN' }
    foreach ($prefix in $AcceptedPrefixes) {
        if ($sha.StartsWith($prefix)) { return 'ACCEPTED' }
    }
    return 'MISMATCH'
}

function Test-ShaPair([string]$a, [string]$b) {
    if ([string]::IsNullOrWhiteSpace($a) -or [string]::IsNullOrWhiteSpace($b)) { return $false }
    if ($a -eq 'unknown' -or $b -eq 'unknown') { return $false }
    $n = 12
    if ($a.Length -lt $n) { $n = $a.Length }
    if ($b.Length -lt $n) { $n = $b.Length }
    if ($n -lt 7) { return $false }
    return ($a.Substring(0, $n) -eq $b.Substring(0, $n))
}

Write-Host '== C2 production verification ==' -ForegroundColor Cyan
Write-Host ''

# --- Node /ready ---
$node = Get-JsonEndpoint $NodeReadyUrl 'node'
$nodeHttp = $node.status
$nodeStatus = ''; $nodeBuild = ''; $pyBuildViaNode = ''
$nodeDbReady = ''; $nodePyReady = ''
if ($node.ok) {
    $nodeStatus = [string]$node.body.status
    $nodeBuild = [string]$node.body.node_build
    $pyBuildViaNode = [string]$node.body.python_build
    $nodeDbReady = [string]$node.body.database_ready
    $nodePyReady = [string]$node.body.python_ready
}
Write-Host ('Node /ready: HTTP {0}' -f $nodeHttp)
if (-not $node.ok) {
    Write-Host ('  ERROR: {0}' -f $node.error) -ForegroundColor Red
    $failures += 'node_ready_unreachable'
} else {
    Write-Host ('  status={0} node_build={1} python_build={2} database_ready={3} python_ready={4}' -f $nodeStatus, $nodeBuild, $pyBuildViaNode, $nodeDbReady, $nodePyReady)
    if ($nodeHttp -ne 200) { $failures += 'node_http_not_200' }
    if ($nodeStatus -ne 'ready') { $failures += 'node_status_not_ready' }
    if ($nodeDbReady -ne 'True') { $failures += 'node_database_not_ready' }
    if ($nodePyReady -ne 'True') { $failures += 'node_reports_python_not_ready' }
}
$nodeShaVerdict = 'SKIP'
if ($node.ok) {
    $nodeShaVerdict = Test-AcceptedSha $nodeBuild
    if ($nodeShaVerdict -eq 'MISMATCH') { $failures += 'node_sha_mismatch' }
    if ($nodeShaVerdict -eq 'UNKNOWN') { $failures += 'node_sha_unknown' }
}
Write-Host ('  node_build verdict: {0}' -f $nodeShaVerdict)
Write-Host ''

# --- Python /health ---
$py = Get-JsonEndpoint $PythonHealthUrl 'python'
$pyHttp = $py.status
$pyBuild = ''; $pyVersion = ''; $pyStatus = ''; $pyModels = ''
if ($py.ok) {
    $pyBuild = [string]$py.body.build
    $pyVersion = [string]$py.body.version
    $pyStatus = [string]$py.body.status
    $pyModels = [string]$py.body.model_status
}
Write-Host ('Python /health: HTTP {0}' -f $pyHttp)
if (-not $py.ok) {
    Write-Host ('  ERROR: {0}' -f $py.error) -ForegroundColor Red
    $failures += 'python_health_unreachable'
} else {
    Write-Host ('  build={0} version={1} status={2} model_status={3}' -f $pyBuild, $pyVersion, $pyStatus, $pyModels)
    if ($pyHttp -ne 200) { $failures += 'python_http_not_200' }
    if ($pyStatus -ne 'ok') { $failures += 'python_status_not_ok' }
}
$pyShaVerdict = 'SKIP'
if ($py.ok) {
    $pyShaVerdict = Test-AcceptedSha $pyBuild
    if ($pyShaVerdict -eq 'MISMATCH') { $failures += 'python_sha_mismatch' }
    if ($pyShaVerdict -eq 'UNKNOWN') { $failures += 'python_sha_unknown' }
}
Write-Host ('  build verdict: {0}' -f $pyShaVerdict)
Write-Host ''

# --- Cross-service SHA agreement ---
$pairVerdict = 'SKIP'
if ($node.ok -and $py.ok) {
    if ((Test-ShaPair $nodeBuild $pyBuild) -or (Test-ShaPair $pyBuildViaNode $pyBuild)) {
        $pairVerdict = 'AGREE'
    } else {
        $pairVerdict = 'DISAGREE'
        $failures += 'services_on_different_commits'
    }
}
Write-Host ('Cross-service SHA agreement: {0}' -f $pairVerdict)
Write-Host ''

# --- Overall ---
if ($failures.Count -eq 0) {
    Write-Host 'OVERALL: PASS — paste the results block below to chat.' -ForegroundColor Green
} else {
    Write-Host ('OVERALL: FAIL ({0}) — paste the results block AND the full output above.' -f ($failures -join ', ')) -ForegroundColor Red
}
Write-Host ''
Write-Host '--- RESULTS BLOCK (copy everything below this line) ---'
Write-Host ('A1: HTTP={0} status={1} node_build={2} python_build={3} python_ready={4} database_ready={5}' -f $nodeHttp, $nodeStatus, $nodeBuild, $pyBuildViaNode, $nodePyReady, $nodeDbReady)
Write-Host ('A2: HTTP={0} build={1} version={2} status={3} model_status={4}' -f $pyHttp, $pyBuild, $pyVersion, $pyStatus, $pyModels)
Write-Host ('SHA: node={0} python={1} agreement={2} overall_failures={3}' -f $nodeShaVerdict, $pyShaVerdict, $pairVerdict, $(if ($failures.Count -eq 0) { 'none' } else { $failures -join ',' }))
