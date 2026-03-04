const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.com', '.jar', '.apk', '.ipa', '.bin'
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeName(name, fallback = 'My Mobile App') {
  if (!name || typeof name !== 'string') return fallback;
  const clean = name.replace(/[^a-zA-Z0-9\s._-]/g, '').trim();
  return clean || fallback;
}

function randomId(prefix = 'build') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function validateZipFile(zipPath) {
  const stat = fs.statSync(zipPath);
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new Error('ZIP file exceeds 50MB upload limit.');
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (!entries.length) {
    throw new Error('ZIP file is empty.');
  }

  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/');

    // Prevent directory traversal and absolute paths.
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid ZIP path detected: ${entry.entryName}`);
    }

    if (entry.isDirectory) continue;

    const ext = path.extname(normalized).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new Error(`Blocked file extension in ZIP: ${ext}`);
    }
  }

  return entries.length;
}

function extractZip(zipPath, targetDir) {
  ensureDir(targetDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(targetDir, true);
}

function copyDirSync(source, destination) {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function safeExecFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      return resolve({ stdout, stderr });
    });
  });
}

function writeLog(logFile, data) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${data}\n`);
}

function createSignedToken(payload, secret, ttlSeconds = 3600) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const tokenPayload = `${payload}.${expiry}`;
  const signature = crypto.createHmac('sha256', secret).update(tokenPayload).digest('hex');
  return `${tokenPayload}.${signature}`;
}

function verifySignedToken(token, secret) {
  const [payload, expiry, signature] = token.split('.');
  if (!payload || !expiry || !signature) return null;

  const tokenPayload = `${payload}.${expiry}`;
  const expected = crypto.createHmac('sha256', secret).update(tokenPayload).digest('hex');
  if (expected !== signature) return null;

  if (Number(expiry) < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function rmDirSafe(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  ensureDir,
  sanitizeName,
  randomId,
  validateZipFile,
  extractZip,
  copyDirSync,
  safeExecFile,
  writeLog,
  createSignedToken,
  verifySignedToken,
  rmDirSafe
};
