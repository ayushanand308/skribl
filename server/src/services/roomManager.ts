import { gameRoom } from "../game/gameRoom";
import { redisClient } from "./redisClient";

class RoomManager{
    private map: Map<string, gameRoom> = new Map(); 
    private socketMap : Map<string, string> = new Map();

    async createRoom(roomCode: string, hostId: string): Promise<gameRoom> {
        const newRoom = new gameRoom(3, roomCode, hostId);
        this.map.set(roomCode, newRoom);
        redisClient.registerRoom(roomCode, {
            hostId,
            maxRounds: newRoom.maxRounds,
            drawTime: newRoom.drawTime,
            maxPlayers: newRoom.maxPlayers,
        }).catch(err => console.error(`[RoomManager] Failed to register room ${roomCode} in Redis:`, err));

        return newRoom;
    }

    async getRoom(roomCode: string): Promise<gameRoom | undefined> {
        const localRoom = this.map.get(roomCode);
        if (localRoom) return localRoom;

        console.log(`[RoomManager] Room ${roomCode} not in local memory — checking Redis registry...`);
        const config = await redisClient.getRoomConfig(roomCode);
        if (!config) {
            console.log(`[RoomManager] Room ${roomCode} not found in Redis registry.`);
            return undefined;
        }

        console.log(`[RoomManager] Reconstructing room ${roomCode} from Redis config.`);
        const reconstructed = new gameRoom(config.maxRounds, roomCode, config.hostId);
        reconstructed.drawTime = config.drawTime;
        reconstructed.maxPlayers = config.maxPlayers;

        await reconstructed.machine.syncFromRedis();
        await reconstructed.syncPlayersFromRedis();

        this.map.set(roomCode, reconstructed);
        console.log(`[RoomManager] Room ${roomCode} successfully reconstructed with ${reconstructed.players.length} players.`);
        return reconstructed;
    }

    async destroyRoom(roomCode: string): Promise<void> {
        this.map.delete(roomCode);
        redisClient.unregisterRoom(roomCode).catch(err =>
            console.error(`[RoomManager] Failed to unregister room ${roomCode} from Redis:`, err)
        );
    }

    addSocketToMap(socketId: string ,roomCode:string){
        this.socketMap.set(socketId, roomCode);
    }

    getRoomCodeFromSocket(socketId: string): string | undefined {
        return this.socketMap.get(socketId);
    }

    removeSocketFromMap(socketId: string) {
        this.socketMap.delete(socketId);
    }
}

export default new RoomManager();