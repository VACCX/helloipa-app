#!/usr/bin/env bash
# build-ipa.sh —— macOS 上一键产出未签名 .ipa（不需要开发者账号）
#
#   ./scripts/build-ipa.sh
#   BUNDLE_ID=com.yourname.app APP_OUT_NAME=MyApp ./scripts/build-ipa.sh
#
# 产物：build/HelloIPA-unsigned.ipa
# 未签名 IPA 只能通过重签名工具（Sideloadly / AltStore / TrollStore / ldid）装到设备。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEME="${SCHEME:-HelloIPA}"
CONFIG="${CONFIG:-Release}"
BUNDLE_ID="${BUNDLE_ID:-com.quqi.helloipa}"
MARKETING_VERSION="${MARKETING_VERSION:-1.0.0}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
OUT="${OUT:-$ROOT/build}"
APP_OUT_NAME="${APP_OUT_NAME:-HelloIPA}"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "缺 xcodebuild：本脚本需要在 macOS + Xcode 15 以上运行" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "缺 node（>=18）：打包步骤用 node scripts/make-ipa.mjs" >&2
  exit 1
fi

mkdir -p "$OUT"

echo "==> archive ($CONFIG, bundle=$BUNDLE_ID)"
set -o pipefail
xcodebuild \
  -project "$ROOT/$SCHEME.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/$SCHEME.xcarchive" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  clean archive 2>&1 | tee "$OUT/xcodebuild.log" | tail -n 25

APP="$OUT/$SCHEME.xcarchive/Products/Applications/$SCHEME.app"
if [ ! -d "$APP" ]; then
  echo "未产出 .app：$APP" >&2
  echo "看日志：$OUT/xcodebuild.log" >&2
  exit 1
fi

echo "==> package ipa"
node "$ROOT/scripts/make-ipa.mjs" "$APP" "$OUT/$APP_OUT_NAME-unsigned.ipa"
echo "==> done"
echo "IPA : $OUT/$APP_OUT_NAME-unsigned.ipa"
echo "APP : $APP"
