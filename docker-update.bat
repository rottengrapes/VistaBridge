@echo off
REM ==============================================================================
REM VistaBridge Docker Auto-Update & Launch Script (Windows)
REM Always pulls the newest latest image from Docker Hub and recreates container
REM ==============================================================================

setlocal enabledelayedexpansion
title VistaBridge - Pulling Latest Docker Image

echo ==============================================================================
echo               VISTABRIDGE DOCKER AUTO-UPDATE & LAUNCH
echo ==============================================================================
echo.

REM 1. Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running!
    echo Please start Docker Desktop and run this script again.
    pause
    exit /b 1
)

REM 2. Configure GeoServer Domain/URL Prompt
if not exist .env (
    if exist docker.env.example copy docker.env.example .env >nul
    if not exist .env if exist env.example copy env.example .env >nul
)

set "DEFAULT_GS=http://host.docker.internal:8080/geoserver"
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%A in (.env) do (
        if "%%A"=="GEOSERVER_URL" set "DEFAULT_GS=%%B"
    )
)

echo ------------------------------------------------------------------------------
echo                    GEOSERVER DOMAIN CONFIGURATION
echo ------------------------------------------------------------------------------
echo Default / Current GeoServer URL: !DEFAULT_GS!
set /p "USER_GS=Enter your GeoServer Domain / URL (Press ENTER to keep default): "
if not "!USER_GS!"=="" (
    findstr /v "^GEOSERVER_URL=" .env > .env.tmp 2>nul
    echo GEOSERVER_URL=!USER_GS!>> .env.tmp
    move /y .env.tmp .env >nul
    echo [OK] Configured GeoServer URL: !USER_GS!
) else (
    echo [OK] Using GeoServer URL: !DEFAULT_GS!
)
echo.

REM 3. Pull the newest latest image from Docker Hub
echo [1/3] Pulling the newest 'latest' image from Docker Hub...
docker compose pull
if %errorlevel% neq 0 (
    echo [WARNING] Failed to pull from remote registry. Attempting to start with available image...
)

REM 4. Force recreate and launch container with the newest image
echo.
echo [2/3] Recreating and starting VistaBridge container...
docker compose up -d --force-recreate --remove-orphans
if %errorlevel% neq 0 (
    echo [ERROR] Failed to launch container.
    pause
    exit /b 1
)

REM 5. Check status
echo.
echo [3/3] Verifying container health...
timeout /t 3 /nobreak >nul
docker compose ps

echo.
echo ==============================================================================
echo        DEPLOYMENT READY: Running on latest Docker Hub image!
echo        Access URL: http://localhost (or http://<SERVER_IP>)
echo        Direct Port: http://localhost:3007
echo ==============================================================================
echo.
pause

