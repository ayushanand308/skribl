import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";

export function handleChat(socket: Socket , io : Server) {
    socket.on("chat-message",async (payload)=>{
        const {message , roomCode , userId } = payload;
        const room = await RoomManager.getRoom(roomCode);
        if (!room) return;
        
        await room.machine.syncFromRedis();
        await room.syncPlayersFromRedis();
        await room.syncTurnStateFromRedis();

        if (room.machine.getState() !== 'DRAW') {
            const sender = room.players.find((p) => p.id === userId);
            const username = sender?.name || 'Unknown'
            io.to(roomCode).emit("chat-message", { sender: username, message });
            return;
        }

        const turnData = await redisClient.getTurnDataFromRedis(roomCode);
        if (!turnData.word) {
            const sender = room.players.find((p) => p.id === userId);
            const username = sender?.name || 'Unknown'
            io.to(roomCode).emit("chat-message", { sender: username, message });
            return;
        }

        if(userId === turnData.drawerId){
            return;
        }

        const sender = room.players.find(p => p.id === userId);
        const username = sender?.name || "Unknown";

        let timeElapsed = 0;
        if (turnData.roundStartTime) {
            timeElapsed = (Date.now() - turnData.roundStartTime) / 1000;
        }

        const { matchType, score } = WordBank.checkWordMatch(message, turnData.word, timeElapsed);

        if (matchType === 'exact') {
            const { added, isTurnOver } = await room.addScore(userId, score, timeElapsed);
            if (!added) return;

            await redisClient.insertGuessData(
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

            if (isTurnOver) {
                await room.machine.dispatch('ALL_GUESSED');
                await room.endTurn();
            }
        } else if (matchType === 'close') {
            await redisClient.insertGuessData(
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