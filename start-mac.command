#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "[first run] installing... please wait"
  npm install
fi
npm run dev
