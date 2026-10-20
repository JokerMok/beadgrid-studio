#!/bin/bash
# Run on tencent-main only AFTER DNS, ICP access and cloud firewall are verified.
set -euo pipefail
app=/srv/apps/beadgrid-studio
candidate="$app/deploy/beadgrid-studio.public.caddy"
[[ -f "$candidate" ]]
python3 - <<'PY'
import socket
ips={r[4][0] for r in socket.getaddrinfo('pindou.shizibandu.icu',443,socket.AF_INET)}
assert ips=={'175.178.236.56'}, f'Unexpected DNS: {ips}'
PY
exec 9>"$app/.deploy.lock"
flock -n 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$app/shared/config/domain-$stamp"
sudo install -d -m 0700 "$backup"
sudo cp -p /etc/caddy/sites-enabled/beadgrid-studio.caddy "$backup/site.caddy"
sudo cp -p "$app/shared/config/app.env" "$backup/app.env"
sudo /etc/server-ops/backup.d/beadgrid-studio.sh "$backup/business"
rollback() {
  code=$?; trap - ERR
  sudo cp -p "$backup/app.env" "$app/shared/config/app.env"
  sudo systemctl restart beadgrid-studio
  sudo caddy-site-install beadgrid-studio "$backup/site.caddy"
  echo "Domain activation failed; previous site/env restored. Backup: $backup" >&2
  exit "$code"
}
trap rollback ERR
sudo ufw allow in proto tcp from 0.0.0.0/0 to any port 80 comment 'Public websites HTTP'
sudo ufw allow in proto tcp from 0.0.0.0/0 to any port 443 comment 'Public websites HTTPS'
sudo python3 - "$app/shared/config/app.env" <<'PY'
import pathlib, sys
p=pathlib.Path(sys.argv[1]); s=p.read_text().splitlines()
s=[v for v in s if not v.startswith('COOKIE_SECURE=')]
p.write_text('\n'.join(s+['COOKIE_SECURE=1'])+'\n')
PY
sudo systemctl restart beadgrid-studio
sudo caddy-site-install beadgrid-studio "$candidate"
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 3 https://pindou.shizibandu.icu/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == 1 ]]
trap - ERR
echo "HTTPS active: https://pindou.shizibandu.icu/; backup=$backup"
