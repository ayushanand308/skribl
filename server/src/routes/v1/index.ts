import { Router } from 'express';
import gameRoutes from './gameRoutes';
import userRoutes from './userRoutes';
import leaderboardRoutes from './leaderboardRoutes';

const v1Router = Router();

v1Router.use('/games', gameRoutes);
v1Router.use('/users', userRoutes);
v1Router.use('/leaderboard', leaderboardRoutes);

export default v1Router;
