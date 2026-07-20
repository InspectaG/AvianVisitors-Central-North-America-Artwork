#!/usr/bin/env bash
# Nightly whole-Pi backup to a mounted SD card or other fallback volume.
#
# Defaults assume the running system lives on the root filesystem and the
# backup target is mounted at /mnt/sdbackup with writable root and boot
# directories underneath it.
#
# Test hooks:
#   SYSTEM_BACKUP_SOURCE=/tmp/source
#   SYSTEM_BACKUP_TARGET=/tmp/target
#   SYSTEM_BACKUP_BOOT_SOURCE=/tmp/source/boot/firmware
#   SYSTEM_BACKUP_BOOT_TARGET=/tmp/target/boot/firmware
#   DRY_RUN=1

set -euo pipefail

SOURCE_ROOT="${SYSTEM_BACKUP_SOURCE:-/}"
TARGET_ROOT="${SYSTEM_BACKUP_TARGET:-/mnt/sdbackup}"
BOOT_SOURCE="${SYSTEM_BACKUP_BOOT_SOURCE:-}"
BOOT_TARGET="${SYSTEM_BACKUP_BOOT_TARGET:-}"
REQUIRE_MOUNT="${SYSTEM_BACKUP_REQUIRE_MOUNT:-1}"
LOG_PREFIX="[system-backup]"

if [ "${EUID}" -ne 0 ] && [ "${DRY_RUN:-0}" != "1" ]; then
  echo "${LOG_PREFIX} Please run as root." >&2
  exit 1
fi

if [ -f /etc/birdnet/birdnet.conf ]; then
  # shellcheck disable=SC1091
  source /etc/birdnet/birdnet.conf
fi

if [ -z "${BOOT_SOURCE}" ] && [ -d "${SOURCE_ROOT}/boot/firmware" ]; then
  BOOT_SOURCE="${SOURCE_ROOT}/boot/firmware"
fi
if [ -z "${BOOT_TARGET}" ] && [ -n "${BOOT_SOURCE}" ]; then
  BOOT_TARGET="${TARGET_ROOT}/boot/firmware"
fi

if [ ! -d "${TARGET_ROOT}" ]; then
  echo "${LOG_PREFIX} Backup target ${TARGET_ROOT} does not exist." >&2
  exit 1
fi

if [ "${REQUIRE_MOUNT}" != "0" ] && command -v findmnt >/dev/null 2>&1; then
  if ! findmnt -rno TARGET "${TARGET_ROOT}" >/dev/null 2>&1; then
    echo "${LOG_PREFIX} Backup target ${TARGET_ROOT} is not mounted." >&2
    exit 1
  fi
fi

if [ "${SOURCE_ROOT}" = "/" ]; then
  SOURCE_ARG="/"
  RSYNC_EXCLUDE_TARGET="${TARGET_ROOT%/}/"
else
  SOURCE_ARG="${SOURCE_ROOT%/}/"
  RSYNC_EXCLUDE_TARGET=""
fi

if [ "${TARGET_ROOT}" = "${SOURCE_ROOT}" ]; then
  echo "${LOG_PREFIX} Backup target cannot be the same as the source." >&2
  exit 1
fi

DRY_RUN_ARGS=()
if [ "${DRY_RUN:-0}" = "1" ]; then
  DRY_RUN_ARGS+=(--dry-run)
fi

RSYNC_COMMON=(
  rsync
  -aH
  --delete
  --delete-excluded
  --numeric-ids
  --stats
  --human-readable
  --exclude=/dev/
  --exclude=/proc/
  --exclude=/sys/
  --exclude=/run/
  --exclude=/tmp/
  --exclude=/var/tmp/
  --exclude=/media/
  --exclude=/lost+found
)

if [ -n "${RSYNC_EXCLUDE_TARGET}" ]; then
  RSYNC_COMMON+=(--exclude="${RSYNC_EXCLUDE_TARGET}")
fi

rsync_backup() {
  local src="$1"
  local dst="$2"
  echo "${LOG_PREFIX} Syncing ${src} -> ${dst}"
  mkdir -p "${dst}"
  "${RSYNC_COMMON[@]}" "${DRY_RUN_ARGS[@]}" "${src}" "${dst}"
}

echo "${LOG_PREFIX} Starting full-Pi mirror backup"
rsync_backup "${SOURCE_ARG}" "${TARGET_ROOT}"

if [ -n "${BOOT_SOURCE}" ] && [ -n "${BOOT_TARGET}" ] && [ -d "${BOOT_SOURCE}" ]; then
  echo "${LOG_PREFIX} Syncing boot files ${BOOT_SOURCE} -> ${BOOT_TARGET}"
  mkdir -p "${BOOT_TARGET}"
  "${RSYNC_COMMON[@]}" "${DRY_RUN_ARGS[@]}" "${BOOT_SOURCE}/" "${BOOT_TARGET}/"
else
  echo "${LOG_PREFIX} No boot partition sync configured or boot source missing."
fi

SYNC_DATE="$(date '+%F %T')"
echo "${LOG_PREFIX} Backup complete at ${SYNC_DATE}"
