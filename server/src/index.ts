import express, { Router } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import { handleRoom } from "./socket/handlers/roomHandler";
import { handleChat } from "./socket/handlers/chatHandler";
import { handleGame } from "./socket/handlers/gameHandler";
import RoomManager from "./services/roomManager";
import authRoutes from "./routes/auth";
import apiRoutes from "./routes/api";
import jwt from "jsonwebtoken";
import { redisClient } from "./services/redisClient";

import { createAdapter } from "@socket.io/redis-adapter";
import { startFlushWorker } from "./services/flushWorker";
import { startTimerWorker } from "./services/timerWorker";
import { setIO } from "./services/socketService";

import { monitorEventLoopDelay } from "perf_hooks";

const app = express();

const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

setInterval(() => {
  const meanMs = (eventLoopHistogram.mean / 1e6).toFixed(1);
  const p95Ms = (eventLoopHistogram.percentile(95) / 1e6).toFixed(1);
  const maxMs = (eventLoopHistogram.max / 1e6).toFixed(1);
  if (parseFloat(p95Ms) > 100) {
    console.warn(`[EventLoopLag] MEAN: ${meanMs}ms | p95: ${p95Ms}ms | MAX: ${maxMs}ms`);
  }
  eventLoopHistogram.reset();
}, 5000);

app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

const router = Router();
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

app.use("/", router);
app.use("/auth", authRoutes);
app.use("/api/v1", apiRoutes);



const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
setIO(io);

const pubClient = redisClient.getClient();
const subClient = pubClient.duplicate();
subClient.on('error', (err) => {
  console.error('[SocketServer subClient] Redis Adapter connection error:', err.message);
});
io.adapter(createAdapter(pubClient, subClient));

if (!process.env.JWT_SECRET) {
  throw new Error('[Server] FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
}
const JWT_SECRET = process.env.JWT_SECRET;

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (socket as any).user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
});

redisClient.on('status_changed', (healthy: boolean) => {
  if (!healthy) {
    console.warn('[Server] Redis degraded — broadcasting system:degraded to all clients');
    io.emit('system:degraded', { message: 'Score saving temporarily unavailable. Game continues.' });
  } else {
    console.log('[Server] Redis recovered — broadcasting system:recovered to all clients');
    io.emit('system:recovered', { message: 'All systems restored.' });
  }
});

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  socket.on("disconnect", async () => {
    const roomCode : string | undefined = RoomManager.getRoomCodeFromSocket(socket.id)
    let room ; 
    if(roomCode){
      room = await RoomManager.getRoom(roomCode);
    }
    
    if (room && roomCode) {
        await room.machine.syncFromRedis();
        await room.syncPlayersFromRedis();
        await room.syncTurnStateFromRedis();
        RoomManager.removeSocketFromMap(socket.id);
        const playerId = room.getPlayerId(socket.id);
        const isHost = playerId === room.hostId;

        const state = room.machine.getState();

        if (state === 'LOBBY' || state === 'GAME_END') {
            await room.removePlayer(socket.id);
            socket.to(roomCode).emit("player-left", { playerId, isHost });
            
            if (isHost || room.isEmpty()) {
                io.to(roomCode).emit("game-over", { reason: "host_left" });
                await RoomManager.destroyRoom(roomCode);
            }
        } else {
            if (playerId) {
                await room.updatePlayerSocketId(playerId, "");
            }
            socket.to(roomCode).emit("player-left", { playerId, isHost });
            if (playerId === room.drawer?.id || room.players.length < 2) {
                room.endTurn(true);
            }
            
            if (room.isEmpty()) {
                await RoomManager.destroyRoom(roomCode);
            }
        }
        
        socket.leave(roomCode);
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
  startFlushWorker();
  startTimerWorker();
});
