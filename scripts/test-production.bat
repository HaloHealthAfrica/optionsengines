@echo off
REM Production E2E Test Helper Script for Windows
REM Makes it easy to run production tests with proper configuration

echo ================================================================================
echo               Production E2E Testing with Sentry Tracing
echo ================================================================================
echo.

REM Check if .env file exists
if not exist .env (
    echo WARNING: .env file not found
    echo.
    echo Please create a .env file with:
    echo   PRODUCTION_URL=https://your-production-url.com/webhook
    echo   SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
    echo.
    echo Or set environment variables manually:
    echo   set PRODUCTION_URL=https://your-production-url.com/webhook
    echo   set SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
    echo.
)

REM Check if PRODUCTION_URL is set
if "%PRODUCTION_URL%"=="" (
    echo ERROR: PRODUCTION_URL is not set
    echo.
    echo Please set PRODUCTION_URL:
    echo   set PRODUCTION_URL=https://your-production-url.com/webhook
    echo.
    echo Or add to .env file:
    echo   PRODUCTION_URL=https://your-production-url.com/webhook
    echo.
    exit /b 1
)

REM Check if SENTRY_DSN is set
if "%SENTRY_DSN%"=="" (
    echo WARNING: SENTRY_DSN is not set
    echo    Sentry tracing will be disabled
    echo.
    echo To enable Sentry tracing:
    echo   set SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
    echo.
    set /p continue="Continue without Sentry? (y/n) "
    if /i not "%continue%"=="y" exit /b 1
)

REM Set default TEST_COUNT if not set
if "%TEST_COUNT%"=="" set TEST_COUNT=5

echo Configuration:
echo   Production URL: %PRODUCTION_URL%
if not "%SENTRY_DSN%"=="" (
    echo   Sentry DSN: Enabled
) else (
    echo   Sentry DSN: Disabled
)
echo   Test Count: %TEST_COUNT%
echo.

set /p run="Run production E2E tests? (y/n) "
if /i not "%run%"=="y" (
    echo Cancelled
    exit /b 0
)

echo.
echo Running tests...
echo.

REM Run the tests
call npm run test:production

echo.
echo ================================================================================
echo                             Tests Complete
echo ================================================================================
echo.
echo Next steps:
echo   1. Review the test report above
echo   2. Run 'npm run analyze:sentry' for detailed analysis guide
echo   3. Check Sentry dashboard for trace details
echo   4. Fix any issues found
echo   5. Re-run tests to verify fixes
echo.
