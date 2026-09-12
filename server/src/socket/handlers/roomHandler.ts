import { Socket , Server } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { player } from "../../game/player";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";


function getHostSettings(room: any) {
    return {
        rounds: room.maxRounds,
        drawTime: room.drawTime,
        maxPlayers: room.maxPlayers,
        customWords: room.customWords || [],
        customWordsOnly: !!room.customWordsOnly,
        customTheme: room.customTheme || 'Default'
    };
}

function getGuestSettings(room: any) {
    return {
        rounds: room.maxRounds,
        drawTime: room.drawTime,
        maxPlayers: room.maxPlayers,
        customWordsCount: room.customWords ? room.customWords.length : 0,
        customWordsOnly: !!room.customWordsOnly,
        customTheme: room.customTheme || 'Default'
    };
}

export function handleRoom(socket: Socket , io : Server ) {
    socket.on("room-create", async (payload) => {
        const { username, id, avatar } = payload;
        const roomCode = Math.random().toString(36).substring(2, 8).padEnd(6, '0').toUpperCase();

        const room = await RoomManager.createRoom(roomCode, id);

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
            hostSocketId: socket.id,
            gameState: 'LOBBY', 
            settings: getHostSettings(room)
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
        const hostPlayer = room?.players.find(p => p.id === room?.hostId);
        socket.emit("room-joined", { 
            roomCode, 
            players: room?.players, 
            hostId: room?.hostId, 
            hostSocketId: hostPlayer?.socketId,
            gameState: 'LOBBY', 
            settings: getGuestSettings(room)
        });
    });

    socket.on("room-reconnect", async (payload) => {
        const { roomCode, id } = payload;
        const room = await RoomManager.getRoom(roomCode);
        
        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            await room.syncTurnStateFromRedis();
            await room.syncConfigFromRedis(); // ← required: loads customWords/theme/customWordsOnly
            const state = room.machine.getState();
            
            const player = room.players.find(p => p.id === id);
            if (player) {
                if (player.socketId) {
                    RoomManager.removeSocketFromMap(player.socketId);
                }
                
                await room.updatePlayerSocketId(id, socket.id);
                if (player.afk) {
                    player.afk = false;
                    await redisClient.updatePlayerAFKInRedis(roomCode, id, false);
                }

                socket.join(roomCode);
                RoomManager.addSocketToMap(socket.id, roomCode);
                socket.to(roomCode).emit("player-reconnected", { playerId: id });
                
                const hostPlayer = room.players.find(p => p.id === room.hostId);
                const reconnectData: any = {
                    roomCode, 
                    players: room.players, 
                    hostId: room.hostId, 
                    hostSocketId: hostPlayer?.socketId,
                    gameState: state, 
                    settings: (player.id === room.hostId) ? getHostSettings(room) : getGuestSettings(room),
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
            const isHost = playerId ? room.isHost(playerId) : false;
            await room.removePlayer(socket.id);
            const state = room.machine.getState();
            socket.leave(roomCode);
            socket.to(roomCode).emit("player-left", { playerId: playerId, isHost });

            const activePlayers = room.players.filter(p => p.socketId && p.socketId !== "");
            if (state !== 'LOBBY' && state !== 'GAME_END') {
                if (activePlayers.length < 2) {
                    await room.endGameDueToLackOfPlayers();
                    if (activePlayers.length === 0) {
                        await RoomManager.destroyRoom(roomCode);
                    } else if (isHost) {
                        await room.electNewHost(playerId);
                    }
                } else {
                    if (playerId === room.drawer?.id || socket.id === room.drawer?.socketId) {
                        room.endTurn(true);
                    }
                    if (isHost) {
                        await room.electNewHost(playerId);
                    }
                }
            } else {
                if (room.isEmpty()) {
                    await RoomManager.destroyRoom(roomCode);
                } else if (isHost) {
                    await room.electNewHost(playerId);
                }
            }
            RoomManager.removeSocketFromMap(socket.id);
        }
    });

    socket.on("room:update-settings", async (payload) =>{
        const roomCode = [...socket.rooms].find((r) => r != socket.id)
        if (!roomCode) return;
        const room = await RoomManager.getRoom(roomCode);
        if (!room) return;
        await room.syncConfigFromRedis();
        if (!room.isHost(socket.id)) return;

        if (payload.rounds != null) room.maxRounds = payload.rounds;
        if (payload.drawTime != null) room.drawTime = payload.drawTime;
        if (payload.maxPlayers != null) room.maxPlayers = payload.maxPlayers;
        if (payload.customWords !== undefined) {
            room.customWords = WordBank.sanitizeWords(payload.customWords);
        }
        if (payload.customWordsOnly !== undefined) {
            room.customWordsOnly = !!payload.customWordsOnly;
        }
        if (payload.customTheme !== undefined) {
            room.customTheme = String(payload.customTheme || 'Default');
        }

        await redisClient.registerRoom(roomCode, {
            hostId: room.hostId,
            maxRounds: room.maxRounds,
            drawTime: room.drawTime,
            maxPlayers: room.maxPlayers,
            customWords: room.customWords,
            customWordsOnly: room.customWordsOnly,
            customTheme: room.customTheme,
        }).catch((err: any) => console.error(`[RoomHandler] Failed to update Redis config:`, err));

        socket.emit("room:settings-updated", {
            settings: getHostSettings(room)
        });
        socket.to(roomCode).emit("room:settings-updated", {
            settings: getGuestSettings(room)
        });
    });
    socket.on("kick-player", async (payload) => {
        const { roomCode, playerId } = payload;
        const room = await RoomManager.getRoom(roomCode);
        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            const senderId = room.getPlayerId(socket.id);
            if (senderId === room.hostId && senderId !== playerId) {
                const targetPlayer = room.players.find(p => p.id === playerId);
                if (targetPlayer) {
                    const targetSocketId = targetPlayer.socketId;
                    await room.removePlayer(targetSocketId);
                    
                    if (targetSocketId) {
                        io.to(targetSocketId).emit("room:error", { message: "YOU HAVE BEEN KICKED FROM THE ROOM" });
                        const targetSocket = io.sockets.sockets.get(targetSocketId);
                        if (targetSocket) {
                            targetSocket.leave(roomCode);
                        }
                    }
                    io.to(roomCode).emit("player-left", { playerId: playerId, isHost: false });
                }
            }
        }
    });

}
