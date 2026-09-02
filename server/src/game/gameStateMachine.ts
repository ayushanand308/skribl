import { redisClient } from "../services/redisClient";

//states
type gameState = "LOBBY" | "PICK_WORD" | "DRAW" | "TURN_END" | "GAME_END";

//events
type events = "PICK_TIMER_EXPIRED"
             |"WORD_PICKED"
             |"ALL_GUESSED"
             |"GUESS_TIMER_EXPIRED"
             |"GAME_START" 
             |"NEXT_TURN"
             |"ALL_PLAYERS_LEFT" 
             |"RESTART"
             |"ALL_ROUNDS_END";

//transitions
// a ={state1:{event1:state2,event2:state3}}
// a[state1][event1] = state2
// a[state1][event2] = state3

type StateNode = Record<events, gameState | "IGNORE">;

const transitions: Record<gameState, Record<events,gameState | 'IGNORE'>> = {
    LOBBY: {
        GAME_START: "PICK_WORD",
        ALL_PLAYERS_LEFT: "GAME_END",
        RESTART: "LOBBY",
        PICK_TIMER_EXPIRED: "IGNORE",
        WORD_PICKED: "IGNORE",
        ALL_GUESSED: "IGNORE",
        GUESS_TIMER_EXPIRED: "IGNORE",
        NEXT_TURN: "IGNORE",
        ALL_ROUNDS_END: "IGNORE"
    },
    PICK_WORD: {
        PICK_TIMER_EXPIRED: "DRAW",
        WORD_PICKED: "DRAW",
        ALL_PLAYERS_LEFT: "GAME_END",
        RESTART: "LOBBY",
        GAME_START: "IGNORE",
        ALL_GUESSED: "IGNORE",
        GUESS_TIMER_EXPIRED: "IGNORE",
        NEXT_TURN: "IGNORE",
        ALL_ROUNDS_END: "IGNORE"
    },
    DRAW: {
        GUESS_TIMER_EXPIRED: "TURN_END",
        ALL_GUESSED: "TURN_END",
        ALL_PLAYERS_LEFT: "GAME_END",
        RESTART: "LOBBY",
        NEXT_TURN: "PICK_WORD",
        ALL_ROUNDS_END: "GAME_END",
        GAME_START: "IGNORE",
        PICK_TIMER_EXPIRED: "IGNORE",
        WORD_PICKED: "IGNORE"
    },
    TURN_END: {
        NEXT_TURN: "PICK_WORD",
        ALL_ROUNDS_END: "GAME_END",
        ALL_PLAYERS_LEFT: "GAME_END",
        RESTART: "LOBBY",
        GAME_START: "IGNORE",
        PICK_TIMER_EXPIRED: "IGNORE",
        WORD_PICKED: "IGNORE",
        ALL_GUESSED: "IGNORE",
        GUESS_TIMER_EXPIRED: "IGNORE"
    },
    GAME_END: {
        RESTART: "LOBBY",
        GAME_START: "IGNORE",
        ALL_PLAYERS_LEFT: "IGNORE",
        PICK_TIMER_EXPIRED: "IGNORE",
        WORD_PICKED: "IGNORE",
        ALL_GUESSED: "IGNORE",
        GUESS_TIMER_EXPIRED: "IGNORE",
        NEXT_TURN: "IGNORE",
        ALL_ROUNDS_END: "IGNORE"
    }
};

function dispatch(currentState: gameState, event: events): gameState {
    const nextState = transitions[currentState][event];
    
    if (nextState === "IGNORE") {
        console.warn(`[IGNORE][StateMachine] : ${event} + ${currentState}`);
        return currentState;
    }

    if (!nextState) { 
        console.error(`[FATAL][StateMachine] : Fatal transition ${currentState} + ${event}`);
        throw new Error(`Not a valid transition for ${currentState} and ${event}`);
    }

    console.log(`[StateMachine] ${currentState} --(${event})--> ${nextState}`);
    return nextState;
}

export class GameStateMachine {
    private currentState : gameState ;
    private roomCode?: string;

    constructor(roomCode?: string){
        this.currentState = "LOBBY";
        this.roomCode = roomCode;
    }

    getState() : gameState{
        return this.currentState;
    }

    async syncFromRedis(): Promise<gameState> {
        if (this.roomCode) {
            const redisState = await redisClient.getRoomState(this.roomCode);
            if (redisState) {
                this.currentState = redisState as gameState;
            }
        }
        return this.currentState;
    }

    dispatch(event : events) : gameState{
        const prev = this.currentState;
        this.currentState = dispatch(this.currentState, event);
        if (this.roomCode) {
            redisClient.setRoomState(this.roomCode, this.currentState).catch(err => {
                console.error(`[GameStateMachine:${this.roomCode}] Failed to sync state to Redis:`, err);
            });
        }
        return this.currentState;
    }
}


