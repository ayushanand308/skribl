import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

export class RedisClient {
    private client: Redis;

    constructor() {
        this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

        const luaScript = fs.readFileSync(
            path.join(__dirname, '../scripts/record_guess.lua'),
            'utf8'
        );
        this.client.defineCommand('recordGuess', {
            numberOfKeys: 1,
            lua: luaScript,
        });
    }

    async recordGuess(roomCode: string, playerId: string, timeElapsed: number, totalPlayers: number): Promise<[number, number]> {
        const key = `room:${roomCode}:solved`;
        const result = await (this.client as any).recordGuess(key, playerId, timeElapsed, totalPlayers);
        return result as [number, number];
    }

    async clearSolvedSet(roomCode: string): Promise<void> {
        await this.client.del(`room:${roomCode}:solved`);
    }

    disconnect() {
        this.client.disconnect();
    }
}

export const redisClient = new RedisClient();
