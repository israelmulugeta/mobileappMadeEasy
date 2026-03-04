const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const BuildQueue = require('./buildQueue');
const {
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
} = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const WORK_DIR = path.join(ROOT, '.work');
const TEMPLATE_DIR = path.join(ROOT, 'capacitor-template');
const LOGS_DIR = path.join(ROOT, 'logs', 'build-logs');
const OUTPUT_DIR = path.join(ROOT, 'outputs');

const PORT = process.env.PORT || 4000;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'change-this-secret';
const ENABLE_EMAIL = process.env.ENABLE_EMAIL === 'true';

ensureDir(UPLOAD_DIR);
ensureDir(WORK_DIR);
ensureDir(LOGS_DIR);
ensureDir(OUTPUT_DIR);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

const app = express();
app.use(express.json());
app.use('/frontend', express.static(path.join(ROOT, 'frontend')));

const queue = new BuildQueue(Number(process.env.BUILD_CONCURRENCY || 2));
const jobs = new Map();

queue.on('queued', (id) => {
  jobs.get(id).status = 'queued';
});

queue.on('started', (id) => {
  const job = jobs.get(id);
  job.status = 'building';
  job.startedAt = new Date().toISOString();
});

queue.on('completed', (id, result) => {
  const job = jobs.get(id);
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.result = result;
});

queue.on('failed', (id, error) => {
  const job = jobs.get(id);
  job.status = 'failed';
  job.completedAt = new Date().toISOString();
  job.error = error.message || String(error);
});

function getPluginList(body) {
  return {
    camera: body.camera === 'true' || body.camera === true,
    push: body.push === 'true' || body.push === true,
    analytics: body.analytics === 'true' || body.analytics === true
  };
}

async function configureProject({ projectDir, appName, plugins, iconFile, splashFile, userWebDir }) {
  const configPath = path.join(projectDir, 'capacitor.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.appName = appName;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const targetWww = path.join(projectDir, 'www');
  rmDirSafe(targetWww);
  copyDirSync(userWebDir, targetWww);

  // Optional assets override.
  ensureDir(path.join(targetWww, 'assets'));
  if (iconFile) {
    fs.copyFileSync(iconFile.path, path.join(targetWww, 'assets', 'icon.png'));
  }
  if (splashFile) {
    fs.copyFileSync(splashFile.path, path.join(targetWww, 'assets', 'splash.png'));
  }

  // Optional plugin installation list. For MVP we only record requested plugins and install via npm.
  const installList = [];
  if (plugins.camera) installList.push('@capacitor/camera');
  if (plugins.push) installList.push('@capacitor/push-notifications');
  if (plugins.analytics) installList.push('cordova-plugin-firebasex');

  if (installList.length > 0) {
    await safeExecFile('npm', ['install', ...installList], { cwd: projectDir });
  }
}

async function runBuild({ jobId, platform, projectDir, logFile }) {
  const script = platform === 'ios' ? 'ios-build.sh' : 'android-build.sh';
  const scriptPath = path.join(ROOT, 'build-scripts', script);
  const outputName = `${jobId}-${platform}.${platform === 'ios' ? 'ipa' : 'apk'}`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  writeLog(logFile, `Running ${script} for ${platform}`);

  const env = {
    ...process.env,
    PROJECT_DIR: projectDir,
    OUTPUT_PATH: outputPath,
    JOB_ID: jobId,
    LOG_FILE: logFile
  };

  await safeExecFile('bash', [scriptPath], { env });

  const token = createSignedToken(outputName, DOWNLOAD_SECRET, 60 * 60 * 4);
  return {
    platform,
    artifact: outputName,
    downloadUrl: `/api/download/${token}`
  };
}

async function maybeSendEmail(email, jobId, links) {
  if (!ENABLE_EMAIL || !email) return;
  // Placeholder for integration with nodemailer / SES / Postmark.
  console.log(`[EMAIL] would send build results for ${jobId} to ${email}`, links);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, queue: queue.getStats() });
});

const uploadFields = upload.fields([
  { name: 'appZip', maxCount: 1 },
  { name: 'appIcon', maxCount: 1 },
  { name: 'splashScreen', maxCount: 1 }
]);

app.post('/api/build', uploadFields, async (req, res) => {
  try {
    const zipFile = req.files?.appZip?.[0];
    const iconFile = req.files?.appIcon?.[0];
    const splashFile = req.files?.splashScreen?.[0];

    if (!zipFile) {
      return res.status(400).json({ error: 'appZip is required.' });
    }

    validateZipFile(zipFile.path);

    const platforms = (req.body.platforms || 'android,ios')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p === 'android' || p === 'ios');

    if (platforms.length === 0) {
      return res.status(400).json({ error: 'At least one valid platform is required.' });
    }

    const jobId = randomId('job');
    const appName = sanitizeName(req.body.appName, 'Web2Mobile App');
    const logFile = path.join(LOGS_DIR, `${jobId}.log`);
    const workDir = path.join(WORK_DIR, jobId);
    const projectDir = path.join(workDir, 'project');
    const extractedDir = path.join(workDir, 'uploaded-web');

    jobs.set(jobId, {
      id: jobId,
      status: 'created',
      platforms,
      createdAt: new Date().toISOString(),
      logs: logFile
    });

    queue.add({
      id: jobId,
      handler: async () => {
        writeLog(logFile, `Preparing build ${jobId}`);
        ensureDir(workDir);
        copyDirSync(TEMPLATE_DIR, projectDir);
        extractZip(zipFile.path, extractedDir);

        const plugins = getPluginList(req.body);
        writeLog(logFile, `Selected plugins: ${JSON.stringify(plugins)}`);

        await configureProject({
          projectDir,
          appName,
          plugins,
          iconFile,
          splashFile,
          userWebDir: extractedDir
        });

        const artifacts = [];
        for (const platform of platforms) {
          try {
            const artifact = await runBuild({ jobId, platform, projectDir, logFile });
            artifacts.push(artifact);
          } catch (err) {
            writeLog(logFile, `${platform} build failed: ${err.error?.message || err.message}`);
            throw new Error(`${platform} build failed`);
          }
        }

        await maybeSendEmail(req.body.email, jobId, artifacts);

        writeLog(logFile, `Build ${jobId} completed`);
        rmDirSafe(workDir);
        rmDirSafe(zipFile.path);
        return { artifacts };
      }
    });

    return res.status(202).json({
      jobId,
      statusUrl: `/api/build/${jobId}`
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Invalid request.' });
  }
});

app.get('/api/build/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json(job);
});

app.get('/api/download/:token', (req, res) => {
  const payload = verifySignedToken(req.params.token, DOWNLOAD_SECRET);
  if (!payload) return res.status(403).json({ error: 'Invalid or expired token.' });

  const filePath = path.join(OUTPUT_DIR, payload);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }

  return res.download(filePath);
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Max 50MB.' });
  }
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Web-to-Mobile Builder backend running on port ${PORT}`);
});
