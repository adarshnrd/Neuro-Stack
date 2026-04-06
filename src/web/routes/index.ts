import express from 'express';
import viewRoutes from './viewRoutes.js';
import apiRoutes from './apiRoutes.js';

const router = express.Router();

router.use(viewRoutes);
router.use(apiRoutes);

export default router;
