import { Queue } from 'bullmq';
import { bullMQConnection } from './flushQueue';

export { bullMQConnection };

export const TIMER_QUEUE_NAME = 'turn-timer';

export const timerQueue = new Queue(TIMER_QUEUE_NAME, {
    connection: bullMQConnection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
    },
});

timerQueue.on('error', (err) => {
    console.error('[TimerQueue] Queue connection error:', err.message);
});
