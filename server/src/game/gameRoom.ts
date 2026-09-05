
import { GameStateMachine } from "./gameStateMachine";
import { player } from "./player";
import { redisClient } from "../services/redisClient";
import { getIO } from "../services/socketService";
import { flushQueue } from "../services/flushQueue";
import { timerQueue } from "../services/timerQueue";
import { WordBank } from "./wordBank";

export class gameRoom{
    machine: GameStateMachine
    players: player[]
    currentRound: number
    drawer: player | null = null;
    currentPlayer: number = 0;
    maxRounds: number;
    drawTime: number;
    maxPlayers: number;
    roomCode: string;
    hostId: string;



    constructor(maxRounds : number , roomCode : string, hostId: string){
        this.roomCode = roomCode;
        this.machine = new GameStateMachine(roomCode);
        this.players = [];
        this.currentRound = 1;
        this.maxRounds = maxRounds;
        this.drawTime = 60;
        this.maxPlayers = 8;
        this.roomCode = roomCode;
        this.hostId = hostId;
        this.currentPlayer = 0;
    }

    async addPlayer(player : player){
        this.players.push(player);
        await redisClient.addPlayerToRedis(this.roomCode, player).catch(err => {
            console.error(`[GameRoom:${this.roomCode}] Failed to add player ${player.id} to Redis:`, err);
        });
    }

    async removePlayer(socketId : string){
        console.log(this.players.length, " L1 ");
        const target = this.players.find(p => p.socketId === socketId);
        this.players =  this.players.filter((p)=>p.socketId!==socketId);
        console.log(this.players.length, " L2 ");

        if (target) {
            await redisClient.removePlayerFromRedis(this.roomCode, target.id).catch(err => {
                console.error(`[GameRoom:${this.roomCode}] Failed to remove player ${target.id} from Redis:`, err);
            });
        }
    }

    async updatePlayerSocketId(playerId: string, newSocketId: string) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.socketId = newSocketId;
            await redisClient.updatePlayerSocketIdInRedis(this.roomCode, playerId, newSocketId).catch(err => {
                console.error(`[GameRoom:${this.roomCode}] Failed to update socket ID for ${playerId} in Redis:`, err);
            });
        }
    }

    async syncPlayersFromRedis(): Promise<player[]> {
        const redisPlayers = await redisClient.getPlayersFromRedis(this.roomCode);
        if (redisPlayers && redisPlayers.length > 0) {
            this.players = redisPlayers.sort((a, b) => a.id.localeCompare(b.id));
        }
        return this.players;
    }

    async syncTurnStateFromRedis(): Promise<void> {
        const turnState = await redisClient.getRoomTurnState(this.roomCode);
        if (turnState) {
            this.currentPlayer = turnState.currentPlayer;
            this.currentRound = turnState.currentRound;
            this.drawer = this.players.find(p => p.id === turnState.drawerId) || null;
        }
    }

    getPlayerId(socketId: string){
        const player = this.players.find((p)=>p.socketId === socketId);
        return player?.id; 
    }

    isEmpty(){
        return this.players.length === 0;
    }

    async startRoundTimer(word: string){
        const roundStartTime = Date.now();
        
        // Write turn data to Redis
        await redisClient.setTurnDataInRedis(
            this.roomCode,
            word,
            this.drawer?.id || '',
            roundStartTime
        );

        const jobId = `turn-timer:${this.roomCode}:${this.currentRound}`;
        await timerQueue.add(
            'turn-expire',
            { roomCode: this.roomCode, round: this.currentRound },
            { delay: this.drawTime * 1000, jobId }
        );
        console.log(`[GameRoom:${this.roomCode}] Scheduled BullMQ turn timer — job: ${jobId}, delay: ${this.drawTime}s`);
    }

    async endRoundTimer(){
        const jobId = `turn-timer:${this.roomCode}:${this.currentRound}`;
        timerQueue.remove(jobId).catch(err => {
            console.warn(`[GameRoom:${this.roomCode}] Could not remove BullMQ timer job ${jobId}:`, (err as Error).message);
        });
        await redisClient.clearTurnDataInRedis(this.roomCode).catch(err => {
            console.error(`[GameRoom:${this.roomCode}] Failed to clear turn data:`, err);
        });
    }

    async addScore(playerId: string, score: number, timeElapsed : number): Promise<{ added: boolean, isTurnOver: boolean }> {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            const result : [number,number] = await redisClient.recordGuess(this.roomCode, player.id ,timeElapsed, this.players.length - 1);
            const wasNewGuess = result[0];
            if(!wasNewGuess){
                return { added: false, isTurnOver: false };
            }
            player.score += score;
            
            await redisClient.addTurnScoreInRedis(this.roomCode, score);
            
            await redisClient.updatePlayerScoreInRedis(this.roomCode, player.id, player.score).catch(err => {
                console.error(`[GameRoom:${this.roomCode}] Failed to update score for ${player.id} in Redis:`, err);
            });
            return { added: true, isTurnOver: result[1] === 1 };
        }
        return { added: false, isTurnOver: false };
    }

    async startGame(settings?: {rounds?: number, drawTime?: number, maxPlayers?: number}){
        console.log(`[GameRoom:${this.roomCode}] startGame — state: ${this.machine.getState()}, players: ${this.players.length}, settings:`, settings);
        if(this.machine.getState()!=='LOBBY' || this.players.length<2){
            console.error(`[GameRoom:${this.roomCode}] Cannot start — state: ${this.machine.getState()}, players: ${this.players.length}`);
            return false;
        }

        if(settings){
            if(settings.rounds) this.maxRounds = settings.rounds;
            if(settings.drawTime) this.drawTime = settings.drawTime;
            if(settings.maxPlayers) this.maxPlayers = settings.maxPlayers;
        }

        console.log(`[GameRoom:${this.roomCode}] Config — maxRounds: ${this.maxRounds}, drawTime: ${this.drawTime}s, maxPlayers: ${this.maxPlayers}`);

        await this.machine.dispatch('GAME_START');

        await redisClient.initRoomInRedis(
            { roomCode: this.roomCode, maxRounds: this.maxRounds, drawTimeSecs: this.drawTime },
            this.players.map(p => ({ playerId: p.id, userId: null, displayName: p.name }))
        ).catch(err => console.error(`[GameRoom:${this.roomCode}] Failed to init Redis:`, err));

        await this.startTurn();
    }

    async restartGame(settings?: {rounds?: number, drawTime?: number, maxPlayers?: number}){
        console.log(`[GameRoom:${this.roomCode}] startGame — state: ${this.machine.getState()}, players: ${this.players.length}, settings:`, settings);
        if(this.machine.getState()!=='GAME_END' || this.players.length<2){
            console.error(`[GameRoom:${this.roomCode}] Cannot start — state: ${this.machine.getState()}, players: ${this.players.length}`);
            return false;
        }

        if(settings){
            if(settings.rounds) this.maxRounds = settings.rounds;
            if(settings.drawTime) this.drawTime = settings.drawTime;
            if(settings.maxPlayers) this.maxPlayers = settings.maxPlayers;
            
            await redisClient.registerRoom(this.roomCode, {
                hostId: this.hostId,
                maxRounds: this.maxRounds,
                drawTime: this.drawTime,
                maxPlayers: this.maxPlayers
            }).catch(err => console.error(`[GameRoom] Failed to update Redis config:`, err));
        }

        console.log(`[GameRoom:${this.roomCode}] Config — maxRounds: ${this.maxRounds}, drawTime: ${this.drawTime}s, maxPlayers: ${this.maxPlayers}`);

        this.players.forEach(p => p.score = 0);
        await redisClient.clearSolvedSet(this.roomCode);
        this.currentPlayer = 0;
        this.currentRound = 1;
        this.drawer = null;

        await this.machine.dispatch('RESTART');
    }


    async startTurn(){
        if(this.players.length===0){
            return;
        }
        const turn = this.currentPlayer%this.players.length

        this.drawer = this.players[turn]; //this is the new drawer for this turn
        
        if(turn === 0 && this.currentPlayer>0){
            this.currentRound++;
        }
        console.log(`[GameRoom:${this.roomCode}] startTurn — round: ${this.currentRound}/${this.maxRounds}, playerIdx: ${this.currentPlayer}, drawer: ${this.drawer?.name}, state: ${this.machine.getState()}`);
        
        await redisClient.setRoomTurnState(this.roomCode, this.currentPlayer, this.currentRound, this.drawer?.id);

        if(this.currentRound>this.maxRounds){
            await this.machine.dispatch('ALL_ROUNDS_END')
            const scores = this.players.map ((p)=>{
                return {id : p.id , score:p.score}
            })
            const data = { finalScores : scores };
            const io = getIO();
            io.to(this.roomCode).emit("game:over", data);
            flushQueue.add('flush-game', {
                roomCode: this.roomCode,
                finalScores: data.finalScores,
                enqueuedAt: Date.now(),
            }).catch((err: Error) => console.error(`[GameRoom:${this.roomCode}] Failed to enqueue flush job:`, err));
            return;
        }
        await redisClient.clearStrokesInRedis(this.roomCode).catch(err => {
            console.error(`[GameRoom:${this.roomCode}] Failed to clear strokes in Redis:`, err);
        });
        await this.machine.dispatch('NEXT_TURN')

        const io = getIO();
        const words = WordBank.getRandomWords(3);
        
        await redisClient.setPickWords(this.roomCode, words);
        
        io.to(this.drawer?.socketId || "").emit("choose-word", { words });
        
        const jobId = `pick-timer:${this.roomCode}:${this.currentRound}`;
        await timerQueue.add(
            'turn-expire',
            { roomCode: this.roomCode, round: this.currentRound, type: 'pick' },
            { delay: 15000, jobId }
        );
        
        io.to(this.roomCode).emit("chat-message", {
            sender: "System",
            message: `${this.drawer?.name} is picking a word...`
        });
    }

    async endTurn(shift?:boolean){
        const turnData = await redisClient.getTurnDataFromRedis(this.roomCode);
        const endedWord = turnData.word || "";
        const startedAt = turnData.roundStartTime || 0;
        const currentTurnTotalScore = turnData.turnTotalScore || 0;

        if(this.players.length===0){
            return;
        }
        console.log(`[GameRoom:${this.roomCode}] endTurn — state: ${this.machine.getState()}, word: ${endedWord}, round: ${this.currentRound}/${this.maxRounds}`);
        await this.endRoundTimer();

        if(shift){
            if(this.currentRound!=1){
                this.currentPlayer--;
            }
        }else{
            this.currentPlayer++;
        }

        // Calculate and assign drawer score
        const numPotentialGuessers = this.players.length - 1;
        const averageScore = numPotentialGuessers > 0 ? (currentTurnTotalScore / numPotentialGuessers) : 0;
        
        if (this.drawer) {
            this.drawer.score += Math.floor(averageScore);
            await redisClient.updatePlayerScoreInRedis(this.roomCode, this.drawer.id, this.drawer.score).catch(err => {
                console.error(`[GameRoom:${this.roomCode}] Failed to update drawer score:`, err);
            });
        }

        const scores = this.players.map ((p)=>{
            return {id : p.id , score:p.score}
        })
        const io = getIO();
        io.to(this.roomCode).emit("round-end", { word:endedWord , score : scores });

        if (endedWord && this.drawer) {
            await redisClient.insertRoundData(
                this.roomCode,
                this.currentRound,
                endedWord,
                startedAt,
                Date.now(),
                this.drawer.id
            ).catch(err => console.error(`[GameRoom:${this.roomCode}] Failed to insert round data to Redis:`, err));
        }

        await redisClient.clearSolvedSet(this.roomCode);
        await this.startTurn();
    }
}
