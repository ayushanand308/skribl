import { Socket , Server } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { player } from "../../game/player";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";


export function handleRoom(socket: Socket , io : Server ) {
    socket.on("room-create", async (payload) => {
        const { username, id, avatar } = payload;
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

        const room = await RoomManager.createRoom(roomCode, socket.id);

        await room.addPlayer({
            id,
            socketId: socket.id,
            name: username,
            score: 0,
            avatar
        });

        socket.join(roomCode);
        RoomManager.addSocketToMap(socket.id, roomCode);
        socket.emit("room-joined", { 
            roomCode, 
            players: room.players, 
            hostId: room.hostId, 
            gameState: 'LOBBY', 
            settings: { rounds: room.maxRounds, drawTime: room.drawTime, maxPlayers: room.maxPlayers } 
        });

    });

    socket.on("room-join", async (payload) => {
        const { username, roomCode, id, avatar } = payload;
        const room = await RoomManager.getRoom(roomCode);

        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
        }

        let errorMsg = null;
        if (!room) errorMsg = "ROOM NOT FOUND";
        else if (room.machine.getState() !== 'LOBBY') errorMsg = "GAME ALREADY STARTED";
        else if (room.players.length >= room.maxPlayers) errorMsg = "ROOM CAPACITY FULL";

        if (errorMsg) {
            socket.emit("room:error", { message: errorMsg });
            return;
        }
        await room?.addPlayer({
            id,
            socketId: socket.id,
            name: username,
            score: 0,
            avatar
        });

        socket.join(roomCode);
        socket.to(roomCode).emit("player-joined", { player: { id, socketId: socket.id, name: username, score: 0, avatar } });
        RoomManager.addSocketToMap(socket.id , roomCode);
        socket.emit("room-joined", { 
            roomCode, 
            players: room?.players, 
            hostId: room?.hostId, 
            gameState: 'LOBBY', 
            settings: { rounds: room?.maxRounds, drawTime: room?.drawTime, maxPlayers: room?.maxPlayers } 
        });
    });

    socket.on("room-reconnect", async (payload) => {
        const { roomCode, id } = payload;
        const room = await RoomManager.getRoom(roomCode);
        
        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            await room.syncTurnStateFromRedis();
            
            const player = room.players.find(p => p.id === id);
            if (player) {
                if (player.socketId) {
                    RoomManager.removeSocketFromMap(player.socketId);
                }
                
                await room.updatePlayerSocketId(id, socket.id);
                socket.join(roomCode);
                RoomManager.addSocketToMap(socket.id, roomCode);
                
                const state = room.machine.getState();
                const reconnectData: any = {
                    roomCode, 
                    players: room.players, 
                    hostId: room.hostId, 
                    gameState: state, 
                    settings: { rounds: room.maxRounds, drawTime: room.drawTime, maxPlayers: room.maxPlayers },
                    round: room.currentRound,
                    maxRounds: room.maxRounds,
                    drawerId: room.drawer?.id
                };

                if (state === 'DRAW') {
                    const turnData = await redisClient.getTurnDataFromRedis(roomCode);
                    if (turnData && turnData.roundStartTime) {
                        const elapsed = Math.floor((Date.now() - turnData.roundStartTime) / 1000);
                        reconnectData.timeLeft = Math.max(0, room.drawTime - elapsed);
                        reconnectData.wordHint = String(turnData.word).split('').map((char: string) => char === ' ' ? ' ' : '_').join(' ');
                        
                        if (player.id === turnData.drawerId) {
                            reconnectData.fullWord = turnData.word;
                        }
                    }

                    const strokes = await redisClient.getStrokesFromRedis(roomCode);
                    if (strokes && strokes.length > 0) {
                        reconnectData.strokes = strokes;
                    }
                } else if (state === 'PICK_WORD') {
                    if (room.drawer?.id === player.id) {
                        const words = await redisClient.getPickWords(roomCode);
                        if (words) {
                            socket.emit("choose-word", { words });
                        }
                    }
                }

                socket.emit("room-joined", reconnectData);
            } else {
                socket.emit("room:error", { message: "PLAYER NOT FOUND IN ROOM" });
            }
        } else {
            socket.emit("room:error", { message: "ROOM NOT FOUND" });
        }
    });

    socket.on("room-leave", async (payload) => {
        const { roomCode } = payload;
        const room = await RoomManager.getRoom(roomCode);
        
        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            const playerId = room.getPlayerId(socket.id); // frontend id 
            const isHost = playerId === room.getPlayerId(room.hostId); //backend socket id
            await room.removePlayer(socket.id);
            const state = room.machine.getState();
            if(state !== 'LOBBY' && state !== 'GAME_END' && (room.players.length < 2 || playerId === room.drawer?.socketId)){
                room.endTurn(true);
            }
            socket.leave(roomCode);
            socket.to(roomCode).emit("player-left", { playerId: playerId, isHost });
            if(isHost){            
                io.to(roomCode).emit("game-over", { reason: "host_left" });
                await RoomManager.destroyRoom(roomCode);
            }
            if(room.isEmpty()){
                await RoomManager.destroyRoom(roomCode);
            }
            RoomManager.removeSocketFromMap(socket.id);
        }
    });

    socket.on("room:update-settings", async (payload) =>{
        const roomCode = [...socket.rooms].find((r) => r != socket.id)
        if (!roomCode) return;
        const room = await RoomManager.getRoom(roomCode);
        if (!room || room.hostId !== socket.id) return;

        if (payload.rounds != null) room.maxRounds = payload.rounds;
        if (payload.drawTime != null) room.drawTime = payload.drawTime;
        if (payload.maxPlayers != null) room.maxPlayers = payload.maxPlayers;

        await redisClient.registerRoom(roomCode, {
            hostId: room.hostId,
            maxRounds: room.maxRounds,
            drawTime: room.drawTime,
            maxPlayers: room.maxPlayers
        }).catch((err: any) => console.error(`[RoomHandler] Failed to update Redis config:`, err));

        io.to(roomCode).emit("room:settings-updated", {
            settings: { rounds: room.maxRounds, drawTime: room.drawTime, maxPlayers: room.maxPlayers }
        });
    });
}
