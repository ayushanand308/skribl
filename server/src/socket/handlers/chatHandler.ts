import { Socket } from "socket.io";
import RoomManager  from "../../services/roomManager";
import { Server } from "socket.io";
import { WordBank } from "../../game/wordBank";

export function handleChat(socket: Socket , io : Server) {
    socket.on("chat-message",(payload)=>{
        const {message , roomCode , userId } = payload;
        const room = RoomManager.getRoom(roomCode);
        if (!room || !room.word) return;

        const currentDrawer = room?.drawer;
        const drawerId = currentDrawer?.id;

        if(userId === drawerId){
            throw new Error('drawers cant use chat');
        }

        const sender = room.players.find(p => p.id === userId);
        const username = sender?.name || "Unknown";

        const timeElapsed = room.getTimeElapsed();
        const { matchType, score } = WordBank.checkWordMatch(message, room.word, timeElapsed);

        if (matchType === 'exact') {
            const added = room.addScore(userId, score);
            if (!added) return;

            io.to(roomCode).emit("chat-message", {
                sender: "System",
                message: `${username} guessed the word!`
            });

            if (room.allGuessed()) {
                room.endTurn();
            }
        } else if (matchType === 'close') {
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