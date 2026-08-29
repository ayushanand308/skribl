import { Router } from 'express';
import { apiController } from '../../controllers/apiController';

const router = Router();

router.get('/:roomCode/history', (req, res) => apiController.getRoomHistory(req, res));

router.get('/:id', (req, res) => apiController.getGameReplay(req, res));

export default router;
