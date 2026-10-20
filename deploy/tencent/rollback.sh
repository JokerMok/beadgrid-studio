#!/bin/bash
# Code-only rollback. Database migrations/restores require a separate decision.
set -euo pipefail
ssh -o BatchMode=yes tencent-main 'bash -s' <<'SH'
set -euo pipefail
app=/srv/apps/beadgrid-studio
exec 9>"$app/.deploy.lock"
flock -n 9
current=$(readlink -f "$app/current")
previous=$(readlink -f "$app/previous" || true)
[[ -n "$previous" && -d "$previous/dist" && "$previous" != "$current" ]] || { echo 'No previous verified release available (first deployment).'; exit 1; }
cmp -s "$current/server/index.mjs" "$previous/server/index.mjs" || { echo 'Backend differs; review migration/data compatibility before manual rollback.'; exit 1; }
ln -s "$previous" "$app/.rollback-current"
mv -Tf "$app/.rollback-current" "$app/current"
sudo systemctl restart beadgrid-studio
healthy=0
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:18081/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  ln -s "$current" "$app/.rollback-current"; mv -Tf "$app/.rollback-current" "$app/current"
  sudo systemctl restart beadgrid-studio
  echo 'Rollback target failed; restored original code. Database unchanged.'; exit 1
fi
ln -s "$current" "$app/.rollback-previous"; mv -Tf "$app/.rollback-previous" "$app/previous"
echo "Rolled back code to $previous; database unchanged. Update SERVER.md and PROJECT.md to this version."
SH
