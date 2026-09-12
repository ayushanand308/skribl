import { Worker, Job } from 'bullmq';
import { bullMQConnection, TIMER_QUEUE_NAME } from './timerQueue';
import RoomManager from './roomManager';
import { redisClient } from './redisClient';
import { WordBank } from '../game/wordBank';
import { getIO } from './socketService';

interface TimerJobData {
    roomCode: string;
    round: number;
    type?: 'pick' | 'draw' | 'afk-check';
}

export function startTimerWorker() {
    const worker = new Worker<TimerJobData>(
        TIMER_QUEUE_NAME,
        async (job: Job<TimerJobData>) => {
            const { roomCode, round } = job.data;
            console.log(`[TimerWorker] Turn timer fired for room ${roomCode}, round ${round}`);

            const isPickTimer = job.data.type === 'pick';
            const isAfkCheck = job.data.type === 'afk-check';
            const expectedState = isPickTimer ? 'PICK_WORD' : 'DRAW';
            const currentState = await redisClient.getRoomState(roomCode);
            if (currentState !== expectedState) {
                console.log(`[TimerWorker] Room ${roomCode} is in state '${currentState}', not ${expectedState} — skipping.`);
                return;
            }


            const room = await RoomManager.getRoom(roomCode);
            if (!room) {
                console.error(`[TimerWorker] Room ${roomCode} not found even after Redis lookup — skipping.`);
                return;
            }

            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            await room.syncTurnStateFromRedis();

            if (room.currentRound !== round) {
                console.log(`[TimerWorker] Round mismatch for room ${roomCode}: timer for round ${round}, current is ${room.currentRound} — skipping.`);
                return;
            }
            const localState = room.machine.getState();
            
            if (isPickTimer) {
                if (localState !== 'PICK_WORD') {
                    console.log(`[TimerWorker] Local state mismatch after Redis sync (expected PICK_WORD): ${localState} — skipping.`);
                    return;
                }
                console.log(`[TimerWorker] Pick timer expired for room ${roomCode}. Auto-picking word.`);
                const words = await redisClient.getPickWords(roomCode);
                const choosenWord = words ? words[0] : WordBank.getRandomWords(1, room.customWords, room.customWordsOnly, room.usedWords)[0];
                
                await room.startRoundTimer(choosenWord);
                await room.machine.dispatch('WORD_PICKED');
                
                const wordHint = String(choosenWord).split('').map((char: string) => char === ' ' ? ' ' : '_').join(' ');
                const drawerSocketId = room?.drawer?.socketId;
                const basePayload = { 
                    roomCode, 
                    wordHint,
                    drawerId: room?.drawer?.id,
                    timeLeft: room?.drawTime,
                    round: room?.currentRound,
                    maxRounds: room?.maxRounds,
                    players: room?.players,
                    settings: { drawTime: room?.drawTime, rounds: room?.maxRounds, maxPlayers: room?.maxPlayers },
                };

                const io = getIO();
                if (drawerSocketId) {
                    io.to(roomCode).except(drawerSocketId).emit("round-started", basePayload);
                    io.to(drawerSocketId).emit("round-started", {
                        ...basePayload,
                        fullWord: choosenWord,
                    });
                } else {
                    io.to(roomCode).emit("round-started", basePayload);
                }
                return;
            }

            if (localState !== 'DRAW') {
                console.log(`[TimerWorker] Local state mismatch after Redis sync (expected DRAW): ${localState} — skipping.`);
                return;
            }

            if (isAfkCheck) {
                const strokes = await redisClient.getStrokesFromRedis(roomCode);
                if (!strokes || strokes.length === 0) {
                    console.log(`[TimerWorker] AFK check failed for room ${roomCode}. No strokes found in first 15s. Skipping drawer.`);
                    if (room.drawer) {
                        await redisClient.updatePlayerAFKInRedis(roomCode, room.drawer.id, true);
                        const io = getIO();
                        io.to(roomCode).emit('chat-message', {
                            sender: 'System',
                            message: `>> ${room.drawer.name} was skipped due to inactivity! <<`
                        });
                        io.to(room.drawer.socketId || "").emit('afk-status', { isAfk: true });
                    }
                    await room.endTurn(true);
                }
                return;
            }

            await room.machine.dispatch('GUESS_TIMER_EXPIRED');
            await room.endTurn(false);
        },
        {
            connection: bullMQConnection,
            concurrency: 5,
        }
    );

    worker.on('completed', (job: Job) => {
        console.log(`[TimerWorker] Job ${job.id} completed for room ${job.data.roomCode}.`);
    });

    worker.on('failed', (job: Job | undefined, err: Error) => {
        if (job) {
            console.error(`[TimerWorker] Job ${job.id} failed for room ${job.data.roomCode}:`, err.message);
        }
    });

    worker.on('error', (err: Error) => {
        console.error('[TimerWorker] Worker connection error:', err.message);
    });

    console.log('[TimerWorker] Started — listening for turn timer jobs.');
    return worker;
}
