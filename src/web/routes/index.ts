import express from 'express';
import viewRoutes from './viewRoutes.js';
import apiRoutes from './apiRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import authRoutes from './authRoutes.js';
import loopRoutes from './loopRoutes.js';
import folderRoutes from './folderRoutes.js';

const router = express.Router();

router.use(authRoutes);
router.use(viewRoutes);
router.use(apiRoutes);
router.use(reviewRoutes);
router.use(loopRoutes);
router.use(folderRoutes);

export default router;
