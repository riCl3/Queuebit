const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const request = require('supertest');

const {
  BASE_URL,
  ROOT,
  startStack,
  stopStack,
  uploadDocument,
  pollJobUntil,
  waitForJobEvent,
  recordUpload,
  finalizeMetrics,
  writeMetricsFile,
  sleep,
  metrics
} = require('./helpers/harness');

const FIXTURES = path.join(__dirname, 'fixtures');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

const fixture = (name) => path.join(FIXTURES, name);

before(async () => {
  await startStack();
});

after(async () => {
  finalizeMetrics();
  const file = writeMetricsFile();
  console.log('\n[metrics] Written to', file);
  console.log('[metrics] Summary:', JSON.stringify(metrics.summary, null, 2));
  await stopStack();
});

describe('Liveness and health', () => {
  it('GET / responds with a welcome payload', async () => {
    const res = await request(BASE_URL).get('/');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.match(res.body.message, /Queuebit/i);
  });

  it('GET /health reports MongoDB and Redis as connected', async () => {
    const res = await request(BASE_URL).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.mongodb, 'connected');
    assert.equal(res.body.redis, 'connected');
  });
});

describe('Document upload API', () => {
  it('rejects an upload with no file (400)', async () => {
    const res = await request(BASE_URL).post('/api/upload');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('rejects unsupported file types (400)', async () => {
    const res = await request(BASE_URL)
      .post('/api/upload')
      .attach('document', Buffer.from('not a document'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg'
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid file type/i);
  });

  it('rejects files larger than the 10 MB limit (413)', async () => {
    const res = await request(BASE_URL)
      .post('/api/upload')
      .attach('document', Buffer.alloc(11 * 1024 * 1024), 'big.txt');
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'LIMIT_FILE_SIZE');
  });

  it('accepts a valid text file and returns a job id (202)', async () => {
    const { res } = await uploadDocument(fixture('sample.txt'));
    assert.equal(res.status, 202);
    assert.equal(res.body.message, 'File uploaded successfully');
    assert.ok(res.body.jobId, 'jobId should be present');
    assert.match(res.body.jobId, /^[0-9a-f-]{36}$/);
  });

  it('accepts a valid PDF file and returns a job id (202)', async () => {
    const { res } = await uploadDocument(fixture('sample.pdf'));
    assert.equal(res.status, 202);
    assert.ok(res.body.jobId, 'jobId should be present');
  });
});

describe('Job lifecycle (end-to-end)', () => {
  it('processes a .txt document to completion with extracted data', async () => {
    const { res, uploadLatencyMs, uploadDoneAt } = await uploadDocument(fixture('sample.txt'));
    assert.equal(res.status, 202);
    const jobId = res.body.jobId;

    const { job, transitions } = await pollJobUntil(jobId);
    assert.equal(job.status, 'completed');
    assert.equal(job.jobId, jobId);

    const data = job.extractedData;
    assert.ok(data, 'extractedData should be present');
    assert.ok(Array.isArray(data.names), 'names should be an array');
    assert.ok(Array.isArray(data.dates), 'dates should be an array');
    assert.ok(Array.isArray(data.actionItems), 'actionItems should be an array');

    const names = (data.names || []).join(' ').toLowerCase();
    const dates = (data.dates || []).join(' ');
    const actions = (data.actionItems || []).join(' ').toLowerCase();

    assert.ok(names.includes('justin'), `expected a "Justin" name, got: ${data.names}`);
    assert.match(dates, /2026/, `expected a 2026 date, got: ${data.dates}`);
    assert.ok(actions.length > 0, 'expected at least one action item');

    recordUpload({ fixture: 'sample.txt', status: 'completed', uploadLatencyMs, uploadDoneAt, transitions });

    let leftovers = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith('.'));
    const deleteDeadline = Date.now() + 10000;
    while (leftovers.length > 0 && Date.now() < deleteDeadline) {
      await sleep(250);
      leftovers = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith('.'));
    }
    assert.deepEqual(leftovers, [], 'worker should delete the uploaded temp file after processing');
  });

  it('processes a .pdf document to completion with extracted data', async () => {
    const { res, uploadLatencyMs, uploadDoneAt } = await uploadDocument(fixture('sample.pdf'));
    assert.equal(res.status, 202);
    const jobId = res.body.jobId;

    const { job, transitions } = await pollJobUntil(jobId);
    assert.equal(job.status, 'completed');

    const data = job.extractedData;
    assert.ok(data, 'extractedData should be present');
    assert.ok(Array.isArray(data.names) && data.names.length > 0, 'expected names from PDF');
    assert.ok(Array.isArray(data.dates) && data.dates.length > 0, 'expected dates from PDF');
    assert.ok(Array.isArray(data.actionItems), 'actionItems should be an array');

    recordUpload({ fixture: 'sample.pdf', status: 'completed', uploadLatencyMs, uploadDoneAt, transitions });
  });

  it('marks malformed documents as failed with an error message', async () => {
    const { res, uploadLatencyMs, uploadDoneAt } = await uploadDocument(fixture('malformed.pdf'));
    assert.equal(res.status, 202);
    const jobId = res.body.jobId;

    const { job, transitions } = await pollJobUntil(jobId);
    assert.equal(job.status, 'failed');
    assert.ok(job.errorMessage, 'errorMessage should be present');
    assert.ok(job.errorMessage.length > 0);

    recordUpload({ fixture: 'malformed.pdf', status: 'failed', uploadLatencyMs, uploadDoneAt, transitions, error: job.errorMessage });
  });

  it('returns 404 for an unknown job id', async () => {
    const res = await request(BASE_URL).get('/api/job/00000000-0000-0000-0000-000000000000');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Job not found');
  });
});

describe('Real-time updates (Socket.IO)', () => {
  it('emits a job_updated event when a job completes', async () => {
    const { res, uploadLatencyMs, uploadDoneAt } = await uploadDocument(fixture('sample.txt'));
    assert.equal(res.status, 202);
    const jobId = res.body.jobId;

    const eventPromise = waitForJobEvent(jobId, 'completed');
    const { job, transitions } = await pollJobUntil(jobId, { terminal: ['completed', 'failed'] });

    const event = await eventPromise;
    assert.equal(event.jobId, jobId);
    assert.equal(event.status, job.status);
    assert.equal(event.status, 'completed');
    assert.ok(event.extractedData, 'event should carry extractedData');

    recordUpload({ fixture: 'sample.txt (socket)', status: 'completed', uploadLatencyMs, uploadDoneAt, transitions });
  });
});