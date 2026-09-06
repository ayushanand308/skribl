import { Queue, ConnectionOptions } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

export const bullMQConnection: ConnectionOptions = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || '6379'),
    password: redisUrl.password || undefined,
};

export const FLUSH_QUEUE_NAME = 'flush-game';

export const flushQueue = new Queue(FLUSH_QUEUE_NAME, {
    connection: bullMQConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 2000, 
        },
        removeOnComplete: true,  
        removeOnFail: 100,
    },
});

flushQueue.on('error', (err) => {
    console.error('[FlushQueue] Queue connection error:', err.message);
});
