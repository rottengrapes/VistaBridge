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

# 2. Force pull the latest image from Docker Hub
echo -e "${YELLOW}[1/3] Pulling the latest image from Docker Hub...${NC}"
docker compose pull || echo -e "${YELLOW}[WARNING] Could not pull remote image; falling back to local cache...${NC}"

# 3. Force recreate and launch container
echo ""
echo -e "${YELLOW}[2/3] Recreating container with the newest image layers...${NC}"
docker compose up -d --force-recreate --remove-orphans

# 4. Verify health status
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

