import { gameQueryHelper } from '../helpers/gameQueryHelper';

type GameWithParticipants = Awaited<ReturnType<typeof gameQueryHelper.findGamesByRoomCode>>[number];
type GameParticipantSummary = GameWithParticipants['participants'][number];
type LeaderboardItem = Awaited<ReturnType<typeof gameQueryHelper.findTopScoringParticipants>>[number];
type RecentGameParticipant = Awaited<ReturnType<typeof gameQueryHelper.findUserStats>>['recentGames'][number];
type GameDetails = NonNullable<Awaited<ReturnType<typeof gameQueryHelper.findGameDetailsById>>>;
type GameDetailParticipant = GameDetails['participants'][number];
type RoundWithGuesses = GameDetails['rounds'][number];
type GuessWithParticipant = RoundWithGuesses['guesses'][number];

export class GameQueryHandler {
    async handleGetRoomHistory(roomCode: string) {
        const games = await gameQueryHelper.findGamesByRoomCode(roomCode);
        return games.map((g: GameWithParticipants) => ({
            id: g.id,
            roomCode: g.roomCode,
            maxRounds: g.maxRounds,
            drawTimeSecs: g.drawTimeSecs,
            startedAt: g.startedAt,
            endedAt: g.endedAt,
            playerCount: g.participants.length,
            winner: g.participants.sort((a: GameParticipantSummary, b: GameParticipantSummary) => b.finalScore - a.finalScore)[0] || null,
        }));
    }

    async handleGetLeaderboard(limit: number = 10) {
        const rawLeaderboard = await gameQueryHelper.findTopScoringParticipants(limit);
        return rawLeaderboard.map((item: LeaderboardItem, rank: number) => ({
            rank: rank + 1,
            userId: item.userId,
            totalScore: item._sum.finalScore || 0,
            gamesPlayed: item._count.gameId,
        }));
    }

    async handleGetUserStats(userId: string) {
        const rawStats = await gameQueryHelper.findUserStats(userId);
        return {
            userId,
            totalGamesPlayed: rawStats.gamesCount,
            totalScore: rawStats.aggregateScore._sum.finalScore || 0,
            averageScore: Math.round(rawStats.aggregateScore._avg.finalScore || 0),
            recentGames: rawStats.recentGames.map((pg: RecentGameParticipant) => ({
                gameId: pg.gameId,
                roomCode: pg.game.roomCode,
                score: pg.finalScore,
                playedAt: pg.game.startedAt,
            })),
        };
    }

    async handleGetGameReplay(gameId: string) {
        const game = await gameQueryHelper.findGameDetailsById(gameId);
        if (!game) {
            return null;
        }

        return {
            id: game.id,
            roomCode: game.roomCode,
            maxRounds: game.maxRounds,
            drawTimeSecs: game.drawTimeSecs,
            startedAt: game.startedAt,
            endedAt: game.endedAt,
            participants: game.participants.map((p: GameDetailParticipant) => ({
                id: p.id,
                displayName: p.displayName,
                finalScore: p.finalScore,
            })),
            rounds: game.rounds.map((r: RoundWithGuesses) => ({
                roundNumber: r.roundNumber,
                word: r.word,
                drawerName: r.drawer.displayName,
                startedAt: r.startedAt,
                endedAt: r.endedAt,
                guesses: r.guesses.map((g: GuessWithParticipant) => ({
                    guesserName: g.participant.displayName,
                    guess: g.guess,
                    correct: g.correct,
                    timeTakenMs: g.timeTakenMs,
                    guessedAt: g.guessedAt,
                })),
            })),
        };
    }
}

export const gameQueryHandler = new GameQueryHandler();
