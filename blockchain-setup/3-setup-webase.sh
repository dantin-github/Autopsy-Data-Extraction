#!/bin/bash
# WeBASE - Step 3: Deploy WeBASE management platform (uses existing FISCO chain)
# Prerequisites: FISCO chain already running at ~/fisco (from 2-setup-fisco.sh)
# Run in WSL: bash 3-setup-webase.sh

set -e

echo "=== WeBASE management platform setup ==="

# Check existing chain
FISCO_DIR="$HOME/fisco/nodes/127.0.0.1"
if [ ! -d "$FISCO_DIR/sdk" ]; then
    echo "Error: FISCO chain not found at $FISCO_DIR"
    echo "Run 2-setup-fisco.sh first, then start nodes: cd ~/fisco && bash nodes/127.0.0.1/start_all.sh"
    exit 1
fi
echo "[OK] Found existing chain at $FISCO_DIR"

# 1. Install dependencies
echo "[1/7] Installing dependencies..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip unzip wget nginx dos2unix openjdk-11-jdk

# PyMySQL for Python3
python3 -c "import pymysql" 2>/dev/null || sudo pip3 install PyMySQL

# JAVA_HOME (required by WeBASE)
if [ -z "$JAVA_HOME" ]; then
    if [ -d /usr/lib/jvm/java-11-openjdk-amd64 ]; then
        export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
    elif [ -d /usr/lib/jvm/java-11-openjdk-arm64 ]; then
        export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-arm64
    else
        export JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(which java 2>/dev/null)" 2>/dev/null)" 2>/dev/null)" 2>/dev/null)
    fi
    [ -n "$JAVA_HOME" ] && echo "Set JAVA_HOME=$JAVA_HOME"
fi
if [ -z "$JAVA_HOME" ] || [ ! -d "$JAVA_HOME" ]; then
    echo "Error: JAVA_HOME not found. Install: sudo apt-get install openjdk-11-jdk"
    exit 1
fi

# Docker (for MySQL in WeBASE)
if ! command -v docker &>/dev/null; then
    echo "Installing Docker..."
    sudo apt-get install -y docker.io
    sudo systemctl start docker 2>/dev/null || true
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    echo "Note: If Docker was just installed, you may need to log out and back in for docker group."
    echo "      Or run: newgrp docker"
fi

# 2. Download WeBASE deploy
echo "[2/7] Downloading WeBASE deploy..."
WEBASE_DIR="$HOME/webase-deploy"
mkdir -p "$(dirname "$WEBASE_DIR")"
cd "$(dirname "$WEBASE_DIR")"

if [ ! -f webase-deploy.zip ]; then
    wget -q --show-progress https://osp-1257653870.cos.ap-guangzhou.myqcloud.com/WeBASE/releases/download/v1.5.5/webase-deploy.zip \
        || wget -q --show-progress https://github.com/WeBankBlockchain/WeBASELargeFiles/releases/download/v1.5.5/webase-deploy.zip
fi

if [ ! -d webase-deploy ]; then
    unzip -o webase-deploy.zip
fi
cd webase-deploy

# 3. Configure for existing chain
echo "[3/7] Configuring common.properties..."
CONF="common.properties"

# Use Docker for MySQL (no host MySQL needed)
sed -i 's/^docker\.mysql=.*/docker.mysql=1/' "$CONF" 2>/dev/null || true
sed -i 's/^docker\.mysql\.port=.*/docker.mysql.port=23306/' "$CONF" 2>/dev/null || true
sed -i 's/^docker\.mysql\.password=.*/docker.mysql.password=123456/' "$CONF" 2>/dev/null || true
# Point Mgr/Sign to Docker MySQL port and credentials
sed -i 's/^mysql\.port=.*/mysql.port=23306/' "$CONF" 2>/dev/null || true
sed -i 's/^mysql\.user=.*/mysql.user=root/' "$CONF" 2>/dev/null || true
sed -i 's/^mysql\.password=.*/mysql.password=123456/' "$CONF" 2>/dev/null || true
sed -i 's/^sign\.mysql\.port=.*/sign.mysql.port=23306/' "$CONF" 2>/dev/null || true
sed -i 's/^sign\.mysql\.user=.*/sign.mysql.user=root/' "$CONF" 2>/dev/null || true
sed -i 's/^sign\.mysql\.password=.*/sign.mysql.password=123456/' "$CONF" 2>/dev/null || true

# Use existing FISCO chain
sed -i 's/^if\.exist\.fisco=.*/if.exist.fisco=yes/' "$CONF" 2>/dev/null || true
sed -i "s|^fisco\.dir=.*|fisco.dir=$FISCO_DIR|" "$CONF" 2>/dev/null || true
sed -i 's/^node\.dir=.*/node.dir=node0/' "$CONF" 2>/dev/null || true

# 4. Start MySQL in Docker (deploy checks DB before starting services)
echo "[4/7] Starting MySQL container..."
DOCKER_CMD="docker"
docker info &>/dev/null || DOCKER_CMD="sudo docker"
if ! $DOCKER_CMD ps -a --format '{{.Names}}' 2>/dev/null | grep -q webase-mysql; then
    $DOCKER_CMD run -d --name webase-mysql -p 23306:3306 -e MYSQL_ROOT_PASSWORD=123456 mysql:5.6
    echo "Waiting for MySQL to be ready (30s)..."
    sleep 30
elif ! $DOCKER_CMD ps --format '{{.Names}}' 2>/dev/null | grep -q webase-mysql; then
    $DOCKER_CMD start webase-mysql
    sleep 10
fi

# 5. Ensure FISCO nodes are running
echo "[5/7] Checking FISCO nodes..."
if ! pgrep -f fisco-bcos >/dev/null; then
    echo "Starting FISCO nodes..."
    cd "$HOME/fisco" && bash nodes/127.0.0.1/start_all.sh
    sleep 5
    cd "$HOME/webase-deploy"
fi

# 6. Deploy WeBASE
echo "[6/7] Deploying WeBASE (this may take several minutes)..."
echo "Do NOT use sudo. Running as current user."
python3 deploy.py installAll

# 7. Done
echo "[7/7] Done"
echo ""
echo "=== WeBASE setup complete ==="
echo ""
echo "Access WeBASE Web: http://localhost:5000"
echo "  Default login: admin / Abcd1234"
echo ""
echo "Ports: Web 5000, Node-Mgr 5001, Front 5002, Sign 5004"
echo ""
echo "Commands (from ~/webase-deploy):"
echo "  Stop all:  python3 deploy.py stopAll"
echo "  Start all: python3 deploy.py startAll"
echo ""
