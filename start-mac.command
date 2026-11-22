#!/bin/bash
cd "$(dirname "$0")"
echo "[1/2] checking packages... (first run takes a while)"
npm install
echo "[2/2] starting..."
npm run dev
