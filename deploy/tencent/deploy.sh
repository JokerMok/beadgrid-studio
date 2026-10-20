#!/bin/bash
# Build only an immutable Git commit, never the dirty working tree.
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
remote=$(git remote get-url origin)
case "$remote" in git@github.com:JokerMok/beadgrid-studio.git|https://github.com/JokerMok/beadgrid-studio.git) ;; *) echo "Unexpected repository: $remote" >&2; exit 1;; esac
ref=${1:-}
if [[ -z "$ref" ]]; then
  ref=$(git ls-remote --symref origin HEAD | awk '$1=="ref:" {print $2; exit}')
  [[ "$ref" == refs/heads/* ]]
fi
git fetch origin "$ref"
sha=$(git rev-parse FETCH_HEAD)
[[ "$sha" =~ ^[a-f0-9]{40}$ ]]
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="$stamp-${sha:0:12}"
work="$root/.local-public/tencent-deploy/$release"
mkdir -p "$work/source" "$work/bundle/ops"
git archive --format=tar "$sha" > "$work/source.tar"
tar -xf "$work/source.tar" -C "$work/source"
(
  cd "$work/source"
  npm ci --no-audit --no-fund
  npm run build
)
cp -R "$work/source/dist" "$work/bundle/dist"
cp -R "$work/source/server" "$work/bundle/server"
cp "$work/source/package.json" "$work/source/package-lock.json" "$work/bundle/"
cp deploy/tencent/{beadgrid-studio.service,beadgrid-studio.caddy,backup.sh,remote-release.sh} "$work/bundle/ops/"
version=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).version" "$work/source/package.json")
python3 - "$work" "$sha" "$version" "$remote" <<'PY'
import datetime, hashlib, json, pathlib, subprocess, sys
w=pathlib.Path(sys.argv[1])
d={'commit':sys.argv[2], 'version':sys.argv[3], 'repository':sys.argv[4], 'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceArchiveSha256':hashlib.sha256((w/'source.tar').read_bytes()).hexdigest(), 'builderNode':subprocess.check_output(['node','--version'],text=True).strip(), 'runtimeNode':'v24.22.0', 'uncommittedAppChangesIncluded':False}
(w/'bundle/dist/deployment.json').write_text(json.dumps(d,indent=2)+'\n')
(w/'bundle/RELEASE.json').write_text(json.dumps(d,indent=2)+'\n')
PY
runtime=node-v24.22.0-linux-x64
cache="$root/.local-public/tencent-deploy/$runtime.tar.xz"
if [[ ! -f "$cache" ]]; then
  part="$cache.$$.partial"
  curl --fail --location --connect-timeout 10 --max-time 180 "https://nodejs.org/dist/v24.22.0/$runtime.tar.xz" -o "$part"
  printf '%s  %s\n' cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008 "$part" | shasum -a 256 -c -
  mv "$part" "$cache"
fi
printf '%s  %s\n' cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008 "$cache" | shasum -a 256 -c -
ssh -o BatchMode=yes tencent-main 'mkdir -p /srv/apps/beadgrid-studio/{incoming,releases,runtime}; test -d /srv/apps/beadgrid-studio'
if ! ssh -o BatchMode=yes tencent-main "test -x /srv/apps/beadgrid-studio/runtime/$runtime/bin/node"; then
  scp "$cache" "tencent-main:/srv/apps/beadgrid-studio/runtime/$runtime.tar.xz"
  ssh -o BatchMode=yes tencent-main "cd /srv/apps/beadgrid-studio/runtime && echo 'cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008  $runtime.tar.xz' | sha256sum -c - && tar -xJf $runtime.tar.xz && ./$runtime/bin/node --version"
fi
tar -czf "$work/bundle.tar.gz" -C "$work/bundle" .
digest=$(shasum -a 256 "$work/bundle.tar.gz" | awk '{print $1}')
scp "$work/bundle.tar.gz" "tencent-main:/srv/apps/beadgrid-studio/incoming/$release.tar.gz"
ssh -o BatchMode=yes tencent-main "cd /srv/apps/beadgrid-studio/incoming && echo '$digest  $release.tar.gz' | sha256sum -c - && mkdir '$release' && tar -xzf '$release.tar.gz' -C '$release' && bash '$release/ops/remote-release.sh' '$release' '$sha' '$version' '${DB_CHANGE_REVIEWED:-0}'"
printf '%s\n' "$release" > "$root/.local-public/tencent-deploy/latest-release"
printf 'Deployed %s (%s). Access: https://pindou.shizibandu.icu/\n' "$sha" "$version"
