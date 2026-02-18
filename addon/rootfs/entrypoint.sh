#!/usr/bin/with-contenv bash
set -euo pipefail

export NODE_ENV=production

if [[ -f /data/options.json ]]; then
  export ADDON_OPTIONS_FILE=/data/options.json
fi

exec node /app/src/server.js
