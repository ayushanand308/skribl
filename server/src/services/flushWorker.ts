import { Worker, Job } from 'bullmq';
import { persistenceService, FinalScore } from './persistenceService';
import { bullMQConnection, FLUSH_QUEUE_NAME } from './flushQueue';

interface FlushJobData {
    roomCode: string;
    finalScores: FinalScore[];
    enqueuedAt: number;
}

export function startFlushWorker() {
    const worker = new Worker<FlushJobData>(
        FLUSH_QUEUE_NAME,
        async (job: Job<FlushJobData>) => {
            const { roomCode, finalScores } = job.data;
            console.log(`[FlushWorker] Processing flush for room ${roomCode} (attempt ${job.attemptsMade + 1})`);
            await persistenceService.flushGameToPostgres(roomCode, finalScores);
            console.log(`[FlushWorker] Successfully flushed room ${roomCode} to Postgres.`);
        },
        {
            connection: bullMQConnection,
            concurrency: 3,
        }
    );

    worker.on('completed', (job: Job) => {
        console.log(`[FlushWorker] Job ${job.id} completed for room ${job.data.roomCode}.`);
    });

    worker.on('failed', (job: Job | undefined, err: Error) => {
        if (job) {
            const maxAttempts = job.opts?.attempts ?? 5;
            console.error(
                `[FlushWorker] Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}):`,
                err.message
            );
            if (job.attemptsMade >= maxAttempts) {
                console.error(`[FlushWorker] Job ${job.id} exhausted all retries. Room ${job.data.roomCode} data is permanently lost.`);
            }
        }
    });

    worker.on('error', (err: Error) => {
        console.error('[FlushWorker] Worker connection error:', err.message);
    });

    console.log('[FlushWorker] Started — listening for flush jobs.');
    return worker;
}
