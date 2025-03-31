#!/bin/bash

# Install Node.js and npm
echo "Installing Node.js and npm..."
sudo apt install -y nodejs npm

# Verify Node.js and npm installation
echo "Verifying Node.js and npm installation..."
node -v
npm -v

# Install uv
echo "Installing uv..."
curl -LsSf https://astral.sh/uv/install.sh | sh

# Source bashrc to apply changes
echo "Sourcing ~/.bashrc to apply changes..."
source ~/.bashrc

# Final confirmation
echo "✅ All tasks completed successfully!"