#!/bin/sh
# `set -e` stops a failed migration from starting a server against a schema it
# does not match. `exec` hands PID 1 to node so Kubernetes rolling updates
# terminate cleanly rather than waiting out the grace period.
set -eu

echo "[boot] applying migrations"
./node_modules/.bin/prisma migrate deploy

echo "[boot] starting server"
exec node server.js
