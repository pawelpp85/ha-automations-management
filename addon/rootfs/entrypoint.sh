#!/usr/bin/env bash
set -euo pipefail

# In Home Assistant add-on runtime, preserve with-contenv behavior.
# In local Docker runs (without s6 envdir), start directly.
if [[ "${1:-}" != "__inner" ]]; then
  if [[ -x /usr/bin/with-contenv && -d /run/s6/container_environment ]]; then
    exec /usr/bin/with-contenv bash "$0" __inner "$@"
  fi
fi

if [[ "${1:-}" == "__inner" ]]; then
  shift
fi

export NODE_ENV=production

if [[ -f /data/options.json ]]; then
  export ADDON_OPTIONS_FILE=/data/options.json
fi

exec node /app/src/server.js
