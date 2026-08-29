import prisma from '../services/prismaClient';

export class GameQueryHelper {
    async findGamesByRoomCode(roomCode: string) {
        return prisma.game.findMany({
            where: { roomCode },
            include: {
                participants: {
                    select: {
                        id: true,
                        userId: true,
                        displayName: true,
                        finalScore: true,
                    },
                },
            },
            orderBy: { startedAt: 'desc' },
        });
    }

    async findTopScoringParticipants(limit: number = 10) {
        return prisma.gameParticipant.groupBy({
            by: ['userId'],
            _sum: { finalScore: true },
            _count: { gameId: true },
            orderBy: {
                _sum: {
                    finalScore: 'desc',
                },
            },
            take: limit,
        });
    }

    async findUserStats(userId: string) {
        const [gamesCount, aggregateScore, recentGames] = await Promise.all([
            prisma.gameParticipant.count({
                where: { userId },
            }),
            prisma.gameParticipant.aggregate({
                where: { userId },
                _sum: { finalScore: true },
                _avg: { finalScore: true },
            }),
            prisma.gameParticipant.findMany({
                where: { userId },
                include: {
                    game: true,
                },
                orderBy: { game: { startedAt: 'desc' } },
                take: 5,
            }),
        ]);

        return { gamesCount, aggregateScore, recentGames };
    }

    async findGameDetailsById(gameId: string) {
        return prisma.game.findUnique({
            where: { id: gameId },
            include: {
                participants: true,
                rounds: {
                    include: {
                        drawer: true,
                        guesses: {
                            include: {
                                participant: true,
                            },
                        },
                    },
                    orderBy: { roundNumber: 'asc' },
                },
            },
        });
    }
}

export const gameQueryHelper = new GameQueryHelper();
