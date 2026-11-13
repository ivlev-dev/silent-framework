#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CALLER_UID="$(id -u)"
CALLER_GID="$(id -g)"

if [ "$CALLER_UID" -ne 0 ]; then
  exec sudo -E "$ROOT_DIR/scripts/bench-vm.sh" "$@"
fi

CPU="${SILENT_VM_CPU:-4}"
MEMORY="${SILENT_VM_MEMORY:-4G}"
KERNEL="${SILENT_VM_KERNEL:-}"
CGROUP="/sys/fs/cgroup/silent-bench"
CALLER_UID="${SUDO_UID:-1000}"
CALLER_GID="${SUDO_GID:-1000}"
INNER="$(mktemp /tmp/silent-vm-XXXXXX.sh)"
NODE_DIR="$(dirname "$(command -v node)")"

if [ -z "$KERNEL" ]; then
  for candidate in "/boot/vmlinuz-$(uname -r)" "/boot/vmlinuz-linux-$(uname -r)" /boot/vmlinuz-*; do
    if [ -f "$candidate" ]; then
      KERNEL="$candidate"
      break
    fi
  done
fi

if [ -z "$KERNEL" ]; then
  echo "bench-vm: ядро не найдено, задайте SILENT_VM_KERNEL" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- bench:browser
fi

cleanup() {
  rm -f "$INNER"
  if [ -d "$CGROUP" ]; then
    for pid in $(cat "$CGROUP/cgroup.procs" 2>/dev/null); do
      echo "$pid" > /sys/fs/cgroup/cgroup.procs 2>/dev/null || true
    done
    echo member > "$CGROUP/cpuset.cpus.partition" 2>/dev/null || true
    rmdir "$CGROUP" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cat > "$INNER" <<EOF
#!/bin/sh
set -eu
export HOME="$HOME"
export PATH="$NODE_DIR:$PATH"
export SILENT_BENCH_CPUS=off
mkdir -p /sys/fs/cgroup/bench
echo +cpuset > /sys/fs/cgroup/cgroup.subtree_control
echo 0 > /sys/fs/cgroup/bench/cpuset.mems
echo 0 > /sys/fs/cgroup/bench/cpuset.cpus
echo \$\$ > /sys/fs/cgroup/bench/cgroup.procs
cd "$ROOT_DIR"
exec setpriv --reuid=$CALLER_UID --regid=$CALLER_GID --init-groups pnpm $*
EOF
chmod 755 "$INNER"
chown "$CALLER_UID:$CALLER_GID" "$INNER" 2>/dev/null || true

mkdir -p "$CGROUP"
echo +cpuset > /sys/fs/cgroup/cgroup.subtree_control
echo 0 > "$CGROUP/cpuset.mems"
echo "$CPU" > "$CGROUP/cpuset.cpus.exclusive"
echo "$CPU" > "$CGROUP/cpuset.cpus"
echo root > "$CGROUP/cpuset.cpus.partition"

echo "bench-vm: cpu $CPU, 1 vCPU, $MEMORY, ядро $(basename "$KERNEL"), команда: pnpm $*"

echo $$ > "$CGROUP/cgroup.procs"
setpriv --reuid="$CALLER_UID" --regid="$CALLER_GID" --init-groups \
  taskset -c "$CPU" vng --run "$KERNEL" --cpus 1 --memory "$MEMORY" --user root --exec "$INNER"
