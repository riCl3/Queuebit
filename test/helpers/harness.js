const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');
const { io: SocketClient } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_PORT = process.env.TEST_PORT || '3100';
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${TEST_PORT}`;

const metrics = {
  environment: {},
  startedAt: Date.now(),
  uploads: [],
  summary: {},
  events: { job_updated_received: 0 }
};

let children = [];
let stackReady = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function captureLogs(child) {
  let buffer = '';
  child.stdout.on('data', (d) => { buffer += d.toString(); });
  child.stderr.on('data', (d) => { buffer += d.toString(); });
  return { get: () => buffer };
}

async function waitForHealth(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastBody = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const body = await res.json();
        lastBody = JSON.stringify(body);
        if (body.mongodb === 'connected' && body.redis === 'connected') return body;
      }
    } catch (err) {
      lastBody = err.message;
    }
    await sleep(500);
  }
  throw new Error(`Server did not become healthy in time. Last health response: ${lastBody}`);
}

function waitForLog(child, regex, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`Child did not log "${regex}" in time. Logs:\n${buffer.slice(-3000)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (regex.test(buffer)) {
        clearTimeout(timer);
        child.stdout.removeListener('data', onData);
        child.stderr.removeListener('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

async function startStack() {
  if (stackReady) return;
  const childEnv = {
    ...process.env,
    PORT: TEST_PORT,
    SOCKET_SERVER_URL: BASE_URL
  };

  const uploadsDir = path.join(ROOT, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    for (const f of fs.readdirSync(uploadsDir)) {
      if (!f.startsWith('.')) fs.unlinkSync(path.join(uploadsDir, f));
    }
  }

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const worker = spawn(process.execPath, ['worker.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(server, worker);

  const serverLog = captureLogs(server);
  const workerLog = captureLogs(worker);

  const workerReady = waitForLog(worker, /Worker started, waiting for jobs/);
  await waitForHealth();
  try {
    await workerReady;
  } catch (err) {
    console.error('Worker failed to start. Worker logs:\n' + workerLog.get().slice(-3000));
    console.error('Server logs:\n' + serverLog.get().slice(-3000));
    throw err;
  }

  metrics.environment = {
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    aiModel: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    aiBaseUrl: process.env.AI_BASE_URL || process.env.XAI_BASE_URL || 'https://api.groq.com/openai/v1',
    testPort: TEST_PORT,
    startedAt: new Date().toISOString()
  };

  stackReady = true;
}

async function stopStack() {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await sleep(1500);
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  children = [];
  stackReady = false;
}

async function uploadDocument(filePath) {
  const t0 = Date.now();
  const res = await request(BASE_URL).post('/api/upload').attach('document', filePath);
  const uploadLatencyMs = Date.now() - t0;
  return { res, uploadLatencyMs, uploadDoneAt: Date.now() };
}

async function pollJobUntil(jobId, { terminal = ['completed', 'failed'], interval = 200, timeout = 180000 } = {}) {
  const deadline = Date.now() + timeout;
  const transitions = [];
  let lastStatus = null;
  let body = null;

  while (Date.now() < deadline) {
    const res = await request(BASE_URL).get(`/api/job/${jobId}`);
    if (res.status === 200) {
      body = res.body;
      if (body.status !== lastStatus) {
        transitions.push({ status: body.status, at: Date.now() });
        lastStatus = body.status;
      }
      if (terminal.includes(body.status)) {
        return { job: body, transitions };
      }
    }
    await sleep(interval);
  }
  throw new Error(
    `Job ${jobId} did not reach a terminal state (${terminal.join('/')}) within ${timeout}ms. Last status: ${lastStatus}. Body: ${JSON.stringify(body)}`
  );
}

function waitForJobEvent(jobId, status, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = SocketClient(BASE_URL, { transports: ['websocket'], reconnection: true, timeout: 5000 });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`No 'job_updated' event (${status}) for job ${jobId} within ${timeout}ms`));
    }, timeout);

    socket.on('job_updated', (data) => {
      if (data.jobId === jobId && data.status === status) {
        clearTimeout(timer);
        metrics.events.job_updated_received += 1;
        socket.disconnect();
        resolve(data);
      }
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(`Socket connect error: ${err.message}`));
    });
  });
}

function recordUpload({ fixture, status, uploadLatencyMs, uploadDoneAt, transitions = [], error }) {
  const tProcessing = transitions.find((t) => t.status === 'processing');
  const tTerminal = transitions[transitions.length - 1];

  const entry = {
    fixture,
    status,
    uploadLatencyMs,
    queueWaitMs: tProcessing ? tProcessing.at - uploadDoneAt : null,
    processingMs: tProcessing && tTerminal ? tTerminal.at - tProcessing.at : null,
    endToEndMs: tTerminal ? tTerminal.at - uploadDoneAt : null,
    error: error || null
  };
  metrics.uploads.push(entry);
  metrics.summary.totalUploads = metrics.uploads.length;
  metrics.summary.completed = metrics.uploads.filter((u) => u.status === 'completed').length;
  metrics.summary.failed = metrics.uploads.filter((u) => u.status === 'failed').length;
  return entry;
}

function finalizeMetrics() {
  metrics.suiteDurationMs = Date.now() - metrics.startedAt;
  const completed = metrics.uploads.filter((u) => u.status === 'completed');
  metrics.summary.avgUploadLatencyMs = Math.round(
    metrics.uploads.reduce((s, u) => s + u.uploadLatencyMs, 0) / (metrics.uploads.length || 1)
  );
  metrics.summary.avgProcessingMs = completed.length
    ? Math.round(completed.reduce((s, u) => s + (u.processingMs || 0), 0) / completed.length)
    : null;
  metrics.summary.avgEndToEndMs = completed.length
    ? Math.round(completed.reduce((s, u) => s + (u.endToEndMs || 0), 0) / completed.length)
    : null;
  metrics.summary.throughputJobsPerMin = metrics.uploads.length
    ? Math.round((metrics.uploads.length / metrics.suiteDurationMs) * 60000)
    : 0;
  return metrics;
}

function writeMetricsFile() {
  const dir = path.join(ROOT, 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'metrics.json');
  fs.writeFileSync(file, JSON.stringify(metrics, null, 2));
  return file;
}

module.exports = {
  ROOT,
  BASE_URL,
  TEST_PORT,
  metrics,
  sleep,
  startStack,
  stopStack,
  uploadDocument,
  pollJobUntil,
  waitForJobEvent,
  recordUpload,
  finalizeMetrics,
  writeMetricsFile
};