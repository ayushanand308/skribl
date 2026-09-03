import { Socket , Server } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { player } from "../../game/player";
import { WordBank } from "../../game/wordBank";


export function handleRoom(socket: Socket , io : Server ) {
    socket.on("room-create", async (payload) => {
        const { username, id, avatar } = payload;
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

        const room = await RoomManager.createRoom(roomCode, socket.id);

        room.addPlayer({
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
        room?.addPlayer({
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

    socket.on("room-leave", async (payload) => {
        const { roomCode } = payload;
        const room = await RoomManager.getRoom(roomCode);
        
        if (room) {
            const playerId = room.getPlayerId(socket.id); // frontend id 
            const isHost = playerId === room.getPlayerId(room.hostId); //backend socket id
            room.removePlayer(socket.id);
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

        io.to(roomCode).emit("room:settings-updated", {
            settings: { rounds: room.maxRounds, drawTime: room.drawTime, maxPlayers: room.maxPlayers }
        });
    });
}
