#!/bin/bash
# stop-all.sh - Stop all blockchain and WeBASE services
# Run in WSL: bash stop-all.sh

echo "=============================="
echo " Blockchain + WeBASE Shutdown"
echo "=============================="

# ── 1. WeBASE Java 进程 ──────────────────────────────────────
echo ""
echo "[1/3] Stopping WeBASE services..."
pkill -f "com.webank.webase" 2>/dev/null && echo "  [OK] WeBASE Java processes stopped" \
    || echo "  [--] No WeBASE Java processes found"

sudo pkill -f "nginx" 2>/dev/null && echo "  [OK] nginx stopped" \
    || echo "  [--] nginx not running"

sleep 3

# 确认端口已释放
for PORT in 5000 5001 5002 5004; do
    PID=$(lsof -t -i:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "  Force-killing remaining process on port $PORT (PID $PID)..."
        kill -9 $PID 2>/dev/null || sudo kill -9 $PID 2>/dev/null || true
    fi
done

# ── 2. FISCO 节点 ─────────────────────────────────────────────
echo ""
echo "[2/3] Stopping FISCO nodes..."
if [ -d ~/fisco/nodes/127.0.0.1 ]; then
    cd ~/fisco && bash nodes/127.0.0.1/stop_all.sh
else
    echo "  [--] FISCO nodes directory not found"
fi

# ── 3. MySQL (Docker) ────────────────────────────────────────
echo ""
echo "[3/3] Stopping MySQL container..."
DOCKER_CMD="docker"
docker info &>/dev/null || DOCKER_CMD="sudo docker"
$DOCKER_CMD stop webase-mysql 2>/dev/null && echo "  [OK] webase-mysql stopped" \
    || echo "  [--] webase-mysql not running"

# ── 验证 ─────────────────────────────────────────────────────
echo ""
echo "=============================="
echo " Verification"
echo "=============================="

pgrep -f "com.webank.webase" >/dev/null \
    && echo "  [WARN] WeBASE Java processes still running" \
    || echo "  [OK] WeBASE stopped"

pgrep -f fisco-bcos >/dev/null \
    && echo "  [WARN] FISCO nodes still running" \
    || echo "  [OK] FISCO nodes stopped"

docker ps --format '{{.Names}}' 2>/dev/null | grep -q webase-mysql \
    && echo "  [WARN] webase-mysql still running" \
    || echo "  [OK] MySQL stopped"

echo ""
echo "All services stopped."
echo ""
