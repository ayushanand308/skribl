import { Socket } from "socket.io";
import RoomManager from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";
import { redisClient } from "../../services/redisClient";

export function handleGame(socket: Socket, io: Server) {
    socket.on("game-start", async (payload)=>{
        const {userName , roomCode, settings} = payload;
        const startTracker = Date.now();
        console.log(`[GameHandler] game-start triggered for room: ${roomCode} at ${startTracker}`);
        
        const room = await RoomManager.getRoom(roomCode);

        if(room){
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            
            await room.startGame(settings);
            
            io.to(roomCode).emit("game-started", { roomCode });
            
        } else {
            console.log(`[GameHandler] ERROR: Room ${roomCode} not found.`);
        }
        console.log(`[GameHandler] game-start handler finished. Total time: ${Date.now() - startTracker}ms`);
    });

    socket.on("game:play-again", async (payload) => {
        const { roomCode } = payload;
        if (!roomCode) return;

        const room = await RoomManager.getRoom(roomCode);
        if (room) {
            await room.machine.syncFromRedis();
            await room.syncPlayersFromRedis();
            await room.restartGame();
            io.to(roomCode).emit("game:back-to-lobby");
        }
    });

    socket.on('word-choosen' , async (payload)=>{
        let {choosenWord , roomCode} = payload;
        console.log(`[GameHandler] word-choosen — room: ${roomCode}, word: ${choosenWord}`);

        const room = await RoomManager.getRoom(roomCode);
        if (!room) return;

        await room.machine.syncFromRedis();
        await room.syncPlayersFromRedis();
        await room.syncTurnStateFromRedis();

        const drawerSocket = room.drawer?.socketId;

        if(choosenWord === ''){
            choosenWord = WordBank.getRandomWords(1)[0];
            if(drawerSocket) {io.to(drawerSocket).emit("word-choosen", {choosenWord});}
        }

        await room.startRoundTimer(choosenWord);
        await room.machine.dispatch('WORD_PICKED')

        const wordHint = String(choosenWord).split('').map((char: string) => char === ' ' ? ' ' : '_').join(' ');

        console.log(`[GameHandler] Emitting round-started — room: ${roomCode}, drawerId: ${room?.drawer?.id}, drawTime: ${room?.drawTime}`);
        io.to(roomCode).emit("round-started", { 
            roomCode, 
            wordHint,
            drawerId: room?.drawer?.id,
            timeLeft: room?.drawTime,
            round: room?.currentRound,
            maxRounds: room?.maxRounds,
            players: room?.players,
            settings: { drawTime: room?.drawTime, rounds: room?.maxRounds, maxPlayers: room?.maxPlayers },
        });
    })

    socket.on('stroke', async (payload) => {
        const { roomCode, strokeType, ...stroke } = payload;
        const strokeEvent = `stroke-${strokeType}`;
        socket.to(roomCode).emit(strokeEvent, payload);

        if (strokeType === 'draw' || strokeType === 'fill') {
            await redisClient.appendStrokeToRedis(roomCode, { type: strokeType, ...stroke }).catch(err => 
                console.error(`[GameHandler:${roomCode}] Failed to append stroke to Redis:`, err)
            );
        } else if (strokeType === 'clear') {
            await redisClient.clearStrokesInRedis(roomCode).catch(err => 
                console.error(`[GameHandler:${roomCode}] Failed to clear strokes in Redis:`, err)
            );
        }
    });

}