import { Server } from "socket.io";

let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
    ioInstance = io;
};

export const getIO = (): Server => {
    if (!ioInstance) {
        throw new Error("Socket.IO instance is not initialized!");
    }
    return ioInstance;
};
