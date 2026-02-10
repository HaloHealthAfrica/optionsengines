#!/bin/bash

# ============================================================================
# Full Pipeline Diagnostic Runner
# Purpose: Execute all diagnostic queries and generate comprehensive report
# Usage: ./scripts/diagnostics/run-full-diagnostic.sh
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database connection (uses environment variables or defaults)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-optionsengines}"
DB_USER="${DB_USER:-postgres}"

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}OPTIONSENGINES PIPELINE DIAGNOSTIC${NC}"
echo -e "${BLUE}Date: $(date)${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo -e "${RED}ERROR: psql command not found. Please install PostgreSQL client.${NC}"
    exit 1
fi

# Create output directory
OUTPUT_DIR="scripts/diagnostics/reports"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$OUTPUT_DIR/diagnostic_report_$TIMESTAMP.txt"

echo -e "${GREEN}Generating diagnostic report...${NC}"
echo ""

# Run summary first
echo -e "${YELLOW}Running Executive Summary...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -f scripts/diagnostics/generate-summary.sql \
  > "$REPORT_FILE" 2>&1

echo -e "${GREEN}✓ Summary complete${NC}"
echo ""

# Run detailed pipeline forensics
echo -e "${YELLOW}Running Pipeline Forensics...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -f scripts/diagnostics/pipeline-forensics.sql \
  >> "$REPORT_FILE" 2>&1

echo -e "${GREEN}✓ Pipeline forensics complete${NC}"
echo ""

# Run GEX deep dive
echo -e "${YELLOW}Running GEX Deep Dive...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -f scripts/diagnostics/gex-deep-dive.sql \
  >> "$REPORT_FILE" 2>&1

echo -e "${GREEN}✓ GEX analysis complete${NC}"
echo ""

# Run trade quality forensics
echo -e "${YELLOW}Running Trade Quality Forensics...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -f scripts/diagnostics/trade-quality-forensics.sql \
  >> "$REPORT_FILE" 2>&1

echo -e "${GREEN}✓ Trade quality analysis complete${NC}"
echo ""

echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}DIAGNOSTIC COMPLETE${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
echo -e "Report saved to: ${GREEN}$REPORT_FILE${NC}"
echo ""
echo -e "To view the report:"
echo -e "  ${YELLOW}cat $REPORT_FILE${NC}"
echo -e "  ${YELLOW}less $REPORT_FILE${NC}"
echo ""
echo -e "To search for specific issues:"
echo -e "  ${YELLOW}grep -i 'critical' $REPORT_FILE${NC}"
echo -e "  ${YELLOW}grep -i 'warning' $REPORT_FILE${NC}"
echo -e "  ${YELLOW}grep -i 'violation' $REPORT_FILE${NC}"
echo ""
