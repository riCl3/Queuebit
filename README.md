# Queuebit

A real-time document processing pipeline powered by AI. Upload PDF or text files, queue them for intelligent extraction, and receive results instantly — all from a terminal UI.

## Why This Exists

I built Queuebit to solve a real problem: extracting structured data from documents without manual effort. It's production-grade, not a tutorial project. If you're looking for someone who ships working systems, Please reach out here **soumraric2@gmail.com**, I'm always open to the right opportunity.

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   CLI (Ink) │────▶│  Express Server  │────▶│  BullMQ Queue│
│  React TUI  │     │  (API + Socket)  │     │  (Redis)     │
└─────────────┘     └──────────────────┘     └──────┬───────┘
       ▲                                            │
       │                                            ▼
       │                                    ┌──────────────┐
       │                                    │    Worker     │
       │                                    │  (AI Processing)
       │                                    └──────┬───────┘
       │                                           │
       │                    ┌──────────────────────┼──────────────┐
       │                    ▼                      ▼              ▼
       │             ┌──────────┐          ┌──────────┐   ┌──────────┐
       │             │ MongoDB  │          │ Google   │   │  File    │
       └─────────────│(Results) │          │ Gemini   │   │  System  │
                     └──────────┘          └──────────┘   └──────────┘
```

### Implementation Pattern

Queuebit follows a **Producer-Consumer** architecture with real-time event broadcasting:

1. **Producer** — The Express server receives uploads, validates files, persists job records to MongoDB, and enqueues tasks into BullMQ (backed by Redis).
2. **Consumer** — A standalone worker process pulls jobs from the queue, reads file content, calls the Google Gemini AI API for extraction, and updates the job status.
3. **Event Bus** — Socket.IO broadcasts job state changes (`pending` → `processing` → `completed`/`failed`) to all connected clients in real time.
4. **CLI** — An Ink-based React terminal UI handles uploads, subscribes to job updates, and renders results.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js |
| **API Server** | Express 5, Socket.IO |
| **Queue** | BullMQ 5, ioredis |
| **Database** | MongoDB, Mongoose |
| **CLI** | Ink 6 (React for terminal), esbuild |
| **AI** | Google GenAI SDK (Gemini models) |
| **File Upload** | Multer |
| **Environment** | dotenv |
| **Rate Limiting** | express-rate-limit |
| **PDF Parsing** | pdf-parse |

---

## Project Structure

```
Queuebit/
├── server.js                          # Express + Socket.IO API server
├── worker.js                          # BullMQ worker (AI processing)
├── package.json                       # Root dependencies
├── .env                               # Environment configuration
│
├── src/
│   ├── config/
│   │   ├── db.js                      # MongoDB connection
│   │   └── redis.js                   # Redis connection
│   ├── controllers/
│   │   ├── uploadController.js        # File upload, validation, queueing
│   │   └── jobController.js           # Job status lookup
│   ├── middleware/
│   │   ├── auth.js                    # API key validation
│   │   └── rateLimiter.js             # Rate limiting on uploads
│   ├── models/
│   │   └── DocumentJob.js             # Mongoose job schema
│   ├── queue/
│   │   └── documentQueue.js           # BullMQ queue definition
│   └── routes/
│       └── api.js                     # API route definitions
│
├── cli/
│   ├── index.js                       # CLI entry point
│   ├── App.js                         # React TUI component (source)
│   ├── App.mjs                        # Bundled output (esbuild)
│   └── package.json                   # CLI dependencies
│
├── uploads/                           # Temporary file storage
└── sample_contract.txt                # Sample input file
```

---

## How It Works

### Upload Flow

1. User runs `/upload <path>` in the CLI
2. CLI sends multipart form data to `POST /api/upload`
3. Server validates file type (PDF/TXT) and content (spoofing detection)
4. A `DocumentJob` record is created in MongoDB with status `pending`
5. Job is added to BullMQ with exponential backoff retries (3 attempts)
6. Server returns `jobId` to the CLI

### Processing Flow

1. Worker picks up the job from the queue
2. Reads file content (UTF-8 for `.txt`, parsed text for `.pdf`)
3. Sends content to Google Gemini AI with a structured extraction prompt
4. Parses the AI's JSON response (names, dates, action items)
5. Updates the `DocumentJob` record to `completed` with extracted data
6. Emits a `job_updated` Socket.IO event
7. Deletes the uploaded file from disk

### Real-Time Updates

The CLI connects to the server via WebSocket. When the worker finishes (or fails), the server broadcasts the result. The CLI receives it and renders the output instantly — no polling.

---

## Supported Models

- `gemini-2.0-flash`
- `gemini-2.0-flash-lite`
- `gemini-1.5-flash`
- `gemini-2.5-flash`

---

## Getting Started

### Prerequisites

- Node.js 18+
- Redis (local or remote)
- MongoDB (local or Atlas)
- Google Gemini API key

### Environment Variables

Create a `.env` file:

```env
PORT=3000
REDIS_URI=redis://localhost:6379
MONGO_URI=mongodb://localhost:27017/queuebit
GEMINI_API_KEY=your-google-ai-api-key
SOCKET_SERVER_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
```

### Install Dependencies

```bash
npm install
cd cli && npm install && cd ..
```

### Run the Server

```bash
npm start
```

### Run the Worker

```bash
npm run worker
```

### Run the CLI

```bash
cd cli && npm start
```

### CLI Commands

| Command | Description |
|---|---|
| `/upload <path>` | Upload and process a file |
| `/model <name>` | Switch AI model |
| `/key <key>` | Set API key |
| `/clear` | Clear terminal output |
| `/exit` | Exit the CLI |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload a document for processing |
| `GET` | `/api/jobs/:jobId` | Get job status by ID |
| `GET` | `/health` | Server health check |
| `GET` | `/` | API status |

---

## Features

- **Real-time updates** via Socket.IO — no polling
- **Retry with backoff** — failed jobs retry up to 3 times with exponential delay
- **File validation** — content-level spoofing detection for PDF and TXT
- **Rate limiting** — protects against abuse
- **Graceful shutdown** — clean disconnect of MongoDB, Redis, and Socket connections
- **TTL indexes** — MongoDB auto-cleans job records after 30 days
- **Structured extraction** — names, dates, and action items in strict JSON
