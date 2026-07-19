import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/app');
});

router.get('/app', (req, res) => {
  res.render('index');
});

router.get('/folder', (req, res) => {
  res.render('folder');
});

router.get('/signin', (req, res) => {
  res.render('login', { isSignup: false });
});

router.get('/signup', (req, res) => {
  res.render('login', { isSignup: true });
});

export default router;
