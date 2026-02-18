#!/bin/bash
# ============================================================================
# vps-setup.sh — Run this ON THE VPS to set up everything
#
# Usage: ssh root@91.250.249.45, then paste this script or run it
# ============================================================================

set -e  # Exit on any error

echo "=========================================="
echo "  Tactical Commander — VPS Setup"
echo "=========================================="

# --- 1. System update ---
echo "[1/6] Updating system..."
apt update -y && apt upgrade -y

# --- 2. Install Node.js 20 (if not already installed) ---
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
    echo "[2/6] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    echo "[2/6] Node.js $(node -v) already installed, skipping"
fi

# --- 3. Install git and tmux (if not already installed) ---
echo "[3/6] Installing git and tmux..."
apt install -y git tmux

# --- 4. Install Claude Code globally ---
echo "[4/6] Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# --- 5. Verify installations ---
echo "[5/6] Verifying installations..."
echo "  Node.js: $(node -v)"
echo "  npm: $(npm -v)"
echo "  git: $(git --version)"
echo "  tmux: $(tmux -V)"
echo "  claude: $(which claude)"

# --- 6. Configure git ---
echo "[6/6] Configuring git..."
git config --global user.name "VPS Claude Worker"
git config --global user.email "claude-worker@vps"

echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
echo "NEXT STEPS:"
echo "  1. Run: claude"
echo "     This will give you a login URL — open it in your browser"
echo "     to authenticate with your Anthropic account."
echo ""
echo "  2. Clone your repo:"
echo "     git clone https://github.com/YOUR_USERNAME/1v1-strat-game.git /root/1v1-strat-game"
echo ""
echo "  3. Copy run-claude.sh to ~/ (it's in the repo at prompts/run-claude.sh)"
echo "     cp /root/1v1-strat-game/prompts/run-claude.sh ~/run-claude.sh"
echo "     chmod +x ~/run-claude.sh"
echo ""
echo "  4. Start the worker in tmux:"
echo "     tmux new-session -d -s claude-worker 'bash ~/run-claude.sh'"
echo ""
echo "  5. To watch it work:"
echo "     tmux attach -t claude-worker"
echo "     (Press Ctrl+B then D to detach without stopping it)"
echo ""
