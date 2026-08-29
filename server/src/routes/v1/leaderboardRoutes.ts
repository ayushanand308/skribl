import { Router } from 'express';
import { apiController } from '../../controllers/apiController';

const router = Router();
router.get('/', (req, res) => apiController.getLeaderboard(req, res));

export default router;
