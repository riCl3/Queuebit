const { Queue } = require('bullmq');
const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

const redisURI = process.env.REDIS_URI;
const isSSL = redisURI.startsWith('rediss://');

const connection = new Redis(redisURI, {
  maxRetriesPerRequest: null,
  tls: isSSL ? {} : undefined
});

connection.on('error', (err) => {
  console.error('Queue Redis connection error:', err);
});

connection.on('connect', () => {
  console.log('Queue Redis connected');
});

const documentQueue = new Queue('document-processing-queue', { connection });

documentQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

module.exports = documentQueue;
