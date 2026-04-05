const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { io } = require('socket.io-client');

const DocumentJob = require('./src/models/DocumentJob');

dotenv.config();

const QUEUE_NAME = 'document-processing-queue';

const redisURI = process.env.REDIS_URI;
const isSSL = redisURI.startsWith('rediss://');

const connection = new Redis(redisURI, {
  maxRetriesPerRequest: null,
  tls: isSSL ? {} : undefined
});

connection.on('connect', () => {
  console.log('Worker Redis connected');
});

connection.on('error', (err) => {
  console.error('Worker Redis error:', err);
});

const socketClient = io(process.env.SOCKET_SERVER_URL || 'http://localhost:3000', {
  transports: ['websocket'],
  reconnection: true
});

socketClient.on('connect', () => {
  console.log('Worker socket connected to server');
});

socketClient.on('disconnect', () => {
  console.log('Worker socket disconnected');
});

socketClient.on('connect_error', (err) => {
  console.error('Worker socket connection error:', err.message);
});

const getAIClient = async (apiKey) => {
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
};

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
  });

  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
    });
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (err) {
    console.error('Error closing MongoDB connection:', err.message);
  }
};

const extractDocumentData = async (filePath, apiKey, model) => {
  const ext = path.extname(filePath).toLowerCase();
  let content;

  if (ext === '.txt') {
    content = await fs.readFile(filePath, 'utf-8');
  } else if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const pdfBuffer = await fs.readFile(filePath);
    const pdfData = await pdfParse(pdfBuffer);
    content = pdfData.text;
  } else {
    throw new Error('Unsupported file type');
  }

  const aiModel = model || 'gemini-3-flash-preview';

  const prompt = `Extract all names, dates, and key action items from the following text content. Return ONLY a strict JSON object with no additional text. The JSON should have this structure: {"names": [], "dates": [], "actionItems": []}. If no data is found for a category, return an empty array.

Text content:
${content}`;

  const aiClient = await getAIClient(apiKey);

  const timeoutMs = 30000;
  const result = await Promise.race([
    aiClient.models.generateContent({
      model: aiModel,
      contents: prompt
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('AI call timed out')), timeoutMs))
  ]);
  const text = result.text;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Failed to parse AI response as JSON');
  } catch (parseError) {
    console.error('JSON parse error:', parseError.message);
    console.error('Raw response:', text);
    throw new Error('Failed to parse AI response as JSON');
  }
};

const deleteFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
    console.log(`Deleted file: ${filePath}`);
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
};

const emitJobUpdate = (jobId, status, extractedData = null, errorMessage = null) => {
  socketClient.emit('job_updated', { jobId, status, extractedData, errorMessage });
};

let worker;

const startWorker = async () => {
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`Processing job: ${job.id}`, job.data);

      await DocumentJob.findOneAndUpdate(
        { jobId: job.data.jobId },
        { status: 'processing' }
      );

      try {
        const extractedData = await extractDocumentData(job.data.filePath, job.data.apiKey, job.data.model);

        await DocumentJob.findOneAndUpdate(
          { jobId: job.data.jobId },
          {
            status: 'completed',
            extractedData
          }
        );

        await deleteFile(job.data.filePath);

        await emitJobUpdate(job.data.jobId, 'completed', extractedData);

        console.log(`Job ${job.id} completed successfully`);
      } catch (error) {
        console.error(`Job ${job.id} failed:`, error.message);

        await DocumentJob.findOneAndUpdate(
          { jobId: job.data.jobId },
          {
            status: 'failed',
            errorMessage: error.message
          }
        );

        await deleteFile(job.data.filePath);

        await emitJobUpdate(job.data.jobId, 'failed', null, error.message);
      }
    },
    { connection }
  );

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} has completed!`);
  });

  worker.on('failed', (job, err) => {
    console.log(`Job ${job.id} has failed with ${err.message}`);
  });
};

let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  if (worker) {
    await worker.close();
    console.log('BullMQ worker closed');
  }
  
  try {
    await disconnectDB();
  } catch (err) {
    console.error('Error disconnecting MongoDB:', err.message);
  }
  
  try {
    if (connection) {
      await connection.quit();
      console.log('Redis connection closed');
    }
  } catch (err) {
    console.error('Error closing Redis connection:', err.message);
  }
  
  if (socketClient) {
    socketClient.disconnect();
    console.log('Socket client disconnected');
  }
  
  console.log('Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const start = async () => {
  try {
    await connectDB();
    await startWorker();
    console.log('Worker started, waiting for jobs...');
  } catch (err) {
    console.error('Failed to start worker:', err);
    process.exit(1);
  }
};

start();
