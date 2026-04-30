import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.send('Hello NeuroStack');
});

router.get('/app', (req, res) => {
  res.render('index');
});

router.get('/signin', (req, res) => {
  res.render('login', { isSignup: false });
});

router.get('/signup', (req, res) => {
  res.render('login', { isSignup: true });
});

export default router;
