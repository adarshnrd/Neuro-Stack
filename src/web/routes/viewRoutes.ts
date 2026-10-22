import express from 'express';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.redirect('/app');
});

router.get('/app', (_req, res) => {
  res.render('index');
});

router.get('/folder', requireAdmin, (_req, res) => {
  res.render('folder');
});

router.get('/signin', (_req, res) => {
  res.render('login', { isSignup: false });
});

router.get('/signup', (_req, res) => {
  res.render('login', { isSignup: true });
});

export default router;
