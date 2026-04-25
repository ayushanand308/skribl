import { gameRoom } from "../game/gameRoom";

class RoomManager{
    private map: Map<string, gameRoom> = new Map(); 

    createRoom(roomCode: string, hostId: string) {
        let newRoom = new gameRoom(5, roomCode, hostId);
        this.map.set(roomCode, newRoom);
        return newRoom;
    }

    getRoom(roomCode : string){
        return this.map.get(roomCode);
    }

    destroyRoom(roomCode : string){
        this.map.delete(roomCode);
    }
}

export default new RoomManager();