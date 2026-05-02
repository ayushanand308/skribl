import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import roomManager from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";

export function handleGame(socket: Socket , io : Server) {
    socket.on("game-start",(payload)=>{
        const {userName , roomCode, settings} = payload;
        console.log(`[GameHandler] game-start — room: ${roomCode}, settings:`, settings);
        const room = roomManager.getRoom(roomCode);

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

    socket.on('word-choosen' ,(payload)=>{
        let {choosenWord , roomCode} = payload;
        console.log(`[GameHandler] word-choosen — room: ${roomCode}, word: ${choosenWord}`);

        const room = roomManager.getRoom(roomCode);
        const drawerSocket = room?.drawer?.socketId;

        if(room && choosenWord === ''){
            choosenWord = WordBank.getRandomWords(1)[0];
            if(drawerSocket) {io.to(drawerSocket).emit("word-choosen", {choosenWord});}
        }

        room?.setWord(choosenWord);
        room?.startRoundTimer();
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