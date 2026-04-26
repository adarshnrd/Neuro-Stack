import express from 'express';
import viewRoutes from './viewRoutes.js';
import apiRoutes from './apiRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import authRoutes from './authRoutes.js';

const router = express.Router();

router.use(authRoutes);
router.use(viewRoutes);
router.use(apiRoutes);
router.use(reviewRoutes);

export default router;
