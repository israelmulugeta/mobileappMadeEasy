# Web-to-Mobile App Builder (MVP)

A full-stack MVP that converts uploaded web apps (HTML/CSS/JS ZIP) into Android APK and iOS IPA artifacts using a Capacitor template and automated build scripts.

## Project structure

```text
web-to-mobile-builder/
├─ backend/
│  ├─ server.js
│  ├─ buildQueue.js
│  ├─ utils.js
│  ├─ package.json
│  └─ uploads/
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ build-scripts/
│  ├─ android-build.sh
│  └─ ios-build.sh
├─ capacitor-template/
│  ├─ android/
│  ├─ ios/
│  ├─ www/
│  │  ├─ index.html
│  │  └─ assets/
│  ├─ capacitor.config.json
│  └─ package.json
├─ logs/
│  └─ build-logs/
└─ README.md
```

## Features

- Landing page with responsive upload workflow and build progress.
- Secure ZIP validation (size + blocked extensions + path traversal checks).
- Build queue with concurrency control.
- Optional plugin toggles (camera, push notifications, analytics).
- Android/iOS shell build scripts with logging and signing hooks.
- Signed temporary download URLs for build artifacts.
- Temporary workspace cleanup after each build.
- Optional email notification stub.
- Optional containerized execution pattern (see Docker notes below).

## Prerequisites

### Node.js + npm
1. Install Node.js 20+ from https://nodejs.org/
2. Verify:
   ```bash
   node -v
   npm -v
   ```

### Android toolchain (Linux/macOS CI)
1. Install JDK 17.
2. Install Android SDK command-line tools.
3. Ensure `ANDROID_HOME` and platform tools are on PATH.
4. Ensure Gradle wrapper works inside `capacitor-template/android`.

### iOS toolchain (macOS only)
1. Install Xcode.
2. Install CLI tools:
   ```bash
   xcode-select --install
   ```
3. Install CocoaPods if needed:
   ```bash
   sudo gem install cocoapods
   ```

## Setup

### 1) Backend setup
```bash
cd web-to-mobile-builder/backend
npm install
```

### 2) Capacitor template setup
```bash
cd ../capacitor-template
npm install
```

### 3) Run backend API
```bash
cd ../backend
PORT=4000 node server.js
```

### 4) Serve frontend
Use any static server:
```bash
cd ../frontend
python3 -m http.server 8080
```
Open `http://localhost:8080`.

> If backend and frontend are served on different ports, configure a proxy or update frontend fetch URLs.

## API overview

### `POST /api/build`
Multipart form:
- `appZip` (required, max 50MB)
- `appName` (optional)
- `appIcon` (optional)
- `splashScreen` (optional)
- `platforms` = `android,ios` (default both)
- `camera`, `push`, `analytics` toggles (`true|false`)
- `email` (optional)

Returns `202` with `{ jobId, statusUrl }`.

### `GET /api/build/:jobId`
Returns queued/running/completed/failed status and artifacts.

### `GET /api/download/:token`
Downloads artifact if token is valid and unexpired.

## Signing configuration

### Android signing env
Set these variables before backend start:
```bash
export ANDROID_KEYSTORE_PATH=/secure/keys/release.keystore
export ANDROID_KEYSTORE_PASS=***
export ANDROID_KEY_ALIAS=myalias
export ANDROID_KEY_PASS=***
```

### iOS signing env
Set export options plist path:
```bash
export IOS_EXPORT_OPTIONS_PLIST=/secure/signing/ExportOptions.plist
```
Ensure certificate and provisioning profiles are installed in macOS keychain + profiles.

## Local testing

### Android build script quick test
```bash
PROJECT_DIR=/path/to/project OUTPUT_PATH=/tmp/app.apk LOG_FILE=/tmp/android.log ./build-scripts/android-build.sh
```

### iOS build script quick test (macOS)
```bash
PROJECT_DIR=/path/to/project OUTPUT_PATH=/tmp/app.ipa LOG_FILE=/tmp/ios.log IOS_EXPORT_OPTIONS_PLIST=/path/ExportOptions.plist ./build-scripts/ios-build.sh
```

## Docker isolation (optional)

For stronger isolation, run each queued build in a container that mounts only:
- A per-job working directory
- Read-only template
- Output directory

For iOS, use a macOS executor/runner (Docker for full iOS build is limited by Apple tooling).

## Deployment notes

- Put backend behind Nginx/Traefik + TLS.
- Store keys and secrets in a secret manager (Vault, SSM, Doppler).
- Replace in-memory queue with Redis/BullMQ for horizontal scaling.
- Move job state to DB (Postgres).
- Use object storage (S3/GCS) for artifacts and expiring pre-signed links.
- Add cron cleanup for old logs/artifacts.

## Retry and scheduling ideas

- Add retry count per job (e.g., max 2 retries for transient failures).
- Add delayed/scheduled job option via queue metadata.
- Add usage analytics counters (jobs/day, success/failure rate).

## Security checklist

- ZIP size limit enforced (50MB).
- ZIP entry path traversal prevented.
- Blocked executable extensions prevented.
- Build workspace isolated per job.
- Temporary workspace deleted on completion.
- Errors logged without leaking secrets.

## Notes

This MVP is intentionally extensible. For production, prioritize robust queueing, dedicated build workers, hardened sandboxing, and complete artifact lifecycle policies.
