const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

let redisOptions;
if (process.env.REDIS_URI) {
  const redisURI = process.env.REDIS_URI;
  const isSSL = redisURI.startsWith('rediss://');
  const url = new URL(redisURI);
  redisOptions = {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password,
    tls: isSSL ? { rejectUnauthorized: false } : undefined
  };
} else {
  redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || ''
  };
}

const redisClient = new Redis({
  ...redisOptions,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err.message);
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

const connectRedis = async () => {
  await new Promise((resolve) => {
    if (redisClient.status === 'ready') {
      resolve();
    } else {
      redisClient.once('ready', resolve);
      redisClient.once('error', (err) => {
        console.error('Redis connection error:', err.message);
        resolve();
      });
    }
  });
  console.log('Redis ready');
};

const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    console.log('Redis connection closed');
  } catch (err) {
    console.error('Error closing Redis connection:', err.message);
  }
};

module.exports = { redisClient, connectRedis, disconnectRedis, redisOptions };
