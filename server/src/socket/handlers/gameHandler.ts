import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import roomManager from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";

export function handleGame(socket: Socket , io : Server) {
    socket.on("game-start",(payload)=>{
        const {userName , roomCode} = payload;
        const room = roomManager.getRoom(roomCode);

        if(room){
            room.startGame();
            io.to(roomCode).emit("game-started", { roomCode });
            const words = WordBank.getRandomWords(3);
            const drawerSocket = room.drawer?.socketId;
            if (drawerSocket) {
                console.log("GOT HERE")
                io.to(drawerSocket).emit("choose-word", { words });
            }
        }
    });

    socket.on('word-choosen' ,(payload)=>{
        let {choosenWord , roomCode} = payload;

        const room = roomManager.getRoom(roomCode);
        const drawerSocket = room?.drawer?.socketId;

        if(room && choosenWord === ''){
            choosenWord = WordBank.getRandomWords(1)[0];
            if(drawerSocket) {io.to(drawerSocket).emit("word-choosen", {choosenWord});}
        }

        room?.setWord(choosenWord);
        room?.startRoundTimer();

        const wordHint = String(choosenWord).split('').map((char: string) => char === ' ' ? ' ' : '_').join(' ');

        io.to(roomCode).emit("round-started", { 
            roomCode, 
            wordHint,
            drawerId: room?.drawer?.id,
        });
    })

    socket.on('stroke' , (payload) =>{
        const {roomCode , strokeType} = payload;
        const strokeEvent = `stroke-${strokeType}`
        socket.to(roomCode).emit(strokeEvent , payload);
    })

}