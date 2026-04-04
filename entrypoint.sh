#!/bin/sh
set -e
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
