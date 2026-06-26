#!/bin/bash
# ============================================================
# Revluma — Remote MLflow Server Setup Script
# ============================================================
# Run this on a VPS (Ubuntu) to spin up a remote MLflow server
# the whole team can log to.
#
# Usage:
#   chmod +x scripts/setup_mlflow_server.sh
#   ./scripts/setup_mlflow_server.sh
#
# After running, your MLflow server will be at:
#   http://YOUR_SERVER_IP:5000
#
# Then add this to your .env:
#   MLFLOW_REMOTE_URL=http://YOUR_SERVER_IP:5000
# ============================================================

echo "Installing MLflow..."
pip install mlflow --quiet

echo "Starting MLflow server..."
echo "Press Ctrl+C to stop."
echo ""
echo "Once running, open: http://$(hostname -I | awk '{print $1}'):5000"
echo "Add this to your .env: MLFLOW_REMOTE_URL=http://$(hostname -I | awk '{print $1}'):5000"
echo ""

# Start the server
# --host 0.0.0.0  = accessible from outside (not just localhost)
# --port 5000     = standard MLflow port
# --backend-store-uri = where experiment metadata is stored
# --default-artifact-root = where model files are stored
mlflow server \
    --host 0.0.0.0 \
    --port 5000 \
    --backend-store-uri sqlite:///mlflow.db \
    --default-artifact-root ./mlartifacts
