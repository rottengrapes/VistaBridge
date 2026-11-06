#!/usr/bin/env bash

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}                     VISTABRIDGE SETUP WIZARD                         ${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo ""

# -------------------------------------------------------------------------
# 0. CHECK NODE.JS
# -------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Node.js is not found in your system PATH!${NC}"
    echo "Please install Node.js v18 or higher from https://nodejs.org"
    echo ""
    exit 1
fi

# -------------------------------------------------------------------------
# 1. CHECK DEPENDENCIES
# -------------------------------------------------------------------------
if [ ! -d "node_modules" ]; then
    echo "[*] Dependencies not found. Installing packages..."
    echo "[*] Please wait while npm install finishes..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}[ERROR] npm install encountered an error. Please check your network.${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK] Dependencies installed successfully!${NC}"
    echo ""
fi

# -------------------------------------------------------------------------
# 2. CHECK EXISTING DATABASE & SETTINGS
# -------------------------------------------------------------------------
ACTIVE_DB="./data/geovista.db"
SKIP_CONFIG=false
DEFAULT_GS="http://localhost:8080/geoserver"
DEFAULT_PORT="3000"

if [ -f "$ACTIVE_DB" ]; then
    # Read existing settings from SQLite
    EXISTING_GS=$(node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:$ACTIVE_DB' }); const r = await c.execute(\"SELECT value FROM app_settings WHERE key = 'geoserver_url'\"); console.log(r.rows.length ? r.rows[0].value : 'http://localhost:8080/geoserver'); } catch(e) { console.log('http://localhost:8080/geoserver'); } } get();" 2>/dev/null)
    [ -z "$EXISTING_GS" ] && EXISTING_GS="http://localhost:8080/geoserver"

    EXISTING_PORT=$(node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:$ACTIVE_DB' }); const r = await c.execute(\"SELECT value FROM app_settings WHERE key = 'app_port'\"); console.log(r.rows.length ? r.rows[0].value : '3000'); } catch(e) { console.log('3000'); } } get();" 2>/dev/null)
    [ -z "$EXISTING_PORT" ] && EXISTING_PORT="3000"

    echo -e "${GREEN}[OK] Existing database detected: ${ACTIVE_DB}${NC}"
    echo "----------------------------------------------------------------------"
    echo "  Current GeoServer: $EXISTING_GS"
    echo "  Current Port:      $EXISTING_PORT"
    echo "----------------------------------------------------------------------"
    echo ""
    echo "What would you like to do?"
    echo "  [1] Keep existing settings & continue (Default - press ENTER)"
    echo "  [2] Change GeoServer URL or Port"
    echo "  [3] Reset database (Start with a fresh, empty database)"
    echo ""
    read -r -p "Your choice [1/2/3, default 1]: " SETUP_MODE
    [ -z "$SETUP_MODE" ] && SETUP_MODE="1"

    if [ "$SETUP_MODE" = "1" ]; then
        FINAL_GS="$EXISTING_GS"
        APP_PORT="$EXISTING_PORT"
        SKIP_CONFIG=true
    elif [ "$SETUP_MODE" = "2" ]; then
        DEFAULT_GS="$EXISTING_GS"
        DEFAULT_PORT="$EXISTING_PORT"
        SKIP_CONFIG=false
    elif [ "$SETUP_MODE" = "3" ]; then
        echo ""
        read -r -p "Are you sure you want to delete $ACTIVE_DB and all saved maps/dashboards? (y/N): " CONFIRM_RESET
        if [[ "$CONFIRM_RESET" =~ ^[Yy]$ ]]; then
            rm -f "$ACTIVE_DB"
            echo -e "${YELLOW}[!] Database deleted. Starting fresh setup...${NC}"
            SKIP_CONFIG=false
            DEFAULT_GS="http://localhost:8080/geoserver"
            DEFAULT_PORT="3000"
        else
            echo "[*] Database reset cancelled. Keeping existing settings."
            FINAL_GS="$EXISTING_GS"
            APP_PORT="$EXISTING_PORT"
            SKIP_CONFIG=true
        fi
    else
        FINAL_GS="$EXISTING_GS"
        APP_PORT="$EXISTING_PORT"
        SKIP_CONFIG=true
    fi
else
    echo -e "${YELLOW}[!] No existing database found. Initializing first-time setup...${NC}"
    echo ""
fi

# -------------------------------------------------------------------------
# 3. CONFIGURE GEOSERVER & PORT (If needed)
# -------------------------------------------------------------------------
if [ "$SKIP_CONFIG" = false ]; then
    echo "----------------------------------------------------------------------"
    echo " GeoServer Configuration"
    echo "----------------------------------------------------------------------"
    echo "Default: $DEFAULT_GS"
    read -r -p "Enter GeoServer URL (Press ENTER to use default): " USER_GS

    if [ -n "$USER_GS" ]; then
        FINAL_GS="$USER_GS"
    else
        FINAL_GS="$DEFAULT_GS"
    fi

    if [ "$FINAL_GS" = "." ] || [ "$FINAL_GS" = "./" ] || [ -z "$FINAL_GS" ]; then
        FINAL_GS="http://localhost:8080/geoserver"
    fi
    if [[ ! "$FINAL_GS" =~ ^https?:// ]]; then
        FINAL_GS="http://$FINAL_GS"
    fi
    FINAL_GS="${FINAL_GS%/}"

    echo ""
    echo "----------------------------------------------------------------------"
    echo " Frontend Port Configuration"
    echo "----------------------------------------------------------------------"

    APP_PORT="$DEFAULT_PORT"
    while true; do
        read -r -p "Enter frontend port (default $APP_PORT, press ENTER to use default): " USER_PORT
        if [ -n "$USER_PORT" ]; then
            if ! [[ "$USER_PORT" =~ ^[0-9]+$ ]]; then
                echo -e "${RED}[ERROR] Invalid port number. Please enter a number between 1024 and 65535.${NC}"
                continue
            fi
            APP_PORT="$USER_PORT"
        fi

        # Check if port is in use
        PORT_PID=""
        if command -v lsof >/dev/null 2>&1; then
            PORT_PID=$(lsof -ti :"$APP_PORT" 2>/dev/null)
        elif command -v ss >/dev/null 2>&1; then
            PORT_PID=$(ss -lptn "sport = :$APP_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
        fi

        if [ -n "$PORT_PID" ]; then
            echo ""
            echo -e "${YELLOW}[WARN] Port $APP_PORT is currently in use (PID: $PORT_PID).${NC}"
            echo ""
            echo "  [1] Kill the process on port $APP_PORT and use it anyway"
            echo "  [2] Enter a different port"
            echo ""
            read -r -p "Your choice (1 or 2): " PORT_CHOICE
            if [ "$PORT_CHOICE" = "1" ]; then
                echo "[*] Terminating process on port $APP_PORT [PID: $PORT_PID]..."
                kill -9 $PORT_PID 2>/dev/null || true
                echo -e "${GREEN}[OK] Port $APP_PORT is now free.${NC}"
                break
            else
                APP_PORT=3000
                continue
            fi
        else
            break
        fi
    done

    echo -e "${GREEN}[OK] Frontend will run on port $APP_PORT.${NC}"

    # -------------------------------------------------------------------------
    # 4. SAVE CONFIGURATION TO SQLITE
    # -------------------------------------------------------------------------
    echo ""
    echo "[*] Saving configuration..."

    mkdir -p "data"

    # Remove any .env files - project runs 100% from SQLite
    rm -f .env .env.local .env.production >/dev/null 2>&1

    node -e "const { createClient } = require('@libsql/client'); const crypto = require('crypto'); async function save() { try { const c = createClient({ url: 'file:data/geovista.db' }); await c.execute('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['geoserver_url', process.argv[1]] }); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', args: ['tileserv_url', 'http://localhost:7800'] }); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['app_port', process.argv[2]] }); const row = await c.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['jwt_secret'] }); if (row.rows.length === 0) { const newKey = crypto.randomBytes(64).toString('base64'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?)', args: ['jwt_secret', newKey] }); } } catch(e){ console.error('SQLite configuration error:', e.message || e); process.exit(1); } } save();" "$FINAL_GS" "$APP_PORT"
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Could not save configuration to data/geovista.db. Check permissions and try again.${NC}"
        exit 1
    fi

    echo -e "${GREEN}[OK] Configuration saved directly into SQLite database (data/geovista.db)!${NC}"
    echo -e "${GREEN}[OK] Zero .env files created - project runs 100% from SQLite database.${NC}"
fi

# -------------------------------------------------------------------------
# 5. VERIFY CONNECTION
# -------------------------------------------------------------------------
echo ""
echo "[*] Checking GeoServer reachability [$FINAL_GS]..."
if curl -s -I --max-time 5 "$FINAL_GS/web/" >/dev/null 2>&1; then
    echo -e " ${GREEN}[OK] GeoServer is ONLINE.${NC}"
else
    echo -e " ${YELLOW}[WARN] GeoServer did not respond within 5s at $FINAL_GS. (Setup will continue)${NC}"
fi

# -------------------------------------------------------------------------
# 6. SMART BUILD CHECK
# -------------------------------------------------------------------------
NEEDS_REBUILD=true

if [ -d ".next" ] && [ "$SKIP_CONFIG" = true ]; then
    echo ""
    echo -e "${GREEN}[OK] Production build (.next) is already compiled.${NC}"
    read -r -p "Do you want to recompile the build? (y/N, default No): " REBUILD_CHOICE
    if [[ "$REBUILD_CHOICE" =~ ^[Yy]$ ]]; then
        NEEDS_REBUILD=true
    else
        NEEDS_REBUILD=false
    fi
fi

if [ "$NEEDS_REBUILD" = true ]; then
    if [ -d ".next" ]; then
        echo "[*] Clearing previous Next.js build cache..."
        rm -rf ".next"
    fi

    echo ""
    echo -e "${CYAN}======================================================================${NC}"
    echo -e "${CYAN}[*] Compiling optimized production build (npm run build)...            ${NC}"
    echo -e "${CYAN}[*] This removes all development error overlays and maximizes speed.  ${NC}"
    echo -e "${CYAN}======================================================================${NC}"
    echo ""
    npm run build
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}[ERROR] Build encountered an error! Please check output above.${NC}"
        exit 1
    fi
fi

# -------------------------------------------------------------------------
# 7. COMPLETION & LAUNCH
# -------------------------------------------------------------------------
echo ""
echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}                  SETUP COMPLETED SUCCESSFULLY!                      ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo "Active GeoServer: $FINAL_GS"
echo "Frontend Port:    $APP_PORT"
echo "Database:         $ACTIVE_DB"
echo ""
echo "You can start the application anytime by running:"
echo "    ./start.sh"
echo "======================================================================"
echo ""

read -r -p "Would you like to start the application now? (Y/n): " LAUNCH
if [[ "$LAUNCH" =~ ^[Nn]$ ]]; then
    echo ""
    echo "Setup done. Run ./start.sh when you are ready!"
    exit 0
fi

bash "$SCRIPT_DIR/start.sh"
