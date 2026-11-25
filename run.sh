#!/usr/bin/env bash
# سوق بسماوي — مشغّل بأمر واحد (macOS / Linux / Git Bash).
#
#   ./run.sh            تطبيق الزبون على الويب ← يفتح بالمتصفح (http://localhost:8081)
#   ./run.sh ios        تطبيق الزبون على محاكي iOS (Expo Go، macOS فقط)
#   ./run.sh android    تطبيق الزبون على محاكي Android (Expo Go)
#   ./run.sh admin      لوحة الإدارة Next.js (http://localhost:3300)
#   ./run.sh driver     تطبيق السائق على الويب (http://localhost:8082)
#   ./run.sh all        الزبون + السائق + لوحة الإدارة معاً
#   ./run.sh stop       إيقاف كل ما شغّله هذا السكربت
#   ./run.sh help
#
# أول مرة: يثبّت الحزم (pnpm)، وينشئ apps/*/.env من .env.example.
# لا يضع أي مفتاح: املأ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# بقيمة مشروع mukhdar-dev (Project Settings ← API Keys ← Publishable key؛ RUNBOOK §13).
# لا يشغّل Docker ولا يلمس قاعدة البيانات.
set -euo pipefail
cd "$(dirname "$0")"

CUSTOMER_PORT=8081
DRIVER_PORT=8082
ADMIN_PORT=3300
RUN_DIR="${TMPDIR:-/tmp}/mukhdar-run"
mkdir -p "$RUN_DIR"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

open_url() {
  if [ "$(uname)" = Darwin ]; then open -a Safari "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$1" >/dev/null 2>&1 || true
  fi
}

port_free() {
  if command -v lsof >/dev/null 2>&1; then ! lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}

wait_http() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fs -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  return 1
}

prereqs() {
  command -v node >/dev/null 2>&1 || die "Node غير مثبّت — ثبّت Node 24 (nvm install 24 أو brew install node@24)"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || die "يحتاج Node 24+ (الموجود $(node -v)) — nvm use 24"
  command -v pnpm >/dev/null 2>&1 || die "pnpm غير مثبّت — npm i -g pnpm@12 (أو corepack enable)"
  [ -d node_modules ] || { say "· تثبيت الحزم (pnpm install)"; pnpm install --frozen-lockfile; }
}

# apps/<app>/<file> from .env.example, and a clear warning while the key is empty.
env_file() { # app file keyvar
  local f="apps/$1/$2"
  if [ ! -f "$f" ]; then
    # The example's placeholder URL is not a URL: Next's CSP build throws on it,
    # so a fresh file starts with the URL empty (= «الإعداد ناقص», not a crash).
    sed 's#=https://<project-ref>\.supabase\.co#=#' "apps/$1/.env.example" >"$f"
    say "· أُنشئ $f من .env.example"
  fi
  if ! grep -Eq "^$3=.+" "$f" || grep -Eq '^(EXPO|NEXT)_PUBLIC_SUPABASE_URL=(https://<project-ref>.*)?$' "$f"; then
    say "! $f ناقص: املأ رابط Supabase و$3 (mukhdar-dev ← Project Settings ← API Keys؛ RUNBOOK §13)."
    return 1
  fi
}

start_bg() { # name port cmd...
  local name=$1 port=$2; shift 2
  port_free "$port" || die "المنفذ $port مشغول — ./run.sh stop أو حرّره: lsof -iTCP:$port"
  nohup "$@" >"$RUN_DIR/$name.log" 2>&1 &
  echo $! >"$RUN_DIR/$name.pid"
}

customer_web() {
  env_file customer .env EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || say "  (يعمل التطبيق ويعرض «إعداد الاتصال ناقص» إلى أن تملأها)"
  start_bg customer "$CUSTOMER_PORT" pnpm --filter @mukhdar/customer exec expo start --port "$CUSTOMER_PORT"
  say "· تشغيل تطبيق الزبون (أول تحميل للويب يأخذ دقيقة)…"
  wait_http "http://localhost:$CUSTOMER_PORT" 120 || die "لم يبدأ — راجع $RUN_DIR/customer.log"
  say "  تطبيق الزبون:  http://localhost:$CUSTOMER_PORT"
}

driver_web() {
  env_file driver .env EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || say "  (يعمل التطبيق ويعرض «إعداد الاتصال ناقص» إلى أن تملأها)"
  start_bg driver "$DRIVER_PORT" pnpm --filter @mukhdar/driver exec expo start --port "$DRIVER_PORT"
  wait_http "http://localhost:$DRIVER_PORT" 120 || die "لم يبدأ — راجع $RUN_DIR/driver.log"
  say "  تطبيق السائق:  http://localhost:$DRIVER_PORT"
}

admin_web() {
  env_file admin .env.local NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || die "لوحة الإدارة لا تعمل بدون هذين المتغيرين — املأهما ثم أعد ./run.sh admin"
  start_bg admin "$ADMIN_PORT" pnpm --filter @mukhdar/admin exec next dev -p "$ADMIN_PORT"
  wait_http "http://localhost:$ADMIN_PORT" 120 || die "لم تبدأ — راجع $RUN_DIR/admin.log"
  say "  لوحة الإدارة:  http://localhost:$ADMIN_PORT"
}

stop_all() {
  local any=
  for f in "$RUN_DIR"/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f")
    # pnpm → expo/next: stop the whole process group's children too.
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null && any=1
    rm -f "$f"
  done
  for p in $CUSTOMER_PORT $DRIVER_PORT $ADMIN_PORT; do
    command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  if [ "$(uname)" = Darwin ] && [ -f "$RUN_DIR/ios.sim" ]; then
    xcrun simctl shutdown all 2>/dev/null || true; rm -f "$RUN_DIR/ios.sim"
  fi
  [ -n "$any" ] && say "· أُوقف كل شيء" || say "· لا شيء يعمل"
}

case "${1:-web}" in
  help | -h | --help)
    sed -n 2,17p "$0" | sed 's/^# \{0,1\}//'
    ;;
  web | customer)
    prereqs; customer_web; open_url "http://localhost:$CUSTOMER_PORT"
    say "  للإيقاف: ./run.sh stop"
    ;;
  ios)
    [ "$(uname)" = Darwin ] || die "iOS يحتاج macOS + Xcode؛ استعمل ./run.sh web أو android"
    command -v xcrun >/dev/null 2>&1 || die "ثبّت Xcode (xcode-select --install)"
    prereqs; env_file customer .env EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || say "  (يعمل التطبيق ويعرض «إعداد الاتصال ناقص» إلى أن تملأها)"
    port_free "$CUSTOMER_PORT" || die "المنفذ $CUSTOMER_PORT مشغول — ./run.sh stop"
    open -a Simulator; touch "$RUN_DIR/ios.sim"
    say "· يفتح المحاكي ويثبّت Expo Go ويشغّل التطبيق (Ctrl+C للإيقاف)"
    pnpm --filter @mukhdar/customer exec expo start --ios --port "$CUSTOMER_PORT"
    ;;
  android)
    command -v adb >/dev/null 2>&1 || die "Android SDK غير موجود (adb) — ثبّت Android Studio وشغّل محاكياً"
    prereqs; env_file customer .env EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || say "  (يعمل التطبيق ويعرض «إعداد الاتصال ناقص» إلى أن تملأها)"
    pnpm --filter @mukhdar/customer exec expo start --android --port "$CUSTOMER_PORT"
    ;;
  admin)
    prereqs; admin_web; open_url "http://localhost:$ADMIN_PORT"
    ;;
  driver)
    prereqs; driver_web; open_url "http://localhost:$DRIVER_PORT"
    ;;
  all)
    prereqs; customer_web; driver_web; admin_web
    open_url "http://localhost:$CUSTOMER_PORT"; open_url "http://localhost:$ADMIN_PORT"
    say "  للإيقاف: ./run.sh stop"
    ;;
  stop)
    stop_all
    ;;
  *)
    say "أمر غير معروف: $1"; sed -n 2,17p "$0" | sed 's/^# \{0,1\}//'; exit 1
    ;;
esac
