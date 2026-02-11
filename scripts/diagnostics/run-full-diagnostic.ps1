# ============================================================================
# Full Pipeline Diagnostic Runner (PowerShell)
# Purpose: Execute all diagnostic queries and generate comprehensive report
# Usage: .\scripts\diagnostics\run-full-diagnostic.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

# Database connection (uses environment variables or defaults)
$DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$DB_PORT = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }
$DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "optionsengines" }
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }

Write-Host "============================================================================" -ForegroundColor Blue
Write-Host "OPTIONSENGINES PIPELINE DIAGNOSTIC" -ForegroundColor Blue
Write-Host "Date: $(Get-Date)" -ForegroundColor Blue
Write-Host "============================================================================" -ForegroundColor Blue
Write-Host ""

# Check if psql is available
if (!(Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: psql command not found. Please install PostgreSQL client." -ForegroundColor Red
    exit 1
}

# Create output directory
$OUTPUT_DIR = "scripts\diagnostics\reports"
if (!(Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
}

$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
$REPORT_FILE = "$OUTPUT_DIR\diagnostic_report_$TIMESTAMP.txt"

Write-Host "Generating diagnostic report..." -ForegroundColor Green
Write-Host ""

# Run summary first
Write-Host "Running Executive Summary..." -ForegroundColor Yellow
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME `
  -f scripts\diagnostics\generate-summary.sql `
  > $REPORT_FILE 2>&1

Write-Host "✓ Summary complete" -ForegroundColor Green
Write-Host ""

# Run detailed pipeline forensics
Write-Host "Running Pipeline Forensics..." -ForegroundColor Yellow
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME `
  -f scripts\diagnostics\pipeline-forensics.sql `
  >> $REPORT_FILE 2>&1

Write-Host "✓ Pipeline forensics complete" -ForegroundColor Green
Write-Host ""

# Run GEX deep dive
Write-Host "Running GEX Deep Dive..." -ForegroundColor Yellow
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME `
  -f scripts\diagnostics\gex-deep-dive.sql `
  >> $REPORT_FILE 2>&1

Write-Host "✓ GEX analysis complete" -ForegroundColor Green
Write-Host ""

# Run trade quality forensics
Write-Host "Running Trade Quality Forensics..." -ForegroundColor Yellow
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME `
  -f scripts\diagnostics\trade-quality-forensics.sql `
  >> $REPORT_FILE 2>&1

Write-Host "✓ Trade quality analysis complete" -ForegroundColor Green
Write-Host ""

Write-Host "============================================================================" -ForegroundColor Blue
Write-Host "DIAGNOSTIC COMPLETE" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Blue
Write-Host ""
Write-Host "Report saved to: $REPORT_FILE" -ForegroundColor Green
Write-Host ""
Write-Host "To view the report:" -ForegroundColor Cyan
Write-Host "  Get-Content $REPORT_FILE" -ForegroundColor Yellow
Write-Host "  notepad $REPORT_FILE" -ForegroundColor Yellow
Write-Host ""
Write-Host "To search for specific issues:" -ForegroundColor Cyan
Write-Host "  Select-String -Path $REPORT_FILE -Pattern 'critical' -CaseSensitive:$false" -ForegroundColor Yellow
Write-Host "  Select-String -Path $REPORT_FILE -Pattern 'warning' -CaseSensitive:$false" -ForegroundColor Yellow
Write-Host "  Select-String -Path $REPORT_FILE -Pattern 'violation' -CaseSensitive:$false" -ForegroundColor Yellow
Write-Host ""
