# VistaBridge: Docker Hub CI/CD, Environment Variables & Local Testing Guide

This guide details the complete environment configuration, Docker build arguments, local validation procedure, and automated Docker Hub CI/CD pipeline for **VistaBridge**.

---

## 1. Environment Variables & Build Arguments Reference

All environment variables are declared in both the `builder` stage (as `ARG` & `ENV` for Next.js build-time bundling) and the `runner` stage (for runtime customization).

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3007` | Application port exposed inside the container and mapped to host. |
| `HOSTNAME` | `0.0.0.0` | Network interface binding. `0.0.0.0` ensures remote access from any IP. |
| `NODE_ENV` | `production` | Node.js production runtime optimization flag. |
| `NEXT_TELEMETRY_DISABLED` | `1` | Disables telemetry tracking during build and execution. |
| `DB_TYPE` | `sqlite` | Database engine type (`sqlite`). |
| `SQLITE_DB_PATH` | `/app/data/geovista.db` | Absolute path to the persistent SQLite database file inside container. |
| `GEOSERVER_URL` | `http://host.docker.internal:8080/geoserver` | Backend server-to-server GeoServer API endpoint. |
| `NEXT_PUBLIC_GEOSERVER_URL`| `http://host.docker.internal:8080/geoserver` | Frontend client-facing GeoServer endpoint for WMS/WFS layers. |
| `NEXT_PUBLIC_TILESERV_URL` | `http://host.docker.internal:7800` | Vector tile server endpoint (`pg_tileserv`). |
| `NEXT_PUBLIC_API_URL` | `/api` | Base path for Next.js internal serverless API routes. |
| `NEXT_PUBLIC_ANALYTICS_URL`| `http://host.docker.internal:8000` | Analytics and raster processing service endpoint. |
| `JWT_SECRET` | `""` | JWT token encryption key. Auto-generated and stored in SQLite if left empty. |

---

## 2. Local Testing Procedure (Before Pushing to GitHub)

Follow these steps to build and verify the container on your local machine.

### Step 1: Ensure Docker Desktop is Active
Verify the Docker daemon is running:
```powershell
docker --version
docker compose version
```

### Step 2: Build the Image Locally
From the `VistaBridge` directory, build the image with all environment defaults:
```powershell
cd VistaBridge
docker compose build
```
*(Or build with custom arguments via Docker CLI):*
```powershell
docker build -t vistabridge:local --build-arg PORT=3007 .
```

### Step 3: Run the Local Container
Launch the local container with persistent data storage:
```powershell
docker compose up -d
```

### Step 4: Verify Application Health
1. **Container State**:
   ```powershell
   docker compose ps
   ```
2. **Logs Verification**:
   ```powershell
   docker compose logs -f
   ```
   *Look for `[db.ts] Connected to SQLite database: /app/data/geovista.db` and Next.js starting on `0.0.0.0:3007`.*
3. **Health Endpoint Query**:
   ```powershell
   curl http://localhost:3007/api/config/public
   ```
4. **Browser Testing**:
   Open [http://localhost:3007](http://localhost:3007) and test map visualization and dashboard features.

### Step 5: Tear Down the Local Test Container
```powershell
docker compose down
```

---

## 3. GitHub Actions CI/CD to Docker Hub (Dynamic Sequential Versioning)

Every commit pushed to the `main` branch automatically triggers `.github/workflows/docker-build-push.yml` to compile a fresh image and generate:
- **`:latest` Tag**: Automatically updated to point to the newest build.
- **New Sequential Version Tag**: `rottengrapesprivatelimited/vistabridge:v1.0.<RUN_NUMBER>` (e.g. `v1.0.1`, `v1.0.2`, `v1.0.3`...) so every build has a unique, trackable version.
- **Commit SHA Tag**: `rottengrapesprivatelimited/vistabridge:sha-<SHORT_SHA>` for exact code traceability.

### Step 1: Configure Docker Hub Secrets in GitHub
1. In your GitHub repository (`rottengrapes/VistaBridge`), go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Add the following repository secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username or organization account (`rottengrapesprivatelimited`).
   - `DOCKERHUB_TOKEN`: Your Docker Hub Personal Access Token (created via Docker Hub Account Settings -> Security -> New Access Token with Read/Write/Delete permissions).

### Step 2: Commit and Push
```powershell
cd VistaBridge
git add .dockerignore Dockerfile docker-compose.yml docker.env.example DOCKER_GUIDE.md .github/workflows/docker-build-push.yml
git commit -m "feat(docker): add dynamic sequential version tagging and force-pull compose workflow"
git push origin main
```

---

## 4. Production Deployment & Guaranteed Latest Pull

On any server, to guarantee that Docker NEVER uses a stale local cache and ALWAYS pulls the brand new `:latest` image:

```bash
docker compose pull && docker compose up -d --force-recreate
```

### Why this guarantees you always run the latest version:
1. `docker compose pull`: Contacts Docker Hub and downloads the latest layers for `rottengrapesprivatelimited/vistabridge:latest`.
2. `pull_policy: always`: Instructs Docker Compose to inspect the remote registry before launching.
3. `--force-recreate`: Replaces the running container immediately with the brand new image while keeping all SQLite database records safe inside `./data`.

---

## 5. How a New User Sets Up Their Own Custom Environment (ENV)

If a new user, client, or team member pulls `rottengrapesprivatelimited/vistabridge:latest` and wants to run it with **their own custom GeoServer, custom port, and custom secrets**, they can do it using either of the two methods below.

---

### Option A: Using Docker Compose & a Custom `.env` File (Recommended)

A new user only needs **two files** (`docker-compose.yml` and a custom `.env`):

#### 1. Download or Copy `docker-compose.yml` and `docker.env.example`:
```bash
# Copy the example template to .env
cp docker.env.example .env
```

#### 2. Edit `.env` With Their Own Configuration:
The user opens `.env` and sets their specific parameters:
```env
# User's preferred host port
PORT=8080

# User's own GeoServer URL
GEOSERVER_URL=https://geoserver.clientcompany.com/geoserver
NEXT_PUBLIC_GEOSERVER_URL=https://geoserver.clientcompany.com/geoserver

# User's own tile server
NEXT_PUBLIC_TILESERV_URL=https://tiles.clientcompany.com

# Optional: User's own JWT secret (or leave blank to auto-generate)
JWT_SECRET=my-custom-secure-secret-key-12345
```

#### 3. Start the Container:
```bash
docker compose up -d
```
> **Result**: The container automatically spins up on port `8080`, binds to `0.0.0.0`, connects to `https://geoserver.clientcompany.com/geoserver`, and stores all user data in their local `./data` folder.

---

### Option B: Pure Docker CLI (Without Cloning the Repo or Using Compose)

A new user does **not even need to clone the repository**. They can pull the image and inject their environment variables directly via Docker CLI.

#### Method 1: Using an Environment File (`--env-file`)

1. The user creates a simple file named `my-vistabridge.env`:
   ```env
   PORT=9000
   HOSTNAME=0.0.0.0
   GEOSERVER_URL=https://geoserver.example.com/geoserver
   NEXT_PUBLIC_GEOSERVER_URL=https://geoserver.example.com/geoserver
   NEXT_PUBLIC_TILESERV_URL=http://localhost:7800
   JWT_SECRET=super-secret-key-token-here
   ```

2. The user pulls and runs the container:
   ```bash
   # Pull the latest image
   docker pull rottengrapesprivatelimited/vistabridge:latest

   # Run container using the custom env file
   docker run -d \
     --name vistabridge-app \
     --restart unless-stopped \
     -p 9000:9000 \
     --env-file ./my-vistabridge.env \
     -v vistabridge_data:/app/data \
     rottengrapesprivatelimited/vistabridge:latest
   ```

---

#### Method 2: Passing Environment Variables Inline (`-e` Flags)

The user can pass individual environment variables directly on the command line:

```bash
docker run -d \
  --name vistabridge-app \
  --restart unless-stopped \
  -p 8080:8080 \
  -e PORT=8080 \
  -e HOSTNAME=0.0.0.0 \
  -e GEOSERVER_URL="https://mygeoserver.org/geoserver" \
  -v "${PWD}/data:/app/data" \
  rottengrapesprivatelimited/vistabridge:latest
```
*(Note: If you do not have a GeoServer yet, simply omit `-e GEOSERVER_URL`. The app will start normally with standard defaults.)*

---

## 6. Automated Nginx Reverse Proxy (Port 80 & Domain/Server IP)

VistaBridge includes an integrated, auto-configured Nginx reverse proxy:

### Key Features:
- **Default Port 80**: Accessible on standard HTTP (`http://<SERVER_IP>` or `http://localhost`) without needing to specify `:3007`.
- **Automatic IP & Domain Detection**:
  - By default, `DOMAIN=_` allows traffic from any **Server IP address** or **localhost**.
  - To bind to a custom domain (e.g. `vistabridge.mycompany.com`), simply set `DOMAIN=vistabridge.mycompany.com` in `.env`.
- **Large GIS File Uploads**: `client_max_body_size 100M;` enables large Shapefile, GeoTIFF, and GeoJSON imports.
- **WebSocket & SSE Ready**: Next.js hydration, streaming, and live map updates are fully supported.
- **Auto Configuration**: Uses Docker's native `envsubst` to compile `nginx/templates/default.conf.template` at boot.

| Step | User Action |
| :--- | :--- |
| **1. Pull Image** | `docker pull rottengrapesprivatelimited/vistabridge:latest` |
| **2. Define Environment** | Set custom variables in `.env`, `my.env`, or inline `-e` flags |
| **3. Mount Database** | Mount `-v ./data:/app/data` or `-v vistabridge_data:/app/data` so their settings & maps persist |
| **4. Launch Container** | `docker compose up -d` OR `docker run -d ...` |
| **5. Access App** | Open in browser at `http://<SERVER_IP>:<PORT>` |

---

## 7. Troubleshooting: Apple Silicon (Mac M1/M2/M3/M4) Architecture Error

### Symptom:
On macOS (Apple Silicon M1, M2, M3, M4) or ARM64 Linux, running `docker compose up -d` or `docker pull` may fail with:
```text
Error response from daemon: no matching manifest for linux/arm64/v8 in the manifest list entries: no match for platform in manifest: not found
```

### Root Cause:
Apple Silicon Macs run on the **ARM64** architecture (`linux/arm64/v8`). If an image on Docker Hub was built exclusively for **x86_64** (`linux/amd64`), Docker cannot find a matching ARM64 manifest.

### Solutions:

#### Solution 1: Explicitly Set `platform: linux/amd64` in `docker-compose.yml` (Recommended)
Docker Desktop on Mac includes built-in Rosetta 2 emulation. Specifying the platform allows Docker on Mac to run the AMD64 image seamlessly:
```yaml
services:
  vistabridge:
    platform: linux/amd64
    image: rottengrapesprivatelimited/vistabridge:latest
    ...
```

#### Solution 2: Use `--platform linux/amd64` in Docker CLI
```bash
docker run -d --platform linux/amd64 -p 3007:3007 rottengrapesprivatelimited/vistabridge:latest
```
Or export the default platform in your terminal before running compose:
```bash
export DOCKER_DEFAULT_PLATFORM=linux/amd64
docker compose up -d
```

#### Solution 3: Native Local Build (If Repository is Cloned)
Compile natively for Apple Silicon ARM64 without pulling pre-built x86 images:
```bash
docker compose up -d --build
```

#### Permanent CI/CD Fix: Multi-Platform Docker Builds
The GitHub Actions workflow (`.github/workflows/docker-build-push.yml`) is configured with:
```yaml
platforms: linux/amd64,linux/arm64
```
This automatically produces multi-architecture images supporting both Intel/AMD servers and Apple Silicon / ARM64 environments natively.
