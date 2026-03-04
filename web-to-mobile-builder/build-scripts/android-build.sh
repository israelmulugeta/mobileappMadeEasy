#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:?PROJECT_DIR env is required}"
OUTPUT_PATH="${OUTPUT_PATH:?OUTPUT_PATH env is required}"
LOG_FILE="${LOG_FILE:-/tmp/android-build.log}"

log() {
  echo "[$(date -Iseconds)] [android] $1" | tee -a "$LOG_FILE"
}

cleanup_previous() {
  rm -f "$OUTPUT_PATH"
}

main() {
  log "Starting Android build in $PROJECT_DIR"
  cleanup_previous

  cd "$PROJECT_DIR"
  npm install >> "$LOG_FILE" 2>&1
  npx cap sync android >> "$LOG_FILE" 2>&1

  cd android
  ./gradlew clean assembleRelease >> "$LOG_FILE" 2>&1

  local apk_path
  apk_path="$(find app/build/outputs/apk/release -name '*.apk' | head -n1)"
  if [[ -z "${apk_path}" ]]; then
    log "ERROR: APK not generated"
    exit 1
  fi

  if [[ -n "${ANDROID_KEYSTORE_PATH:-}" && -n "${ANDROID_KEY_ALIAS:-}" ]]; then
    log "Signing APK using jarsigner"
    jarsigner -keystore "$ANDROID_KEYSTORE_PATH" \
      -storepass "${ANDROID_KEYSTORE_PASS:-}" \
      -keypass "${ANDROID_KEY_PASS:-}" \
      "$apk_path" "$ANDROID_KEY_ALIAS" >> "$LOG_FILE" 2>&1
  else
    log "Signing env not configured, using unsigned release APK"
  fi

  cp "$apk_path" "$OUTPUT_PATH"
  log "Android build completed: $OUTPUT_PATH"
}

main "$@"
