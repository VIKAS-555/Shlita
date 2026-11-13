#!/bin/sh
set -eu
mkdir -p /var/lib/shlita/backups
if [ -d /var/backups/shlita-external ]; then
  chown -R shlita:shlita /var/backups/shlita-external
fi
if [ "$(id -u)" = "0" ]; then
  chown -R shlita:shlita /var/lib/shlita
  exec runuser -u shlita -- "$@"
fi
exec "$@"
