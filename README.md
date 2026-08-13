# ⚡ Queuebit

**Asynchronous document intelligence pipeline** — upload a document (TXT/PDF), let a background worker extract structured information (`names`, `dates`, `actionItems`) with an LLM, track the job in real time, and get the results back through a REST API, real-time Socket.IO events, or a full-screen terminal CLI.

```
        ┌──────────────┐              multipart POST /api/upload
        │   CLI (Ink)  │ ───────────────────────────────────────────────▶
        │  /upload     │ ──────── poll GET /api/job/:id ────────────────▶
        │  /key /model │          ◀────────── JSON job status ──────────
        └──────────────┘
```

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Layout](#project-layout)
- [How It Works](#how-it-works)
  - [Job Lifecycle](#job-lifecycle)
  - [Data Model](#data-model)
- [API Reference](#api-reference)
  - [`GET /`](#get-)
  - [`GET /health`](#get-health)
  - [`POST /api/upload`](#post-apiupload)
  - [`GET /api/job/:id`](#get-apijobid)
- [Real-Time Updates (Socket.IO)](#real-time-updates-socketio)
- [Command-Line Interface](#command-line-interface)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Install Dependencies](#1-install-dependencies)
  - [2. Start MongoDB & Redis (Docker)](#2-start-mongodb--redis-docker)
  - [3. Configure Environment](#3-configure-environment)
  - [4. Run the API Server](#4-run-the-api-server)
  - [5. Run the Worker](#5-run-the-worker)
  - [6. Run the CLI](#6-run-the-cli)
- [Running the Tests](#running-the-tests)
- [Test Results & Metrics](#test-results--metrics)
- [Bugs Found & Fixed During Development](#bugs-found--fixed-during-development)
- [Error Handling & Failure Modes](#error-handling--failure-modes)
- [Limitations & Future Work](#limitations--future-work)
- [License](#license)

---

## Features

- **Async, queue-based processing** — uploads return immediately with a `jobId`; heavy work (text extraction + LLM inference) happens in a background worker via **BullMQ** on Redis.
- **Persistent job tracking** — every job is stored in **MongoDB** with a full status lifecycle and indexed lookups.
- **TXT & PDF support** — plain text is read directly; PDFs are parsed with `pdf-parse` v2.
- **LLM-powered extraction** — a configurable, OpenAI-compatible LLM extracts structured JSON (`names`, `dates`, `actionItems`). Works with **Groq** (default, generous free tier) or **xAI Grok** — just change two env vars.
- **Real-time updates** — the worker pushes `job_updated` events over **Socket.IO** as soon as a job completes or fails.
- **Terminal UI (CLI)** — a polished, full-screen Ink/React TUI with command autocomplete, spinner, and results panel.
- **Graceful shutdown** — both server and worker drain connections cleanly on `SIGINT`/`SIGTERM`.
- **Professional integration test suite** — 12 end-to-end tests using `node:test` + Supertest against a live Docker-backed stack.

---

## Architecture

Queuebit is a classic **producer–queue–consumer** system with MongoDB as the system of record and Redis as the transport layer for BullMQ and Socket.IO.

```
                        ┌──────────────────────────────────────────────────────┐
                        │                Express API (server.js)               │
                        │   port 3000                                          │
  ┌────────────┐        │                                                      │
  │   Client   │        │   GET  /                 (welcome payload)           │
  │ (CLI / any)│───────▶│   GET  /health           (mongo + redis status)      │
  └────────────┘        │   POST /api/upload       (multipart, Multer)  ──┐    │
       │    ▲           │   GET  /api/job/:id      (job lookup)           │    │
       │    │           │   Socket.IO server  (relays job_updated)        │    │
       │    │ poll      └──────────────┬──────────────────┬───────────────┘    │
       │    │ 2s                       │  MongoDB         │ Redis              │
       │    │                          ▼                  ▼                    │
       │    │                  ┌──────────────┐   ┌────────────────┐            │
       │    │                  │  DocumentJob  │   │  BullMQ queue  │           │
       │    └──────────────────│  (status,     │   │ document-      │           │
       │    Socket.IO events   │   extracted)  │   │ processing-    │           │
       │                       └──────────────┘   │ queue          │            │
       │                                         └───────┬────────┘            │
       │                                                 │ consumes job        │
       │                                        ┌────────▼─────────┐           │
       │                                        │  Worker          │           │
       │                                        │  (worker.js)     │           │
       │                                        │  - read file     │           │
       │                                        │  - parse TXT/PDF │           │
       │                                        │  - LLM extract   │           │
       │                                        │  - update status │           │
       │                                        │  - delete temp   │           │
       │                                        │  - emit update   │           │
       │                                        └────────┬─────────┘           │
       │                                                 │                    │
       └─────────────────────────────────────────────────┘                    │
                                job_updated (Socket.IO) → broadcast to clients
```

### Component responsibilities

| Component        | File(s)                                   | Responsibility                                                                 |
|------------------|-------------------------------------------|--------------------------------------------------------------------------------|
| **API server**   | `server.js`, `src/routes/api.js`          | HTTP + Socket.IO host. Accepts uploads, persists jobs, serves job lookups.     |
| **Upload flow**  | `src/controllers/uploadController.js`     | Multer disk storage, validation (TXT/PDF, ≤10 MB), creates job, enqueues work. |
| **Job lookup**   | `src/controllers/jobController.js`        | `GET /api/job/:id` → returns the `DocumentJob` document (or 404).              |
| **Worker**       | `worker.js`                               | BullMQ consumer. Extracts text, calls the LLM, updates status, cleans up.      |
| **Queue**        | `src/queue/documentQueue.js`              | BullMQ `Queue` instance bound to Redis.                                        |
| **Config**       | `src/config/db.js`, `src/config/redis.js` | MongoDB (Mongoose) and Redis (ioredis) connection managers.                    |
| **Model**        | `src/models/DocumentJob.js`               | Mongoose schema + indexes for jobs.                                            |
| **CLI**          | `cli/`                                    | Ink/React full-screen terminal UI.                                             |

---

## Tech Stack

| Layer        | Technology                                                              |
|--------------|-------------------------------------------------------------------------|
| Runtime      | Node.js 20.19+ (tested on **v24.14.0**)                                     |
| HTTP / API   | Express 5, Multer (multipart uploads)                                    |
| Queue        | BullMQ 5 (Redis-backed job queue)                                        |
| Realtime     | Socket.IO 4 / socket.io-client 4                                         |
| Database     | MongoDB 7 (Mongoose 9)                                                   |
| Cache/Queue  | Redis 7 (ioredis)                                                        |
| LLM          | OpenAI-compatible client (`openai` SDK) → **Groq** (default) or **xAI Grok** |
| CLI          | Ink 6, React 19, esbuild (bundling), Conf (local config), Axios          |
| Testing      | `node:test` (built-in), Supertest, Socket.IO client, `pdf-lib` fixtures   |
| Infra (dev)  | Docker Compose (`mongo:7`, `redis:7-alpine`)                             |

---

## Project Layout

```
Queuebit/
├── server.js                  # Express + Socket.IO API server (entry: npm start)
├── worker.js                  # BullMQ consumer / LLM extraction worker (entry: npm run worker)
├── docker-compose.yml         # Local MongoDB + Redis
├── package.json
├── .env.example               # Copy to .env and fill in secrets
├── src/
│   ├── config/
│   │   ├── db.js              # Mongoose connection manager
│   │   └── redis.js           # ioredis connection manager (shared client)
│   ├── controllers/
│   │   ├── jobController.js   # GET /api/job/:id
│   │   └── uploadController.js# Multer upload + enqueue
│   ├── models/
│   │   └── DocumentJob.js     # Mongoose schema
│   ├── queue/
│   │   └── documentQueue.js   # BullMQ queue instance
│   └── routes/
│       └── api.js             # /api/* route wiring
├── cli/
│   ├── index.js               # CLI entry (renders the TUI)
│   ├── App.js                 # TUI source (React/Ink)
│   ├── App.mjs                # esbuild bundle (built artifact)
│   ├── package.json           # separate CLI workspace
│   └── dummy.txt              # sample upload file
├── test/
│   ├── integration.test.js    # the professional integration suite
│   ├── helpers/harness.js     # spawns server + worker, helpers, metrics
│   └── fixtures/              # sample.txt, sample.pdf, malformed.pdf, generator
├── sample_contract.txt        # sample document to try out
└── test-results/metrics.json  # generated by the test suite
```

---

## How It Works

1. A client uploads a document via `POST /api/upload` (multipart, field `document`).
2. Multer validates the file (`.txt`/`.pdf`, ≤ 10 MB), stores it under `uploads/` with a UUID name, and hands it to the controller.
3. The controller creates a `DocumentJob` (status `pending`) in MongoDB and pushes a BullMQ job `{ jobId, filePath }` onto `document-processing-queue` in Redis.
4. The API responds `202 Accepted` with a `jobId` — the caller is free to poll `GET /api/job/:id` or subscribe to Socket.IO.
5. The **worker** picks up the job, flips status to `processing`, reads the file (plain text or parsed PDF), and sends the content to the configured LLM with a strict JSON-extraction prompt (`temperature 0`, JSON mode).
6. The worker persists the extracted `{ names, dates, actionItems }` back to the job document, marks it `completed`, deletes the temporary file, and emits a `job_updated` event.
7. If anything fails (unreadable file, invalid PDF, AI/parse error, timeout), the job is marked `failed` with an `errorMessage`, the temp file is cleaned up, and a failure `job_updated` event is emitted.

### Job Lifecycle

```
pending ──▶ processing ──▶ completed
              │
              └──────────▶ failed
```

- **pending** — job created and queued, awaiting a worker.
- **processing** — a worker has picked it up and is extracting/AI-processing.
- **completed** — `extractedData` is populated with the structured result.
- **failed** — `errorMessage` describes what went wrong.

### Data Model

`DocumentJob` (MongoDB collection `documentjobs`):

| Field             | Type    | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| `jobId`           | String  | UUID, unique, indexed                              |
| `status`          | String  | `pending` \| `processing` \| `completed` \| `failed`, indexed |
| `originalFileName`| String  | Name supplied by the uploader                      |
| `extractedData`   | Mixed   | `{ names: [], dates: [], actionItems: [] }` (or `null`) |
| `errorMessage`    | String  | Populated on failure                               |
| `createdAt` / `updatedAt` | Date | auto-managed, indexed                      |

---

## API Reference

Base URL: `http://localhost:3000`

### `GET /`

Welcome payload used for smoke checks.

```http
GET /
```

```json
200
{ "message": "Queuebit API is running", "status": "ok" }
```

### `GET /health`

Liveness probe that reports MongoDB and Redis connectivity.

```http
GET /health
```

```json
200
{ "status": "ok", "mongodb": "connected", "redis": "connected" }
```

### `POST /api/upload`

Uploads a document and enqueues it for processing. Multipart form, field name **`document`**.

- **Body:** `multipart/form-data`, field `document` (`.txt` or `.pdf`, ≤ 10 MB).
- **Success:** `202 Accepted` with a `jobId`.
- **Errors:**
  - `400` — no file, unsupported type (e.g. `.jpg`), or malformed request.
  - `413` — file exceeds the 10 MB limit (`code: "LIMIT_FILE_SIZE"`).

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "document=@sample_contract.txt"
```

```json
202
{ "message": "File uploaded successfully", "jobId": "fdc9a487-c6d4-4be3-aff9-6b67525d728c" }
```

### `GET /api/job/:id`

Returns the current state of a job by its `jobId`.

```bash
curl http://localhost:3000/api/job/fdc9a487-c6d4-4be3-aff9-6b67525d728c
```

```json
200
{
  "_id": "66b3...",
  "jobId": "fdc9a487-c6d4-4be3-aff9-6b67525d728c",
  "status": "completed",
  "originalFileName": "sample_contract.txt",
  "extractedData": {
    "names": ["Justin Mason", "Dr. Amelia Chen"],
    "dates": ["October 15, 2026", "December 31, 2026", "November 5, 2026"],
    "actionItems": ["Submit compliance report by Q4", "Finalize data-sharing annex before the next board meeting"]
  },
  "errorMessage": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`404` is returned for an unknown `jobId`:

```json
404
{ "error": "Job not found" }
```

---

## Real-Time Updates (Socket.IO)

The API server runs a Socket.IO server on the same HTTP port. The worker connects back to it and emits `job_updated`; the server **relays** the event to every connected client.

Event name: **`job_updated`**

```json
{
  "jobId": "fdc9a487-c6d4-4be3-aff9-6b67525d728c",
  "status": "completed",
  "extractedData": { "names": [], "dates": [], "actionItems": [] },
  "errorMessage": null
}
```

Minimal client:

```js
const { io } = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('job_updated', (data) => {
  console.log('Job', data.jobId, '→', data.status, data.extractedData ?? data.errorMessage);
});
```

---

## Command-Line Interface

The CLI is a full-screen Ink/React terminal app that wraps the REST API. It lives in its own workspace (`cli/`) and runs from any terminal.

Commands:

| Command         | Description                                                     |
|-----------------|-----------------------------------------------------------------|
| `/upload <path>`| Queue a document (TXT/PDF) and watch it complete in real time   |
| `/model <name>` | Select the LLM model (autocomplete with Tab)                    |
| `/key <key>`    | Save the API key locally (stored via `conf`)                    |
| `/clear`        | Clear the output panel                                          |
| `/exit`         | Quit the CLI                                                    |

Interaction hints: **Tab** completes, **↑/↓** navigate the dropdown, **Enter** selects, **Esc** returns from the result screen.

---

## Getting Started

### Prerequisites

- **Node.js 20.19+** (developed and tested on v24.14.0)
- **npm**
- **Docker Desktop** (for local MongoDB & Redis)
- A free **LLM API key**:
  - **Groq** (recommended default) → https://console.groq.com (keys start with `gsk_`)
  - **xAI Grok** (alternative) → https://console.x.ai (keys start with `xai-`)

### 1. Install Dependencies

```bash
# API server + worker
npm install

# CLI (separate workspace)
cd cli && npm install && cd ..
```

### 2. Start MongoDB & Redis (Docker)

```bash
docker compose up -d --wait
```

This starts `mongo:7` on `localhost:27017` and `redis:7-alpine` on `localhost:6379` with health checks and named volumes.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your API key:

```dotenv
PORT=3000
MONGO_URI=mongodb://localhost:27017/queuebit
REDIS_URI=redis://localhost:6379

# Groq (default)
AI_API_KEY=gsk_your_groq_key
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile

# --- or xAI Grok (alternative) ---
# AI_API_KEY=xai_your_xai_key
# AI_BASE_URL=https://api.x.ai/v1
# AI_MODEL=grok-3

SOCKET_SERVER_URL=http://localhost:3000
```

> Any OpenAI-compatible endpoint works — swap `AI_BASE_URL` + `AI_MODEL` to change providers.

### 4. Run the API Server

```bash
npm run dev        # or: npm start
```

```
Server running on port 3000
Environment: development
```

### 5. Run the Worker

In a **second** terminal:

```bash
npm run worker
```

```
Worker started, waiting for jobs...
```

### 6. Run the CLI

In a **third** terminal:

```bash
cd cli
npm run build     # bundles the TUI (only needed after editing App.js)
npm start
```

Inside the CLI:

```
/key gsk_your_groq_key
/upload sample_contract.txt
```

You'll see the job uploaded, processed (spinner), and the extracted JSON displayed — then press **Esc** to return.

---

## Running the Tests

The suite is a set of **12 end-to-end integration tests** that exercise the real system: it boots the actual `server.js` and `worker.js` against the Dockerized MongoDB + Redis, uploads real fixture files, and calls the **real LLM** (Groq).

```bash
npm test
```

Requires:
- Docker containers running (`docker compose up -d --wait`)
- `AI_API_KEY` set in `.env`

Test coverage:

| Suite                    | What it verifies                                                            |
|--------------------------|-----------------------------------------------------------------------------|
| **Liveness & health**    | `GET /` and `GET /health` return correct payloads; Mongo + Redis connected   |
| **Upload API**           | `202` for valid TXT/PDF; `400` for missing file / bad type; `413` for >10 MB |
| **Job lifecycle**        | TXT → `completed` with correct `names/dates/actionItems`; PDF → `completed`; malformed PDF → `failed` with message; unknown id → `404`; temp files deleted after processing |
| **Real-time updates**    | Socket.IO `job_updated` event delivered on completion                        |

The harness (`test/helpers/harness.js`) spawns both processes on port `3100`, waits for readiness, measures per-job timings, and writes `test-results/metrics.json`.

---

## Test Results & Metrics

**Run date:** 2026-08-13 · **Environment:** Windows 11 (`10.0.26200`), Node `v24.14.0`, Docker Mongo 7 / Redis 7 · **Model:** `llama-3.3-70b-versatile` (Groq, JSON mode, temp 0)

**Result: ✅ 12 / 12 tests passed** (0 failed, 0 skipped)

### Per-upload metrics

| Fixture                        | Result      | Upload (ms) | Queue wait (ms) | Processing (ms) | End-to-end (ms) | Error                        |
|--------------------------------|-------------|-------------|-----------------|-----------------|-----------------|------------------------------|
| `sample.txt`                   | completed   | 11          | 1986            | 221             | 2207            | –                            |
| `sample.pdf`                   | completed   | 7           | 4               | 409             | 413             | –                            |
| `malformed.pdf`                | failed      | 7           | –               | –               | 213             | `Invalid PDF structure.`     |
| `sample.txt` (socket listener) | completed   | 6           | 11              | 429             | 440             | –                            |

### Summary

| Metric                    | Value                    |
|---------------------------|--------------------------|
| Total uploads             | 4                        |
| Completed                 | 3                        |
| Failed (expected)         | 1                        |
| Avg upload latency        | **8 ms**                 |
| Avg processing time       | **353 ms**               |
| Avg end-to-end latency    | **1020 ms**              |
| Throughput (this run)     | **53 jobs/min**          |
| Suite duration            | ~4.5 s                   |
| Socket.IO events received | 1/1                      |

> The first TXT job shows a ~2 s queue wait — that is worker cold start (BullMQ + DB + AI client initialization). Subsequent jobs are picked up in ~4–11 ms. The malformed PDF fails so fast (during parsing, before the AI stage) that the intermediate `processing` transition is never observed by the 200 ms poller, hence the `–` entries.

Raw output is persisted to `test-results/metrics.json` on every run.

---

## Bugs Found & Fixed During Development

Getting the local stack and the test suite green surfaced **five real bugs**, all fixed:

1. **Redis TLS applied unconditionally** — `worker.js` and `documentQueue.js` passed `tls: { rejectUnauthorized: false }` for every Redis URL, so plain `redis://` connections attempted a TLS handshake and **hung forever** (`queue.add()` never resolved). TLS is now enabled only for `rediss://` URLs.
2. **`pdf-parse` v2 API change** — the worker used the v1 call signature (`pdfParse(buffer)`), which silently broke PDF extraction. Migrated to the v2 `PDFParse` class (`new PDFParse({ data })` → `getText()`).
3. **Socket.IO events dropped server-side** — `server.js` created the Socket.IO server but never handled/relayed `job_updated`, so worker emissions never reached clients. Added a connection handler that broadcasts the event.
4. **Multer errors returned HTML 500** — oversized/invalid uploads surfaced as opaque HTML errors. Added an error-handling middleware that returns clean JSON (`400` / `413` with error code).
5. **Missing `uploads/` directory** — Multer's disk storage failed if the directory didn't exist. It is now created automatically at server startup (and git-ignored).

---

## Error Handling & Failure Modes

| Scenario                          | Behavior                                                              |
|-----------------------------------|-----------------------------------------------------------------------|
| No file on upload                 | `400 { error: "No file uploaded" }`                                   |
| Unsupported file type             | `400 { error: "Invalid file type. Only PDF and text files are allowed." }` |
| File > 10 MB                      | `413 { code: "LIMIT_FILE_SIZE" }`                                     |
| Unknown job id                    | `404 { error: "Job not found" }`                                      |
| Malformed / unreadable PDF        | Job → `failed`, `errorMessage` = parser error, temp file deleted      |
| LLM timeout / parse failure       | Job → `failed`, `errorMessage` set, temp file deleted                 |
| MongoDB / Redis down at boot      | Server logs the error and continues; `/health` reports `disconnected` |
| `SIGINT` / `SIGTERM`              | Graceful shutdown: HTTP server closes, DB + Redis disconnected, forced exit after 10 s |

---

## Limitations & Future Work

- **Single worker by default** — jobs are processed serially. Scale by setting BullMQ concurrency or launching multiple worker instances (the queue is already distributed-safe).
- **No authentication** — the API and Socket.IO use wide-open CORS; intended for local/demo use. Add API-key or JWT auth for production.
- **TXT/PDF only** — DOCX/XLSX/image OCR would require additional extractors.
- **CLI model selector is cosmetic** — the CLI sends `X-Model`/`model`, but the server currently uses `AI_MODEL` from env. Wire the header through to make it functional.
- **Extraction quality** — JSON-mode LLM extraction is best-effort; consider adding schema validation and retries.
- **Observability** — no structured logging or metrics endpoint yet; consider adding Prometheus or OpenTelemetry.
- **CI** — the suite is ready to run in GitHub Actions with a service container; only the LLM key needs to be an action secret.

---

## License

[ISC](./LICENSE)
