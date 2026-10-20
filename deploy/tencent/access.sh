#!/bin/bash
set -euo pipefail
base="$HOME/.ssh/beadgrid-studio-access"
mkdir -p "$base"
chmod 0700 "$base"
socket="$base/control"
case "${1:-start}" in
  start)
    if ! ssh -S "$socket" -O check tencent-main >/dev/null 2>&1; then
      ssh -M -S "$socket" -fNT -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18181:127.0.0.1:18081 tencent-main
    fi
    curl --fail --silent --max-time 10 http://127.0.0.1:18181/api/health
    printf '\nhttp://127.0.0.1:18181/\n'
    ;;
  status)
    ssh -S "$socket" -O check tencent-main
    ssh -o BatchMode=yes tencent-main 'systemctl is-active beadgrid-studio; readlink /srv/apps/beadgrid-studio/current; curl -fsS http://127.0.0.1:18081/deployment.json'
    ;;
  stop) ssh -S "$socket" -O exit tencent-main ;;
  *) echo 'Usage: bash deploy/tencent/access.sh start|status|stop' >&2; exit 2;;
esac
