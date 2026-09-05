import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export class RedisClient extends EventEmitter {
    private client: Redis;
    public isHealthy: boolean = false;

    constructor() {
        super();
        this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

        this.client.on('error', (err) => {
            console.error('[RedisClient] Connection error:', err.message);
            if (this.isHealthy) {
                this.isHealthy = false;
                this.emit('status_changed', false); 
            }
        });

        this.client.on('ready', () => {
            console.log('[RedisClient] Connection ready');
            if (!this.isHealthy) {
                this.isHealthy = true;
                this.emit('status_changed', true); 
            }
        });

        const luaScript = fs.readFileSync(
            path.join(__dirname, '../scripts/record_guess.lua'),
            'utf8'
        );
        this.client.defineCommand('recordGuess', {
            numberOfKeys: 1,
            lua: luaScript,
        });
    }

    getClient(): Redis {
        return this.client;
    }

    async safeRedisCall<T>(operation: () => Promise<T>, fallback: T, context: string): Promise<T> {
        if (!this.isHealthy) return fallback;
        try {
            return await operation();
        } catch (err) {
            console.error(`[RedisClient] Call failed in context "${context}":`, (err as Error).message);
            return fallback;
        }
    }

    async recordGuess(roomCode: string, playerId: string, timeElapsed: number, totalPlayers: number): Promise<[number, number]> {
        return this.safeRedisCall(
            () => {
                const key = `room:${roomCode}:solved`;
                return (this.client as any).recordGuess(key, playerId, timeElapsed, totalPlayers);
            },
            [0, 0] as [number, number],
            'recordGuess'
        );
    }

    async clearSolvedSet(roomCode: string): Promise<void> {
        return this.safeRedisCall(
            () => this.client.del(`room:${roomCode}:solved`).then(() => {}),
            undefined,
            'clearSolvedSet'
        );
    }

    disconnect() {
        this.client.disconnect();
    }

    async setRoomState(roomCode: string, state: string): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hset(`room:${roomCode}:meta`, 'state', state);
                await this.client.set(`room:${roomCode}:state`, state);
            },
            undefined,
            'setRoomState'
        );
    }

    async getRoomState(roomCode: string): Promise<string | null> {
        return this.safeRedisCall(
            async () => {
                const state = await this.client.get(`room:${roomCode}:state`);
                if (state) return state;
                return await this.client.hget(`room:${roomCode}:meta`, 'state');
            },
            null,
            'getRoomState'
        );
    }

    async addPlayerToRedis(roomCode: string, player: { id: string; socketId: string; name: string; score: number; avatar?: string }): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hset(`room:${roomCode}:players`, player.id, JSON.stringify(player));
            },
            undefined,
            'addPlayerToRedis'
        );
    }

    async removePlayerFromRedis(roomCode: string, playerId: string): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hdel(`room:${roomCode}:players`, playerId);
            },
            undefined,
            'removePlayerFromRedis'
        );
    }

    async getPlayersFromRedis(roomCode: string): Promise<{ id: string; socketId: string; name: string; score: number; avatar?: string }[]> {
        return this.safeRedisCall(
            async () => {
                const rawMap = await this.client.hgetall(`room:${roomCode}:players`);
                if (!rawMap) return [];
                return Object.values(rawMap).map(jsonStr => JSON.parse(jsonStr));
            },
            [],
            'getPlayersFromRedis'
        );
    }

    async updatePlayerScoreInRedis(roomCode: string, playerId: string, newScore: number): Promise<void> {
        return this.safeRedisCall(
            async () => {
                const playerJson = await this.client.hget(`room:${roomCode}:players`, playerId);
                if (playerJson) {
                    const p = JSON.parse(playerJson);
                    p.score = newScore;
                    await this.client.hset(`room:${roomCode}:players`, playerId, JSON.stringify(p));
                }
            },
            undefined,
            'updatePlayerScoreInRedis'
        );
    }
    async updatePlayerSocketIdInRedis(roomCode: string, playerId: string, newSocketId: string): Promise<void> {
        return this.safeRedisCall(
            async () => {
                const playerJson = await this.client.hget(`room:${roomCode}:players`, playerId);
                if (playerJson) {
                    const p = JSON.parse(playerJson);
                    p.socketId = newSocketId;
                    await this.client.hset(`room:${roomCode}:players`, playerId, JSON.stringify(p));
                }
            },
            undefined,
            'updatePlayerSocketIdInRedis'
        );
    }

    async setTurnDataInRedis(roomCode: string, word: string, drawerId: string, roundStartTime: number): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hset(`room:${roomCode}:meta`, {
                    word,
                    drawerId,
                    roundStartTime,
                    turnTotalScore: 0
                });
            },
            undefined,
            'setTurnDataInRedis'
        );
    }

    async setPickWords(roomCode: string, words: string[]): Promise<void> {
        return this.safeRedisCall(async () => {
            await this.client.setex(`room:${roomCode}:pick_words`, 20, JSON.stringify(words));
        }, undefined, 'setPickWords');
    }

    async getPickWords(roomCode: string): Promise<string[] | null> {
        return this.safeRedisCall(async () => {
            const raw = await this.client.get(`room:${roomCode}:pick_words`);
            return raw ? JSON.parse(raw) : null;
        }, null, 'getPickWords');
    }

    async setRoomTurnState(roomCode: string, currentPlayer: number, currentRound: number, drawerId: string | undefined): Promise<void> {
        return this.safeRedisCall(async () => {
            await this.client.hset(`room:${roomCode}:meta`, {
                currentPlayer,
                currentRound,
                drawerId: drawerId || ''
            });
        }, undefined, 'setRoomTurnState');
    }

    async getRoomTurnState(roomCode: string): Promise<{ currentPlayer: number; currentRound: number; drawerId: string } | null> {
        return this.safeRedisCall(async () => {
            const raw = await this.client.hgetall(`room:${roomCode}:meta`);
            if (raw && raw.currentPlayer != null) {
                return {
                    currentPlayer: Number(raw.currentPlayer),
                    currentRound: Number(raw.currentRound),
                    drawerId: raw.drawerId
                };
            }
            return null;
        }, null, 'getRoomTurnState');
    }

    async appendStrokeToRedis(roomCode: string, stroke: any): Promise<void> {
        return this.safeRedisCall(async () => {
            await this.client.rpush(`room:${roomCode}:strokes`, JSON.stringify(stroke));
        }, undefined, 'appendStrokeToRedis');
    }

    async getStrokesFromRedis(roomCode: string): Promise<any[]> {
        return this.safeRedisCall(async () => {
            const raw = await this.client.lrange(`room:${roomCode}:strokes`, 0, -1);
            return raw ? raw.map((r: string) => JSON.parse(r)) : [];
        }, [], 'getStrokesFromRedis');
    }

    async clearStrokesInRedis(roomCode: string): Promise<void> {
        return this.safeRedisCall(async () => {
            await this.client.del(`room:${roomCode}:strokes`);
        }, undefined, 'clearStrokesInRedis');
    }

    async addTurnScoreInRedis(roomCode: string, score: number): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hincrby(`room:${roomCode}:meta`, 'turnTotalScore', score);
            },
            undefined,
            'addTurnScoreInRedis'
        );
    }

    async getTurnDataFromRedis(roomCode: string): Promise<{ word: string | null; drawerId: string | null; roundStartTime: number | null; turnTotalScore: number }> {
        return this.safeRedisCall(
            async () => {
                const [word, drawerId, roundStartTimeStr, turnTotalScoreStr] = await this.client.hmget(
                    `room:${roomCode}:meta`,
                    'word',
                    'drawerId',
                    'roundStartTime',
                    'turnTotalScore'
                );
                return {
                    word: word || null,
                    drawerId: drawerId || null,
                    roundStartTime: roundStartTimeStr ? Number(roundStartTimeStr) : null,
                    turnTotalScore: turnTotalScoreStr ? Number(turnTotalScoreStr) : 0
                };
            },
            { word: null, drawerId: null, roundStartTime: null, turnTotalScore: 0 },
            'getTurnDataFromRedis'
        );
    }

    async clearTurnDataInRedis(roomCode: string): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hdel(`room:${roomCode}:meta`, 'word', 'drawerId', 'roundStartTime', 'turnTotalScore');
            },
            undefined,
            'clearTurnDataInRedis'
        );
    }

    async initRoomInRedis(
        gameMeta: { roomCode: string; maxRounds: number; drawTimeSecs: number },
        gameParticipants: { playerId: string; userId: string | null; displayName: string }[]
    ) {
        return this.safeRedisCall(
            async () => {
                await this.client.hset(`room:${gameMeta.roomCode}:meta`, {
                    roomCode: gameMeta.roomCode,
                    maxRounds: gameMeta.maxRounds,
                    drawTimeSecs: gameMeta.drawTimeSecs,
                    startedAt: Date.now(),
                });
                await this.client.set(
                    `room:${gameMeta.roomCode}:participants`,
                    JSON.stringify(gameParticipants)
                );
            },
            undefined,
            'initRoomInRedis'
        );
    }

    async insertRoundData(roomCode: string, roundNumber: number, word: string, startedAt: number, endedAt: number, drawerPlayerId: string) {
        return this.safeRedisCall(
            async () => {
                const roundRecord = { roundNumber, word, startedAt, endedAt, drawerPlayerId };
                await this.client.rpush(`room:${roomCode}:rounds`, JSON.stringify(roundRecord));
            },
            undefined,
            'insertRoundData'
        );
    }

    async insertGuessData(roomCode: string, roundNumber: number, playerId: string, guess: string, correct: boolean, timeTakenMs: number) {
        return this.safeRedisCall(
            async () => {
                const guessRecord = { roundNumber, playerId, guess, correct, timeTakenMs, guessedAt: Date.now() };
                await this.client.rpush(`room:${roomCode}:guesses`, JSON.stringify(guessRecord));
            },
            undefined,
            'insertGuessData'
        );
    }

    async fetchRoomDataForFlush(roomCode: string) {
        if (!this.isHealthy) throw new Error(`[RedisClient] Cannot fetch room data, Redis is unhealthy`);

        const [metaRaw, participantsRaw, roundsRaw, guessesRaw] = await Promise.all([
            this.client.hgetall(`room:${roomCode}:meta`),
            this.client.get(`room:${roomCode}:participants`),
            this.client.lrange(`room:${roomCode}:rounds`, 0, -1),
            this.client.lrange(`room:${roomCode}:guesses`, 0, -1),
        ]);

        if (!metaRaw.maxRounds || !metaRaw.drawTimeSecs || !metaRaw.startedAt) {
            throw new Error(`[RedisClient] Cannot flush room ${roomCode}: Metadata missing or corrupted in Redis.`);
        }

        const meta = {
            roomCode,
            maxRounds: Number(metaRaw.maxRounds),
            drawTimeSecs: Number(metaRaw.drawTimeSecs),
            startedAt: Number(metaRaw.startedAt),
        };

        if (!participantsRaw) {
            throw new Error(`[RedisClient] Cannot flush room ${roomCode}: Participants data missing in Redis.`);
        }
        const participants: { playerId: string; userId: string | null; displayName: string }[] = JSON.parse(participantsRaw);
        if (participants.length === 0) {
            throw new Error(`[RedisClient] Cannot flush room ${roomCode}: Participants list is empty.`);
        }

        if (!roundsRaw || roundsRaw.length === 0) {
            throw new Error(`[RedisClient] Cannot flush room ${roomCode}: No rounds recorded for this game.`);
        }
        const rounds: { roundNumber: number; word: string; startedAt: number; endedAt: number; drawerPlayerId: string }[] =
            roundsRaw.map(r => JSON.parse(r));

        const guesses: { roundNumber: number; playerId: string; guess: string; correct: boolean; timeTakenMs: number; guessedAt: number }[] =
            guessesRaw ? guessesRaw.map(g => JSON.parse(g)) : [];

        return { meta, participants, rounds, guesses };
    }

    async expireRoomKeys(roomCode: string, ttlSeconds: number = 3600) {
        return this.safeRedisCall(
            async () => {
                const keys = [
                    `room:${roomCode}:meta`,
                    `room:${roomCode}:participants`,
                    `room:${roomCode}:rounds`,
                    `room:${roomCode}:guesses`,
                    `room:${roomCode}:solved`,
                ];
                await Promise.all(keys.map(key => this.client.expire(key, ttlSeconds)));
            },
            undefined,
            'expireRoomKeys'
        );
    }


    async registerRoom(roomCode: string, config: { hostId: string; maxRounds: number; drawTime: number; maxPlayers: number }): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.hset(`room:${roomCode}:config`, {
                    hostId: config.hostId,
                    maxRounds: String(config.maxRounds),
                    drawTime: String(config.drawTime),
                    maxPlayers: String(config.maxPlayers),
                });
            },
            undefined,
            'registerRoom'
        );
    }

    async getRoomConfig(roomCode: string): Promise<{ hostId: string; maxRounds: number; drawTime: number; maxPlayers: number } | null> {
        return this.safeRedisCall(
            async () => {
                const raw = await this.client.hgetall(`room:${roomCode}:config`);
                if (!raw || !raw.hostId) return null;
                return {
                    hostId: raw.hostId,
                    maxRounds: Number(raw.maxRounds),
                    drawTime: Number(raw.drawTime),
                    maxPlayers: Number(raw.maxPlayers),
                };
            },
            null,
            'getRoomConfig'
        );
    }

    async unregisterRoom(roomCode: string): Promise<void> {
        return this.safeRedisCall(
            async () => {
                await this.client.del(`room:${roomCode}:config`);
            },
            undefined,
            'unregisterRoom'
        );
    }
}

export const redisClient = new RedisClient();
