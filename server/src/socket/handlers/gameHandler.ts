import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";

export function handleGame(socket: Socket , io : Server) {
    socket.on("game-start", async (payload)=>{
        const {userName , roomCode, settings} = payload;
        console.log(`[GameHandler] game-start — room: ${roomCode}, settings:`, settings);
        const room = await RoomManager.getRoom(roomCode);

        if(room){
            room.startGame(settings);
            io.to(roomCode).emit("game-started", { roomCode });
            const words = WordBank.getRandomWords(3);
            const drawerSocket = room.drawer?.socketId;
            if (drawerSocket) {
                console.log(`[GameHandler] Sending choose-word to drawer: ${drawerSocket}`);
                io.to(drawerSocket).emit("choose-word", { words });
            }
        }
    });

    socket.on("game:play-again", async (payload) => {
        const { roomCode } = payload;
        if (!roomCode) return;

        const room = await RoomManager.getRoom(roomCode);
        if (room) {
            room.restartGame();
            io.to(roomCode).emit("game:back-to-lobby");
        }
    });

    socket.on('word-choosen' , async (payload)=>{
        let {choosenWord , roomCode} = payload;
        console.log(`[GameHandler] word-choosen — room: ${roomCode}, word: ${choosenWord}`);

        const room = await RoomManager.getRoom(roomCode);
        const drawerSocket = room?.drawer?.socketId;

        if(room && choosenWord === ''){
            choosenWord = WordBank.getRandomWords(1)[0];
            if(drawerSocket) {io.to(drawerSocket).emit("word-choosen", {choosenWord});}
        }

        await room?.startRoundTimer(choosenWord);
        room?.machine.dispatch('WORD_PICKED')

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
        });
    })

    socket.on('stroke' , (payload) =>{
        const {roomCode , strokeType} = payload;
        const strokeEvent = `stroke-${strokeType}`
        socket.to(roomCode).emit(strokeEvent , payload);
    })

}