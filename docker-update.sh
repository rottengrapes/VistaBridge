#!/usr/bin/env bash
# ==============================================================================
# VistaBridge Docker Auto-Update & Launch Script (Linux / macOS)
# Always pulls the newest latest image from Docker Hub and recreates container
# ==============================================================================

set -e

# Terminal formatting colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${CYAN}               VISTABRIDGE DOCKER AUTO-UPDATE & LAUNCH                        ${NC}"
echo -e "${CYAN}==============================================================================${NC}"
echo ""

# 1. Verify Docker Engine
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Docker is not running or current user lacks docker permissions.${NC}"
    exit 1
fi

# 2. Universal architecture detection (Graceful fallback for macOS Apple Silicon if remote lacks ARM manifest)
OS_TYPE="$(uname -s)"
ARCH_TYPE="$(uname -m)"

if [ "$OS_TYPE" = "Darwin" ] && [ "$ARCH_TYPE" = "arm64" ]; then
    # On Apple Silicon Mac, export default platform fallback so older x86-only images run seamlessly via Rosetta 2
    export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
    echo -e "${CYAN}[INFO] macOS Apple Silicon detected. Default platform set to ${DOCKER_DEFAULT_PLATFORM}.${NC}"
fi

# 3. GeoServer Domain / URL Configuration Prompt
if [ ! -f .env ]; then
    if [ -f docker.env.example ]; then
        cp docker.env.example .env
    elif [ -f env.example ]; then
        cp env.example .env
    fi
fi

CURRENT_GS=""
if [ -f .env ]; then
    CURRENT_GS=$(grep -E "^GEOSERVER_URL=" .env 2>/dev/null | head -n 1 | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi
DEFAULT_GS="${CURRENT_GS:-http://host.docker.internal:8080/geoserver}"

echo -e "${CYAN}------------------------------------------------------------------------------${NC}"
echo -e "${CYAN}                    GEOSERVER DOMAIN CONFIGURATION                            ${NC}"
echo -e "${CYAN}------------------------------------------------------------------------------${NC}"
echo -e "Default / Current GeoServer URL: ${YELLOW}$DEFAULT_GS${NC}"
read -r -p "Enter your GeoServer Domain / URL (Press ENTER to keep default): " USER_GS

if [ -n "$USER_GS" ]; then
    USER_GS=$(echo "$USER_GS" | sed 's:/*$::')
    if [ -f .env ] && grep -q "^GEOSERVER_URL=" .env; then
        sed -i.bak "s|^GEOSERVER_URL=.*|GEOSERVER_URL=$USER_GS|" .env && rm -f .env.bak
    else
        echo "GEOSERVER_URL=$USER_GS" >> .env
    fi
    echo -e "${GREEN}[OK] Configured GeoServer URL: $USER_GS${NC}"
else
    echo -e "${GREEN}[OK] Using GeoServer URL: $DEFAULT_GS${NC}"
fi
echo ""

# 4. Force pull the latest image from Docker Hub
echo -e "${YELLOW}[1/3] Pulling the latest image from Docker Hub...${NC}"
docker compose pull || echo -e "${YELLOW}[WARNING] Could not pull remote image; falling back to local cache...${NC}"

# 5. Force recreate and launch container
echo ""
echo -e "${YELLOW}[2/3] Recreating container with the newest image layers...${NC}"
docker compose up -d --force-recreate --remove-orphans

# 6. Verify health status
echo ""
echo -e "${YELLOW}[3/3] Checking container status...${NC}"
sleep 2
docker compose ps

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}        DEPLOYMENT READY: Running on latest Docker Hub image!                ${NC}"
echo -e "${GREEN}        Access URL: http://localhost (or http://<SERVER_IP>)                ${NC}"
echo -e "${GREEN}        Direct Port: http://localhost:3007                                    ${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""

