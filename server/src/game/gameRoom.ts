
import { GameStateMachine } from "./gameStateMachine";
import { player } from "./player";
import { redisClient } from "../services/redisClient";

export class gameRoom{
    machine: GameStateMachine
    players: player[]
    word: string
    timer: NodeJS.Timeout | null
    currentRound: number
    drawer: player | null = null;
    currentPlayer: number = 0;
    maxRounds: number;
    drawTime: number;
    maxPlayers: number;
    roomCode: string;
    hostId: string;
    roundStartTime: number = 0;
    turnTotalScore: number = 0;
    isTurnOver : number = 0;
    onRoundEnd : (data : {
        word:string, 
        score : {
            id:string,
            score:number
        }[]
    }) => void
    onTurnStart : (player:player)=>void
    onGameOver : (data : {
        finalScores : {
            id:string,
            score:number
        }[]
    }) => void


    constructor(maxRounds : number , roomCode : string, hostId: string){
        this.machine = new GameStateMachine();
        this.players = [];
        this.word = "";
        this.timer = null;
        this.currentRound = 1;
        this.maxRounds = maxRounds;
        this.drawTime = 60;
        this.maxPlayers = 8;
        this.roomCode = roomCode;
        this.hostId = hostId;
        this.currentPlayer = 0;
        this.roundStartTime = 0;
        this.turnTotalScore = 0;
        this.onRoundEnd = () => {};
        this.onTurnStart =() => {};
        this.onGameOver = () => {};
        this.isTurnOver = 0;
    }

    addPlayer(player : player){
        this.players.push(player);
    }

    removePlayer(socketId : string){
        console.log(this.players.length, " L1 ")
        this.players =  this.players.filter((p)=>p.socketId!==socketId);
        console.log(this.players.length, " L2 ")

    }

    getPlayerId(socketId: string){
        const player = this.players.find((p)=>p.socketId === socketId);
        return player?.id; 
    }

    isEmpty(){
        return this.players.length === 0;
    }

    startRoundTimer(){
        this.roundStartTime = Date.now();
        this.timer = setTimeout(()=>{
            this.endTurn(false);
        }, this.drawTime * 1000);
    }

    endRoundTimer(){
        this.roundStartTime=0;
        if(this.timer){
            clearTimeout(this.timer);
            this.timer=null;
        }
    }

    getTimeElapsed(): number {
        if (this.roundStartTime === 0) return 0;
        return (Date.now() - this.roundStartTime) / 1000;
    }

    async addScore(playerId: string, score: number, timeElapsed : number): Promise<boolean> {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            //player.score += score;
            //this.turnTotalScore += score;
            const result : [number,number] = await redisClient.recordGuess(this.roomCode, player.id ,timeElapsed, this.players.length - 1);
            const wasNewGuess = result[0];
            if(!wasNewGuess){
                return false;
            }
            player.score += score;
            this.turnTotalScore += score;
            this.isTurnOver = result[1];
            return true;
        }
        return false;
    }

    allGuessed(): boolean {
        return this.isTurnOver?true:false;
    }

    setWord(word:string){
        this.word= word;
    }

    startGame(settings?: {rounds?: number, drawTime?: number, maxPlayers?: number}){
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

        this.machine.dispatch('GAME_START');
        const turn = this.currentPlayer%this.players.length
        this.drawer = this.players[turn];  
        console.log(`[GameRoom:${this.roomCode}] Drawer: ${this.drawer?.name} (${this.drawer?.id})`);

        redisClient.initRoomInRedis(
            { roomCode: this.roomCode, maxRounds: this.maxRounds, drawTimeSecs: this.drawTime },
            this.players.map(p => ({ playerId: p.id, userId: null, displayName: p.name }))
        ).catch(err => console.error(`[GameRoom:${this.roomCode}] Failed to init Redis:`, err));

    }

    restartGame(settings?: {rounds?: number, drawTime?: number, maxPlayers?: number}){
        console.log(`[GameRoom:${this.roomCode}] startGame — state: ${this.machine.getState()}, players: ${this.players.length}, settings:`, settings);
        if(this.machine.getState()!=='GAME_END' || this.players.length<2){
            console.error(`[GameRoom:${this.roomCode}] Cannot start — state: ${this.machine.getState()}, players: ${this.players.length}`);
            return false;
        }

        if(settings){
            if(settings.rounds) this.maxRounds = settings.rounds;
            if(settings.drawTime) this.drawTime = settings.drawTime;
            if(settings.maxPlayers) this.maxPlayers = settings.maxPlayers;
        }

        console.log(`[GameRoom:${this.roomCode}] Config — maxRounds: ${this.maxRounds}, drawTime: ${this.drawTime}s, maxPlayers: ${this.maxPlayers}`);

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.players.forEach(p => p.score = 0);
        redisClient.clearSolvedSet(this.roomCode);
        this.isTurnOver = 0;
        this.turnTotalScore = 0;
        this.currentPlayer = 0;
        this.currentRound = 1;
        this.drawer = null;
        this.word = "";

        this.machine.dispatch('RESTART');
    }


    startTurn(){
        if(this.players.length===0){
            if(this.timer){
                clearTimeout(this.timer);
                this.timer=null;
            }
            return;
        }
        this.turnTotalScore = 0;
        const turn = this.currentPlayer%this.players.length

        this.drawer = this.players[turn]; //this is the new drawer for this turn
        
        if(turn === 0 && this.currentPlayer>0){
            this.currentRound++;
        }
        console.log(`[GameRoom:${this.roomCode}] startTurn — round: ${this.currentRound}/${this.maxRounds}, playerIdx: ${this.currentPlayer}, drawer: ${this.drawer?.name}, state: ${this.machine.getState()}`);

        if(this.currentRound>this.maxRounds){
            this.machine.dispatch('ALL_ROUNDS_END')
            if(this.onGameOver){
                const scores = this.players.map ((p)=>{
                    return {id : p.id , score:p.score}
                })
                this.onGameOver({finalScores : scores})
            }
            return;
        }
        this.machine.dispatch('NEXT_TURN')

        if(this.onTurnStart){
            this.onTurnStart(this.drawer)
        }

    }

    endTurn(shift?:boolean){
        const startedAt = this.roundStartTime;
        const endedWord = this.word;
        this.word = "";
        if(this.players.length===0){
            if(this.timer){
                clearTimeout(this.timer);
                this.timer=null;
            }
            return;
        }
        console.log(`[GameRoom:${this.roomCode}] endTurn — state: ${this.machine.getState()}, word: ${endedWord}, round: ${this.currentRound}/${this.maxRounds}`);
        this.endRoundTimer();

        if(shift){
            if(this.currentRound!=1){
                this.currentPlayer--;
            }
        }else{
            this.currentPlayer++;
        }

        // Calculate and assign drawer score
        const numPotentialGuessers = this.players.length - 1;
        const averageScore = numPotentialGuessers > 0 ? (this.turnTotalScore / numPotentialGuessers) : 0;
        
        if (this.drawer) {
            this.drawer.score += Math.floor(averageScore);
        }

        if(this.onRoundEnd){
            const scores = this.players.map ((p)=>{
                return {id : p.id , score:p.score}
            })
            this.onRoundEnd({word:endedWord , score : scores})
        }

        if (endedWord && this.drawer) {
            redisClient.insertRoundData(
                this.roomCode,
                this.currentRound,
                endedWord,
                startedAt,
                Date.now(),
                this.drawer.id
            ).catch(err => console.error(`[GameRoom:${this.roomCode}] Failed to insert round data to Redis:`, err));
        }

        redisClient.clearSolvedSet(this.roomCode);
        this.isTurnOver = 0;
        this.startTurn();
    }
}
