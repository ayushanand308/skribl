import { Socket , Server } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { player } from "../../game/player";
import { WordBank } from "../../game/wordBank";

export function handleRoom(socket: Socket , io : Server ) {
    socket.on("room-create", (payload) => {
        const { username, id } = payload;
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

        const room = RoomManager.createRoom(roomCode, socket.id);

        room.addPlayer({
            id,
            socketId: socket.id,
            name: username,
            score: 0
        });

        socket.join(roomCode);
        RoomManager.addSocketToMap(socket.id, roomCode);
        socket.emit("room-joined", { 
            roomCode, 
            players: room.players, 
            hostId: room.hostId, 
            gameState: 'LOBBY', 
            settings: { rounds: 3, drawTime: 60, maxPlayers: 8 } 
        });
        room.onRoundEnd=((data: {word:string , score:{id:string, score:number}[]})=>{
            io.to(roomCode).emit("round-end" , data)
        })
        
        room.onTurnStart = (player: player) => {
            const words = WordBank.getRandomWords(3);
            io.to(player.socketId).emit("choose-word", { words });
            
            socket.to(roomCode).emit("chat-message", {
                sender: "System",
                message: `${player.name} is picking a word...`
            });
        };

        room.onGameOver = (data) => {
            io.to(roomCode).emit("game:over", data);
        };
    });

    socket.on("room-join", (payload) => {
        const { username, roomCode, id } = payload;
        const room = RoomManager.getRoom(roomCode);

        if(!room) {return};
        
        room.addPlayer({
            id,
            socketId: socket.id,
            name: username,
            score: 0
        });

        socket.join(roomCode);
        socket.to(roomCode).emit("player-joined", { player: { id, socketId: socket.id, name: username, score: 0 } });
        RoomManager.addSocketToMap(socket.id , roomCode);
        socket.emit("room-joined", { 
            roomCode, 
            players: room.players, 
            hostId: room.hostId, 
            gameState: 'LOBBY', 
            settings: { rounds: 3, drawTime: 60, maxPlayers: 8 } 
        });
    });

    socket.on("room-leave", (payload) => {
        const { roomCode } = payload;
        const room = RoomManager.getRoom(roomCode);
        
        if (room) {
            const playerId = room.getPlayerId(socket.id);
            const isHost = playerId === room.hostId;
            room.removePlayer(socket.id);
            room.endTurn(true)
            socket.leave(roomCode);
            socket.to(roomCode).emit("player-left", { playerId: playerId, isHost });
            if(isHost){            
                io.to(roomCode).emit("game-over", { reason: "host_left" });
                RoomManager.destroyRoom(roomCode);
            }
            if(room.isEmpty()){
                RoomManager.destroyRoom(roomCode);
            }
            RoomManager.removeSocketFromMap(socket.id);
        }
    });
}
