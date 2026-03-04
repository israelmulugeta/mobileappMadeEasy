#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:?PROJECT_DIR env is required}"
OUTPUT_PATH="${OUTPUT_PATH:?OUTPUT_PATH env is required}"
LOG_FILE="${LOG_FILE:-/tmp/ios-build.log}"

log() {
  echo "[$(date -Iseconds)] [ios] $1" | tee -a "$LOG_FILE"
}

cleanup_previous() {
  rm -f "$OUTPUT_PATH"
}

main() {
  log "Starting iOS build in $PROJECT_DIR"
  cleanup_previous

  cd "$PROJECT_DIR"
  npm install >> "$LOG_FILE" 2>&1
  npx cap sync ios >> "$LOG_FILE" 2>&1

  if ! command -v xcodebuild >/dev/null 2>&1; then
    log "ERROR: xcodebuild not found. Run on macOS with Xcode CLI tools installed."
    exit 1
  fi

  cd ios/App
  local archive_path="$PROJECT_DIR/ios/App/build/App.xcarchive"
  local export_path="$PROJECT_DIR/ios/App/build/export"

  rm -rf "$archive_path" "$export_path"

  xcodebuild \
    -workspace App.xcworkspace \
    -scheme App \
    -configuration Release \
    -archivePath "$archive_path" \
    archive >> "$LOG_FILE" 2>&1

  if [[ -z "${IOS_EXPORT_OPTIONS_PLIST:-}" ]]; then
    log "ERROR: IOS_EXPORT_OPTIONS_PLIST env is required for IPA export/signing"
    exit 1
  fi

  xcodebuild -exportArchive \
    -archivePath "$archive_path" \
    -exportPath "$export_path" \
    -exportOptionsPlist "$IOS_EXPORT_OPTIONS_PLIST" >> "$LOG_FILE" 2>&1

  local ipa_path
  ipa_path="$(find "$export_path" -name '*.ipa' | head -n1)"
  if [[ -z "${ipa_path}" ]]; then
    log "ERROR: IPA not generated"
    exit 1
  fi

  cp "$ipa_path" "$OUTPUT_PATH"
  log "iOS build completed: $OUTPUT_PATH"
}

main "$@"
