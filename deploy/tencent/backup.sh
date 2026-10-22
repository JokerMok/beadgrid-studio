#!/bin/bash
set -euo pipefail
[[ $# == 1 ]] || exit 2
umask 077
out="$1/beadgrid-studio"
mkdir -p "$out"
python3 - "$out" <<'PY'
import pathlib, sqlite3, sys
out = pathlib.Path(sys.argv[1])
source = pathlib.Path('/srv/apps/beadgrid-studio/shared/data/studio.sqlite')
if not source.exists():
    raise SystemExit('Database missing; backup aborted')
with sqlite3.connect(f'file:{source}?mode=ro', uri=True, timeout=30) as src:
    with sqlite3.connect(out / 'studio.sqlite') as dst:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite backup integrity check failed')
(out / 'README.txt').write_text('SQLite online backup; project images are stored inside works.data. OIDC v1.7 artifacts in exports/ and any product uploads are copied separately.\n')
PY

# Private files/artifacts may contain user work. Keep them within the private backup target.
if [[ -d /srv/apps/beadgrid-studio/shared/data/exports ]]; then cp -a /srv/apps/beadgrid-studio/shared/data/exports "$out/exports"; fi
if [[ -d /srv/apps/beadgrid-studio/shared/uploads ]]; then cp -a /srv/apps/beadgrid-studio/shared/uploads "$out/uploads"; fi
