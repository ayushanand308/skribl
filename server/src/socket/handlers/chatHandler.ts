import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";

export function handleChat(socket: Socket , io : Server) {
    socket.on("chat-message",async (payload)=>{
        const {message , roomCode , userId } = payload;
        const room = RoomManager.getRoom(roomCode);
        if (!room) return;

        if(!room.word){
            const sender = room.players.find((p) => p.id === userId);
            const username = sender?.name || 'Unknown'
            io.to(roomCode).emit("chat-message", { sender: username, message });
            return;
        }

        const currentDrawer = room?.drawer;
        const drawerId = currentDrawer?.id;

        if(userId === drawerId){
            return;
        }

        const sender = room.players.find(p => p.id === userId);
        const username = sender?.name || "Unknown";

        const timeElapsed = room.getTimeElapsed();
        const { matchType, score } = WordBank.checkWordMatch(message, room.word, timeElapsed);

        if (matchType === 'exact') {
            const added = await room.addScore(userId, score, timeElapsed);
            if (!added) return;

            redisClient.insertGuessData(
                roomCode,
                room.currentRound,
                userId,
                message,
                true,
                Math.round(timeElapsed * 1000)
            ).catch(err => console.error(`[ChatHandler:${roomCode}] Failed to log guess:`, err));

            io.to(roomCode).emit("chat-message", {
                sender: "System",
                message: `${username} guessed the word!`
            });

            io.to(roomCode).emit("game:player-guessed", {
                playerId: userId,
                playerName: username,
                score: score
            });

            if (room.allGuessed()) {
                room.endTurn();
            }
        } else if (matchType === 'close') {
            redisClient.insertGuessData(
                roomCode,
                room.currentRound,
                userId,
                message,
                false,
                Math.round(timeElapsed * 1000)
            ).catch(err => console.error(`[ChatHandler:${roomCode}] Failed to log close guess:`, err));

            socket.emit("chat-message", {
                sender: "System",
                message: `'${message}' is close!`
            });
        } else {
            io.to(roomCode).emit("chat-message", {
                sender: username,
                message: message
            });
        }
    })
}