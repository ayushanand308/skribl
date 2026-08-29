import { Request, Response } from 'express';
import { gameQueryHandler } from '../handlers/gameQueryHandler';

export class ApiController {
    async getRoomHistory(req: Request, res: Response): Promise<void> {
        try {
            const roomCode = String(req.params.roomCode);
            if (!roomCode) {
                res.status(400).json({ error: 'roomCode is required' });
                return;
            }

            const history = await gameQueryHandler.handleGetRoomHistory(roomCode.toUpperCase());
            res.json({ success: true, data: history });
        } catch (err) {
            console.error('[ApiController] Error in getRoomHistory:', err);
            res.status(500).json({ error: 'Failed to fetch room history' });
        }
    }

    async getLeaderboard(req: Request, res: Response): Promise<void> {
        try {
            const limit = req.query.limit ? Number(req.query.limit) : 10;
            const leaderboard = await gameQueryHandler.handleGetLeaderboard(limit);
            res.json({ success: true, data: leaderboard });
        } catch (err) {
            console.error('[ApiController] Error in getLeaderboard:', err);
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    }

    async getUserStats(req: Request, res: Response): Promise<void> {
        try {
            const id = String(req.params.id);
            if (!id) {
                res.status(400).json({ error: 'userId is required' });
                return;
            }

            const stats = await gameQueryHandler.handleGetUserStats(id);
            res.json({ success: true, data: stats });
        } catch (err) {
            console.error('[ApiController] Error in getUserStats:', err);
            res.status(500).json({ error: 'Failed to fetch user stats' });
        }
    }

    async getGameReplay(req: Request, res: Response): Promise<void> {
        try {
            const id = String(req.params.id);
            if (!id) {
                res.status(400).json({ error: 'gameId is required' });
                return;
            }

            const replay = await gameQueryHandler.handleGetGameReplay(id);
            if (!replay) {
                res.status(404).json({ error: 'Game not found' });
                return;
            }

            res.json({ success: true, data: replay });
        } catch (err) {
            console.error('[ApiController] Error in getGameReplay:', err);
            res.status(500).json({ error: 'Failed to fetch game replay' });
        }
    }
}

export const apiController = new ApiController();
