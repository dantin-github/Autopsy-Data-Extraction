#!/bin/bash
# FISCO BCOS - Step 2: Build single-machine 4-node chain and console in WSL
# Run in WSL: bash 2-setup-fisco.sh
# Or from PowerShell: wsl bash ./2-setup-fisco.sh

set -e

echo "=== FISCO BCOS single-machine 4-node chain setup ==="

# 1. Install deps
echo "[1/6] Installing dependencies..."
sudo apt-get update
sudo apt-get install -y openssl curl openjdk-11-jdk

# 2. Download build_chain.sh
echo "[2/6] Downloading build_chain.sh..."
mkdir -p ~/fisco
cd ~/fisco
if [ ! -f build_chain.sh ]; then
    curl -#LO https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/v2.11.0/build_chain.sh || curl -#LO https://gitee.com/FISCO-BCOS/FISCO-BCOS/releases/download/v2.11.0/build_chain.sh
    chmod u+x build_chain.sh
fi

# 3. Build 4-node chain
echo "[3/6] Building chain (ports 30300,20200,8545)..."
bash build_chain.sh -l 127.0.0.1:4 -p 30300,20200,8545

# 4. Start nodes
echo "[4/6] Starting nodes..."
bash nodes/127.0.0.1/start_all.sh

sleep 3
echo "Checking node status..."
ps aux | grep -v grep | grep fisco-bcos || true

# 5. Download console
echo "[5/6] Downloading and configuring console..."
if [ ! -d console ]; then
    curl -LO https://github.com/FISCO-BCOS/console/releases/download/v2.9.2/download_console.sh || curl -LO https://gitee.com/FISCO-BCOS/console/releases/download/v2.9.2/download_console.sh
    bash download_console.sh
fi

cp -n console/conf/config-example.toml console/conf/config.toml 2>/dev/null || true
cp -r nodes/127.0.0.1/sdk/* console/conf/

# 6. Done
echo "[6/6] Done"
cd ~/fisco
echo ""
echo "=== Setup complete ==="
echo ""
echo "Chain running. Node dir: ~/fisco/nodes/127.0.0.1/"
echo "Console dir: ~/fisco/console/"
echo ""
echo "Commands:"
echo "  Start nodes: cd ~/fisco && bash nodes/127.0.0.1/start_all.sh"
echo "  Stop nodes:  cd ~/fisco && bash nodes/127.0.0.1/stop_all.sh"
echo "  Start console: cd ~/fisco/console && bash start.sh"
echo ""
echo "SDK certs for Java module: ~/fisco/nodes/127.0.0.1/sdk/"
echo "  Copy ca.crt, sdk.crt, sdk.key to blockchain/conf/"
echo ""
