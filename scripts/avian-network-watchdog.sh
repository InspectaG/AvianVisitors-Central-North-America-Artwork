#!/usr/bin/env bash
set -u

# BirdNET-Pi network recovery watchdog. The timer runs independently of the
# network so it can recover a disconnected wlan0 interface.
STATE_FILE=/run/avian-network-watchdog.failures
EXPECTED_IP=${AVIAN_WATCHDOG_IP:-192.168.50.5}
EXPECTED_IFACE=${AVIAN_WATCHDOG_IFACE:-wlan0}
MAX_RESTART_FAILURES=3
MAX_REBOOT_FAILURES=6

log() {
  logger -t avian-network-watchdog -- "$*"
}

failures=0
if [[ -r "$STATE_FILE" ]]; then
  read -r failures < "$STATE_FILE" || failures=0
fi
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0

iface_ip="$(ip -4 -o addr show dev "$EXPECTED_IFACE" scope global 2>/dev/null | awk 'NR==1{print $4}' | cut -d/ -f1)"
gateway="$(ip route show default dev "$EXPECTED_IFACE" 2>/dev/null | awk 'NR==1{print $3}')"

if [[ "$iface_ip" == "$EXPECTED_IP" && -n "$gateway" ]] && ping -c 1 -W 2 "$gateway" >/dev/null 2>&1; then
  if (( failures > 0 )); then log "network recovered after $failures failed check(s)"; fi
  rm -f "$STATE_FILE"
  exit 0
fi

failures=$((failures + 1))
printf '%s\n' "$failures" > "$STATE_FILE"
log "network check failed ($failures/$MAX_REBOOT_FAILURES): iface=$EXPECTED_IFACE ip=${iface_ip:-none} gateway=${gateway:-none}"

if (( failures == MAX_RESTART_FAILURES )); then
  if systemctl is-active --quiet NetworkManager 2>/dev/null; then
    log "restarting NetworkManager after $failures failed checks"
    systemctl restart NetworkManager || true
  elif systemctl is-active --quiet dhcpcd 2>/dev/null; then
    log "restarting dhcpcd after $failures failed checks"
    systemctl restart dhcpcd || true
  elif systemctl is-active --quiet systemd-networkd 2>/dev/null; then
    log "restarting systemd-networkd after $failures failed checks"
    systemctl restart systemd-networkd || true
  else
    log "no supported network manager is active; waiting before reboot"
  fi
fi

if (( failures >= MAX_REBOOT_FAILURES )); then
  log "network still unavailable after $failures failed checks; rebooting"
  rm -f "$STATE_FILE"
  systemctl reboot
fi
