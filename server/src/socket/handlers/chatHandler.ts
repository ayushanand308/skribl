import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";

export function handleChat(socket: Socket , io : Server) {
    socket.on("chat-message", async (payload)=>{
        const { message, roomCode, userId, isDoubleDown } = payload;
        const room = await RoomManager.getRoom(roomCode);
        if (!room) return;

        const lockoutTtl = await redisClient.isUserLockedOut(roomCode, userId);
        if (lockoutTtl > 0) {
            socket.emit("chat:locked", { timeLeft: lockoutTtl });
            return;
        }
        
        await room.machine.syncFromRedis();
        await room.syncPlayersFromRedis();
        await room.syncTurnStateFromRedis();

        const sender = room.players.find((p) => p.id === userId);
        const username = sender?.name || 'Unknown';

        if (room.machine.getState() !== 'DRAW') {
            io.to(roomCode).emit("chat-message", { sender: username, message });
            return;
        }

        const turnData = await redisClient.getTurnDataFromRedis(roomCode);
        if (!turnData.word) {
            io.to(roomCode).emit("chat-message", { sender: username, message });
            return;
        }

        if (userId === turnData.drawerId) {
            return;
        }

        let timeElapsed = 0;
        if (turnData.roundStartTime) {
            timeElapsed = (Date.now() - turnData.roundStartTime) / 1000;
        }

        const { matchType, score } = WordBank.checkWordMatch(message, turnData.word, timeElapsed);

        let isDoubleDownAttempt = false;
        if (isDoubleDown) {
            const alreadyUsed = await redisClient.hasUsedDoubleDown(roomCode, userId);
            if (!alreadyUsed) {
                isDoubleDownAttempt = true;
                await redisClient.markUsedDoubleDown(roomCode, userId);
            }
        }

        if (matchType === 'exact') {
            const finalScore = isDoubleDownAttempt ? score * 2 : score;
            const { added, isTurnOver } = await room.addScore(userId, finalScore, timeElapsed);
            if (!added) return;

            await redisClient.insertGuessData(
                roomCode,
                room.currentRound,
                userId,
                message,
                true,
                Math.round(timeElapsed * 1000)
            ).catch(err => console.error(`[ChatHandler:${roomCode}] Failed to log guess:`, err));

            if (isDoubleDownAttempt) {
                io.to(roomCode).emit("chat-message", {
                    sender: "System",
                    message: `🔥 [DOUBLE DOWN SUCCESS] ${username} DOUBLED DOWN AND GUESSED THE WORD FOR 2X POINTS (+${finalScore})!`
                });
            } else {
                io.to(roomCode).emit("chat-message", {
                    sender: "System",
                    message: `${username} guessed the word!`
                });
            }

            io.to(roomCode).emit("game:player-guessed", {
                playerId: userId,
                playerName: username,
                score: finalScore,
                isDoubleDown: isDoubleDownAttempt
            });

            if (isTurnOver) {
                await room.machine.dispatch('ALL_GUESSED');
                await room.endTurn();
            }
        } else {
            if (isDoubleDownAttempt) {
                await redisClient.setUserLockout(roomCode, userId, 5);
                socket.emit("game:lockout", { duration: 5, reason: "double_down_failed" });
                io.to(roomCode).emit("chat-message", {
                    sender: "System",
                    message: `⚡ [DOUBLE DOWN FAILED] ${username} doubled down and was WRONG! Locked out for 5s!`
                });
            }

            if (matchType === 'close') {
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
        }
    })
}