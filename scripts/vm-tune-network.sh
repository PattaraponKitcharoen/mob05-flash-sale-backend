#!/usr/bin/env bash
# Run on the VM host (not inside a container) before load-testing from an
# external client. Fixes the two host-level bottlenecks that clamp or relay
# an incoming burst of connections before nginx's own backlog=8192 applies:
#
#   1. Docker's userland-proxy: a userspace relay process per published port
#      that does not scale under a simultaneous-connection burst. Disabling
#      it makes Docker use iptables DNAT (kernel-level) for port publishing.
#   2. net.core.somaxconn / net.ipv4.tcp_max_syn_backlog: the kernel clamps
#      any listen() backlog to these values, so a low default (128-4096 on
#      many distros) silently drops SYNs before nginx ever sees them.
#
# Must run with sudo. Restarts the docker daemon (and therefore all
# containers) as part of applying the userland-proxy change.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo $0)" >&2
  exit 1
fi

echo "== raising kernel backlog limits =="
sysctl -w net.core.somaxconn=8192
sysctl -w net.ipv4.tcp_max_syn_backlog=8192

grep -q '^net.core.somaxconn' /etc/sysctl.conf 2>/dev/null \
  && sed -i 's/^net.core.somaxconn.*/net.core.somaxconn=8192/' /etc/sysctl.conf \
  || echo 'net.core.somaxconn=8192' >> /etc/sysctl.conf

grep -q '^net.ipv4.tcp_max_syn_backlog' /etc/sysctl.conf 2>/dev/null \
  && sed -i 's/^net.ipv4.tcp_max_syn_backlog.*/net.ipv4.tcp_max_syn_backlog=8192/' /etc/sysctl.conf \
  || echo 'net.ipv4.tcp_max_syn_backlog=8192' >> /etc/sysctl.conf

echo "== disabling docker userland-proxy =="
DAEMON_JSON=/etc/docker/daemon.json
mkdir -p /etc/docker
if [ -f "$DAEMON_JSON" ]; then
  cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%s)"
  if command -v jq >/dev/null 2>&1; then
    jq '. + {"userland-proxy": false}' "$DAEMON_JSON" > "${DAEMON_JSON}.tmp"
    mv "${DAEMON_JSON}.tmp" "$DAEMON_JSON"
  else
    echo "jq not found - $DAEMON_JSON already exists, edit it by hand:" >&2
    echo '  add "userland-proxy": false' >&2
    exit 1
  fi
else
  echo '{ "userland-proxy": false }' > "$DAEMON_JSON"
fi

echo "== restarting docker (all containers will restart) =="
systemctl restart docker

echo "done. verify with: docker info --format '{{.SecurityOptions}}'"
echo "and: sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog"
