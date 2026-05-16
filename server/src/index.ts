import express, { Router } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import { handleRoom } from "./socket/handlers/roomHandler";
import { handleChat } from "./socket/handlers/chatHandler";
import { handleGame } from "./socket/handlers/gameHandler";
import RoomManager  from "./services/roomManager";

const app = express();

app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

const router = Router();
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});
app.use("/", router);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  socket.on("disconnect", () => {
    const roomCode : string | undefined = RoomManager.getRoomCodeFromSocket(socket.id)
    let room ; 
    if(roomCode){
      room = RoomManager.getRoom(roomCode);
    }
    
    if (room && roomCode) {
        RoomManager.removeSocketFromMap(socket.id);
        const playerId = room.getPlayerId(socket.id);
        const isHost = playerId === room.hostId;
        room.removePlayer(socket.id);
        room.endTurn(true);
        socket.leave(roomCode);
        socket.to(roomCode).emit("player-left", { playerId: playerId, isHost });
        if(isHost){
            io.to(roomCode).emit("game-over", { reason: "host_left" });
            RoomManager.destroyRoom(roomCode);
        }
        if(room.isEmpty()){
            RoomManager.destroyRoom(roomCode);
        }
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });

  handleRoom(socket ,io)
  handleChat(socket, io)
  handleGame(socket, io)
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
