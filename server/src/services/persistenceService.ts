import prisma from './prismaClient';
import { Prisma } from '@prisma/client';
import { redisClient } from './redisClient';

export interface FinalScore {
    id: string;
    score: number;
}

export class PersistenceService {
    async flushGameToPostgres(roomCode: string, finalScores?: FinalScore[]) {
        const data = await redisClient.fetchRoomDataForFlush(roomCode);

        const scoreMap = new Map<string, number>();
        if (finalScores) {
            for (const s of finalScores) {
                scoreMap.set(s.id, s.score);
            }
        }

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const game = await tx.game.create({
                data: {
                    roomCode: data.meta.roomCode,
                    maxRounds: data.meta.maxRounds,
                    drawTimeSecs: data.meta.drawTimeSecs,
                    startedAt: new Date(data.meta.startedAt),
                    endedAt: new Date(),
                },
            });

            const participantMap = new Map<string, string>();

            for (const p of data.participants) {
                const score = scoreMap.get(p.playerId) ?? 0;
                const createdParticipant = await tx.gameParticipant.create({
                    data: {
                        gameId: game.id,
                        userId: p.userId,
                        displayName: p.displayName,
                        finalScore: score,
                    },
                });
                participantMap.set(p.playerId, createdParticipant.id);
            }

            for (const r of data.rounds) {
                const drawerParticipantId = participantMap.get(r.drawerPlayerId);
                if (!drawerParticipantId) {
                    console.warn(`[PersistenceService] Drawer playerId ${r.drawerPlayerId} not found in participant map.`);
                    continue;
                }

                const createdRound = await tx.round.create({
                    data: {
                        gameId: game.id,
                        roundNumber: r.roundNumber,
                        drawerParticipantId: drawerParticipantId,
                        word: r.word,
                        startedAt: new Date(r.startedAt),
                        endedAt: new Date(r.endedAt),
                    },
                });

                const roundGuesses = data.guesses.filter(g => g.roundNumber === r.roundNumber);

                for (const g of roundGuesses) {
                    const participantId = participantMap.get(g.playerId);
                    if (!participantId) continue;

                    await tx.guess.create({
                        data: {
                            roundId: createdRound.id,
                            participantId: participantId,
                            guess: g.guess,
                            correct: g.correct,
                            timeTakenMs: g.timeTakenMs,
                            guessedAt: new Date(g.guessedAt),
                        },
                    });
                }
            }
        });

        console.log(`[PersistenceService] Successfully flushed room ${roomCode} to Postgres.`);

        await redisClient.expireRoomKeys(roomCode).catch(err =>
            console.error(`[PersistenceService] Failed to set TTL on Redis keys for room ${roomCode}:`, err)
        );
    }
}

export const persistenceService = new PersistenceService();
