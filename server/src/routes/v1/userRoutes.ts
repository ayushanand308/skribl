import { Router } from 'express';
import { apiController } from '../../controllers/apiController';

const router = Router();

router.get('/:id/stats', (req, res) => apiController.getUserStats(req, res));

export default router;
