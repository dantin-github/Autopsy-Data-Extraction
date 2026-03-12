#!/bin/bash
# start-all.sh - Start FISCO chain + WeBASE after every reboot
# Run in WSL: bash start-all.sh

set -e

echo "=============================="
echo " Blockchain + WeBASE Startup"
echo "=============================="

# ── JAVA_HOME ────────────────────────────────────────────────
if [ -d /usr/lib/jvm/java-11-openjdk-amd64 ]; then
    export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
elif [ -d /usr/lib/jvm/java-11-openjdk-arm64 ]; then
    export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-arm64
else
    export JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(which java)")")")
fi
echo "  JAVA_HOME=$JAVA_HOME"

# ── 1. MySQL (Docker) ────────────────────────────────────────
echo ""
echo "[1/4] Starting MySQL container..."
DOCKER_CMD="docker"
docker info &>/dev/null || DOCKER_CMD="sudo docker"

$DOCKER_CMD start webase-mysql 2>/dev/null && echo "  [OK] webase-mysql started" \
    || echo "  [WARN] Could not start webase-mysql - is Docker running?"

echo "  Waiting 20s for MySQL to be ready..."
sleep 20

# ── 2. FISCO nodes ──────────────────────────────────────────
# Must start BEFORE WeBASE-Front, which connects to channel port 20200 on startup
echo ""
echo "[2/4] Starting FISCO nodes..."
cd ~/fisco && bash nodes/127.0.0.1/start_all.sh
sleep 5

if pgrep -f fisco-bcos >/dev/null; then
    echo "  [OK] FISCO nodes running"
else
    echo "  [WARN] No fisco-bcos processes found"
fi

# Wait for channel port 20200 to be ready
echo "  Waiting for channel port 20200 (10s)..."
sleep 10
if ss -tlnp | grep -q 20200; then
    echo "  [OK] Port 20200 is listening"
else
    echo "  [WARN] Port 20200 not yet ready - waiting another 10s..."
    sleep 10
fi

# ── 3. WeBASE services ───────────────────────────────────────
echo ""
echo "[3/4] Starting WeBASE services..."
cd ~/webase-deploy

# Stop only WeBASE Java processes + nginx (NOT fisco-bcos)
echo "  Stopping any existing WeBASE processes..."
pkill -f "com.webank.webase" 2>/dev/null || true
sudo pkill -f "nginx" 2>/dev/null || true
sleep 3

# Force-free WeBASE ports if still occupied
for PORT in 5000 5001 5002 5004; do
    PID=$(lsof -t -i:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "  Force-killing process on port $PORT (PID $PID)..."
        kill -9 $PID 2>/dev/null || sudo kill -9 $PID 2>/dev/null || true
    fi
done
sleep 3

echo "  Starting all WeBASE services..."
python3 deploy.py startAll

# ── 4. Verify ────────────────────────────────────────────────
echo ""
echo "[4/4] Waiting for WeBASE-Front to initialize (30s)..."
sleep 30

echo ""
echo "=============================="
echo " Verification"
echo "=============================="

BN=$(curl -s --max-time 5 http://127.0.0.1:5002/WeBASE-Front/1/blockNumber 2>/dev/null)
if [ -n "$BN" ] && [ "$BN" -ge 0 ] 2>/dev/null; then
    echo "  [OK] WeBASE-Front reachable  (blockNumber=$BN)"
else
    echo "  [WARN] WeBASE-Front not responding on :5002"
    echo "         Check log: tail -30 ~/webase-deploy/webase-front/log/WeBASE-Front.log"
fi

HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:5000 2>/dev/null)
if [ "$HTTP" = "200" ] || [ "$HTTP" = "301" ] || [ "$HTTP" = "302" ]; then
    echo "  [OK] WeBASE-Web reachable    (http://localhost:5000)"
else
    echo "  [WARN] WeBASE-Web not responding on :5000 (HTTP $HTTP)"
fi

echo ""
echo "Open in browser: http://localhost:5000"
echo "Login: admin / Abcd1234"
echo ""
