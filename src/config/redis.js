const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazy: true,
});

redisClient.on('error', () => {});

const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.log('Redis not available, continuing without it');
  }
};

module.exports = { redisClient, connectRedis };