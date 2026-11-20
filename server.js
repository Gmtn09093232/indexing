require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const SECRET         = String(process.env.WORKSHOP_SECRET || '');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME    = 'gw_session';

if (!SECRET) {
  console.error('FATAL: WORKSHOP_SECRET is not set in .env');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4kb' }));

/* ---------- session tokens (HMAC-signed, no extra deps) ---------- */
const sign   = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
const hmacOk = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!hmacOk(sig, sign(payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch { return false; }
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const isAuthed = req => verifyToken(parseCookies(req.headers.cookie || '')[COOKIE_NAME]);

/* ---------- brute-force protection ---------- */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 10 * 60 * 1000;
const BLOCK_MS     = 15 * 60 * 1000;

function getRecord(ip) {
  const now = Date.now();
  let r = attempts.get(ip);
  if (!r || now - r.firstAt > WINDOW_MS) {
    r = { count: 0, firstAt: now, blockedUntil: 0 };
    attempts.set(ip, r);
  }
  return r;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of attempts) {
    if (now - r.firstAt > WINDOW_MS && r.blockedUntil < now) attempts.delete(ip);
  }
}, 60_000).unref();

/* ---------- API ---------- */
app.post('/api/unlock', (req, res) => {
  const rec = getRecord(req.ip);
  if (rec.blockedUntil > Date.now()) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const code = String(req.body?.code ?? '').trim();

  const a = Buffer.from(code.padEnd(SECRET.length, '\0'));
  const b = Buffer.from(SECRET.padEnd(SECRET.length, '\0'));
  const match = code.length === SECRET.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    rec.count++;
    if (rec.count >= MAX_ATTEMPTS) rec.blockedUntil = Date.now() + BLOCK_MS;
    return res.status(401).json({ ok: false, error: 'Incorrect code.' });
  }

  rec.count = 0;
  res.cookie(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/session',  (req, res) => res.json({ authenticated: isAuthed(req) }));
app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

/* ---------- page ---------- */
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, isAuthed(req) ? 'index.html' : 'lock.html'));
});

/* ---------- hard block: never serve the source files by direct URL ---------- */
app.get(
  ['/index.html', '/lock.html', '/server.js', '/.env', '/package.json', '/package-lock.json'],
  (req, res) => res.status(404).end()
);

/* ---------- optional: static assets only ---------- */
/* put images/favicons in public/, NEVER a copy of index.html */
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));

app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
