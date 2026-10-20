#!/bin/bash
# Invoked by deploy.sh, only on tencent-main. Does not fetch source or alter data.
set -euo pipefail
[[ $# == 4 ]] || exit 2
release=$1; sha=$2; version=$3; reviewed=$4
[[ "$release" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ && "$sha" =~ ^[a-f0-9]{40}$ && "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || exit 2
app=/srv/apps/beadgrid-studio
incoming="$app/incoming/$release"
target="$app/releases/$release"
node="$app/runtime/node-v24.22.0-linux-x64/bin"
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another beadgrid deployment is running' >&2; exit 1; }
[[ ! -e "$target" && -d "$incoming" ]] || exit 1
old=$(readlink -f "$app/current" || true)
if [[ -n "$old" && -d "$old" ]]; then
  curl --fail --silent --max-time 5 http://127.0.0.1:18081/api/health >/dev/null
  if ! cmp -s "$old/server/index.mjs" "$incoming/server/index.mjs" && [[ "$reviewed" != 1 ]]; then
    echo 'Backend changed: review database compatibility/migrations before setting DB_CHANGE_REVIEWED=1. Nothing activated.' >&2
    exit 1
  fi
fi
export PATH="$node:$PATH"
cd "$incoming"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
[[ -f dist/index.html && -f server/index.mjs ]]
mv "$incoming" "$target"

# Keep secrets and SQLite outside releases. Never replace an existing env file.
sudo id beadgrid >/dev/null 2>&1 || sudo useradd --system --home-dir "$app" --shell /usr/sbin/nologin beadgrid
sudo install -d -o beadgrid -g beadgrid -m 0700 "$app/shared" "$app/shared/data" "$app/shared/uploads"
sudo install -d -o root -g root -m 0700 "$app/shared/config" "$app/shared/config/rollbacks"
if ! sudo test -e "$app/shared/config/app.env"; then
  sudo install -o root -g root -m 0600 /dev/null "$app/shared/config/app.env"
  printf '%s\n' 'NODE_ENV=production' 'HOST=127.0.0.1' 'PORT=18871' "DATA_DIR=$app/shared/data" 'COOKIE_SECURE=1' 'ALLOWED_ORIGINS=' 'TRUSTED_PROXIES=127.0.0.1/32' 'CLIENT_IP_HEADER=x-forwarded-for' | sudo tee "$app/shared/config/app.env" >/dev/null
fi
snapshot="$app/shared/config/rollbacks/$release"
sudo install -d -m 0700 "$snapshot"
sudo cp -p "$app/shared/config/app.env" "$snapshot/app.env"
if sudo test -f /etc/systemd/system/beadgrid-studio.service; then sudo cp -p /etc/systemd/system/beadgrid-studio.service "$snapshot/service"; fi
if sudo test -f /etc/caddy/sites-enabled/beadgrid-studio.caddy; then sudo cp -p /etc/caddy/sites-enabled/beadgrid-studio.caddy "$snapshot/site.caddy"; fi
if sudo test -f "$app/shared/data/studio.sqlite"; then
  sudo bash "$target/ops/backup.sh" "$snapshot/business"
fi
activated=0
rollback() {
  code=$?
  trap - ERR
  if (( activated )); then
    if [[ -n "$old" && -d "$old" ]]; then
      ln -s "$old" "$app/.rollback-current"; mv -Tf "$app/.rollback-current" "$app/current"
      if sudo test -f "$snapshot/service"; then sudo install -m 0644 "$snapshot/service" /etc/systemd/system/beadgrid-studio.service; fi
      sudo systemctl daemon-reload
      sudo systemctl restart beadgrid-studio
      if sudo test -f "$snapshot/site.caddy"; then sudo caddy-site-install beadgrid-studio "$snapshot/site.caddy"; fi
      curl --fail --silent --max-time 10 http://127.0.0.1:18081/api/health || true
      echo "Deployment failed; restored code/service to $old. Database NOT rewound."
    else
      sudo systemctl disable --now beadgrid-studio || true
      if [[ -L "$app/current" && "$(readlink -f "$app/current")" == "$target" ]]; then rm "$app/current"; fi
      if ! sudo test -f "$snapshot/site.caddy"; then
        sudo rm -f /etc/caddy/sites-enabled/beadgrid-studio.caddy
        sudo systemctl reload caddy
      fi
      echo 'First deployment failed; candidate service stopped. Files/data retained for diagnosis.'
    fi
  fi
  exit "$code"
}
trap rollback ERR
sudo install -m 0644 "$target/ops/beadgrid-studio.service" /etc/systemd/system/beadgrid-studio.service
sudo systemctl daemon-reload
ln -s "$target" "$app/.next-current"; mv -Tf "$app/.next-current" "$app/current"
activated=1
sudo systemctl enable beadgrid-studio
sudo systemctl restart beadgrid-studio
healthy=0
for attempt in $(seq 1 20); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:18871/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
sudo caddy-site-install beadgrid-studio "$target/ops/beadgrid-studio.caddy"
python3 - "$sha" <<'PY'
import json, sys, urllib.request
base='http://127.0.0.1:18081'
assert json.load(urllib.request.urlopen(base+'/api/health'))['ok']
assert json.load(urllib.request.urlopen('https://pindou.shizibandu.icu/api/health'))['ok']
assert json.load(urllib.request.urlopen(base+'/deployment.json'))['commit']==sys.argv[1]
assert b'<div id="root">' in urllib.request.urlopen(base+'/').read()
assert b'<div id="root">' in urllib.request.urlopen(base+'/refresh-check').read()
PY
sudo install -o root -g root -m 0750 "$target/ops/backup.sh" /etc/server-ops/backup.d/beadgrid-studio.sh
if [[ -n "$old" && -d "$old" ]]; then
  ln -s "$old" "$app/.next-previous"; mv -Tf "$app/.next-previous" "$app/previous"
fi
trap - ERR
printf 'ACTIVE %s %s version=%s\n' "$release" "$sha" "$version"
