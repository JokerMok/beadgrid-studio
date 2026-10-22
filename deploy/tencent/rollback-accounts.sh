#!/bin/bash
# Explicit code + data rollback of the one-time legacy-account reset. Run ON SERVER as root.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ ]] || exit 2
app=/srv/apps/beadgrid-studio
snapshot="$app/shared/config/rollbacks/$1"
[[ -d "$snapshot/legacy-data" && -f "$snapshot/old-release" && -f "$snapshot/app.env" ]] || { echo 'No matching account-reset backup'; exit 1; }
old=$(cat "$snapshot/old-release")
[[ "$old" == "$app/releases/"* && -f "$old/dist/index.html" ]] || exit 1
exec 9>"$app/.deploy.lock";flock -n 9
sudo systemctl stop beadgrid-studio
stamp=$(date -u +%Y%m%dT%H%M%SZ)
[[ ! -e "$snapshot/accounts-data-$stamp" ]]
mv "$app/shared/data" "$snapshot/accounts-data-$stamp"
# Preserve the original snapshot, restore an isolated copy with original owners/modes.
cp -a "$snapshot/legacy-data" "$app/shared/data"
if [[ -d "$snapshot/legacy-uploads" ]]; then mv "$app/shared/uploads" "$snapshot/accounts-uploads-$stamp";cp -a "$snapshot/legacy-uploads" "$app/shared/uploads";fi
install -m 0600 "$snapshot/app.env" "$app/shared/config/app.env"
install -m 0644 "$snapshot/service" /etc/systemd/system/beadgrid-studio.service
ln -s "$old" "$app/.accounts-rollback";mv -Tf "$app/.accounts-rollback" "$app/current"
systemctl daemon-reload
systemctl restart beadgrid-studio
caddy-site-install beadgrid-studio "$snapshot/site.caddy"
echo 'Restored legacy code, data snapshot and product environment. Public account-center users/config were not reverted.'
