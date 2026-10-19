#!/bin/zsh
set -e
cd "${0:A:h}"
if [ ! -d node_modules ]; then npm ci; fi
npm run build
PORT="${PORT:-4173}" npm start
