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

const transitions : Record<gameState, Partial<Record<events, gameState>>> = {
    LOBBY :{
        GAME_START : "PICK_WORD",
        ALL_PLAYERS_LEFT : "GAME_END",
        RESTART : "LOBBY"
    },
    PICK_WORD :{
        PICK_TIMER_EXPIRED : "DRAW",
        WORD_PICKED : "DRAW",
        ALL_PLAYERS_LEFT : "GAME_END",
        RESTART : "LOBBY"
    },
    DRAW : {
        GUESS_TIMER_EXPIRED : "TURN_END",
        ALL_GUESSED : "TURN_END",
        ALL_PLAYERS_LEFT : "GAME_END",
        RESTART : "LOBBY"
    },
    TURN_END : {
        NEXT_TURN : "PICK_WORD",
        ALL_ROUNDS_END : "GAME_END",
        ALL_PLAYERS_LEFT : "GAME_END",
        RESTART : "LOBBY"
    },
    GAME_END : {
        RESTART : "LOBBY"
    }
}

function dispatch(currentState : gameState , event : events) : gameState {
    const nextState = transitions[currentState][event];
    
    if(!nextState){ 
        throw new Error(`Not a valid transition for ${currentState} and ${event}`);
    }

    return nextState;
}

export class GameStateMachine {
    private currentState : gameState ;

    constructor(){
        this.currentState = "LOBBY";
    }

    getState() : gameState{
        return this.currentState;
    }

    dispatch(event : events) : gameState{
        this.currentState = dispatch(this.currentState, event);
        return this.currentState;
    }
}


