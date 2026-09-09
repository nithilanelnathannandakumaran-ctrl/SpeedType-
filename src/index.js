/**
 * SpeedType — Cloudflare Workers edition
 *
 * This replaces the Node.js server.js entirely. Key differences from the
 * Node version:
 *  - No filesystem. All storage (users, sessions, admin sessions, the
 *    announcement) lives in D1, Cloudflare's SQLite database.
 *  - No Node `crypto` module. Password/PIN hashing uses PBKDF2 via the
 *    Web Crypto API (crypto.subtle), which is natively available in
 *    Workers without any compatibility flags.
 *  - Static files (index.html, style.css, script.js) aren't served from
 *    here at all — Cloudflare serves the `public/` folder directly and
 *    only invokes this script for paths that don't match a static file
 *    (i.e. everything under /api/*). See wrangler.jsonc's "assets" block.
 *  - No `process.env` — the ADMIN_USERNAME variable and the DB binding
 *    both arrive via the `env` parameter Cloudflare passes into fetch().
 */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{4,6}$/;
const ADMIN_SESSION_MS = 20 * 60 * 1000; // 20 minutes
const PBKDF2_ITERATIONS = 100000;

/* ================= crypto helpers (Web Crypto, no Node) ================= */
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function randomHex(byteLen) {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}
function makeSalt() { return randomHex(16); }
function makeToken() { return randomHex(24); }

async function hashSecret(secret, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

/* ================= small helpers ================= */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}
function defaultSettings() {
  return { theme: 'analog', font: 'jetbrains', caretStyle: 'line', smoothCaret: true, sound: false, blindMode: false };
}
function publicProfile(row) {
  return {
    username: row.display_name,
    isAdmin: !!row.is_admin,
    hasPin: !!row.pin_hash,
    settings: JSON.parse(row.settings),
    stats: { bestWpm: row.best_wpm, history: JSON.parse(row.history) }
  };
}

async function requireUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return await env.DB
    .prepare('SELECT users.* FROM sessions JOIN users ON sessions.username = users.username WHERE sessions.token = ?1')
    .bind(token)
    .first();
}

async function requireAdminSession(request, env, user) {
  const adminToken = request.headers.get('x-admin-token') || '';
  if (!adminToken) return false;
  const row = await env.DB.prepare('SELECT * FROM admin_sessions WHERE admin_token = ?1').bind(adminToken).first();
  if (!row) return false;
  if (row.username !== user.username) return false;
  if (Date.now() > row.expires) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_token = ?1').bind(adminToken).run();
    return false;
  }
  return true;
}

/* ================= route handlers ================= */

async function handleSignup(request, env) {
  const body = await readJson(request);
  const usernameRaw = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(usernameRaw)) return json({ error: 'Username must be 3-20 letters, numbers, or underscores.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);

  const key = usernameRaw.toLowerCase();
  const existing = await env.DB.prepare('SELECT username FROM users WHERE username = ?1 OR email = ?2').bind(key, email).first();
  if (existing) return json({ error: existing.username === key ? 'That username is already taken.' : 'That email is already registered.' }, 400);

  const ADMIN_USERNAME = (env.ADMIN_USERNAME || 'elnathan').trim().toLowerCase();
  const salt = makeSalt();
  const passwordHash = await hashSecret(password, salt);
  const isAdmin = key === ADMIN_USERNAME ? 1 : 0;
  const settings = JSON.stringify(defaultSettings());
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO users (username, display_name, email, salt, password_hash, is_admin, settings, best_wpm, history, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, '[]', ?8)`
  ).bind(key, usernameRaw, email, salt, passwordHash, isAdmin, settings, now).run();

  const token = makeToken();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?1, ?2, ?3)').bind(token, key, now).run();

  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?1').bind(key).first();
  return json({ token, profile: publicProfile(row) });
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const identifier = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!identifier) return json({ error: 'Wrong username/email or password.' }, 400);

  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?1 OR email = ?1').bind(identifier).first();
  if (!row) return json({ error: 'Wrong username/email or password.' }, 400);
  const hash = await hashSecret(password, row.salt);
  if (hash !== row.password_hash) return json({ error: 'Wrong username/email or password.' }, 400);

  const token = makeToken();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?1, ?2, ?3)').bind(token, row.username, Date.now()).run();
  return json({ token, profile: publicProfile(row) });
}

async function handleLogout(request, env) {
  const body = await readJson(request);
  const token = String(body.token || '');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  return json({ ok: true });
}

async function handleMe(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  return json({ profile: publicProfile(user) });
}

async function handleSettings(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  const body = await readJson(request);
  const settings = JSON.parse(user.settings);
  const allowedKeys = ['theme', 'font', 'caretStyle', 'smoothCaret', 'sound', 'blindMode'];
  allowedKeys.forEach(k => { if (k in body) settings[k] = body[k]; });
  await env.DB.prepare('UPDATE users SET settings = ?1 WHERE username = ?2').bind(JSON.stringify(settings), user.username).run();
  return json({ settings });
}

async function handleResult(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  const body = await readJson(request);
  const result = {
    ts: Date.now(),
    mode: body.mode === 'words' ? 'words' : 'time',
    amount: Number(body.amount) || 0,
    wpm: Math.max(0, Math.round(Number(body.wpm) || 0)),
    rawWpm: Math.max(0, Math.round(Number(body.rawWpm) || 0)),
    accuracy: Math.min(100, Math.max(0, Math.round(Number(body.accuracy) || 0))),
    correct: Math.max(0, Math.round(Number(body.correct) || 0)),
    incorrect: Math.max(0, Math.round(Number(body.incorrect) || 0)),
    totalTyped: Math.max(0, Math.round(Number(body.totalTyped) || 0))
  };

  const history = JSON.parse(user.history);
  history.unshift(result);
  const trimmed = history.slice(0, 100);
  const bestWpm = Math.max(user.best_wpm, result.wpm);

  await env.DB.prepare('UPDATE users SET history = ?1, best_wpm = ?2 WHERE username = ?3')
    .bind(JSON.stringify(trimmed), bestWpm, user.username).run();

  return json({ stats: { bestWpm, history: trimmed } });
}

async function handleLeaderboard(env) {
  const { results } = await env.DB.prepare(
    'SELECT display_name as username, best_wpm as bestWpm, is_admin as isAdmin FROM users WHERE best_wpm > 0 ORDER BY best_wpm DESC LIMIT 20'
  ).all();
  return json({ leaderboard: results.map(r => ({ username: r.username, bestWpm: r.bestWpm, isAdmin: !!r.isAdmin })) });
}

async function handleGetAnnouncement(env) {
  const row = await env.DB.prepare('SELECT * FROM announcement WHERE id = 1').first();
  if (!row || !row.text) return json({ announcement: null });
  return json({ announcement: { id: String(row.ts), text: row.text, ts: row.ts, by: row.by } });
}

async function handlePostAnnouncement(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  if (!(await requireAdminSession(request, env, user))) return json({ error: 'Admin session expired — unlock again.' }, 401);
  const body = await readJson(request);
  const text = String(body.text || '').trim().slice(0, 240);

  if (!text) {
    await env.DB.prepare('DELETE FROM announcement WHERE id = 1').run();
    return json({ announcement: null });
  }
  const ts = Date.now();
  await env.DB.prepare(
    'INSERT INTO announcement (id, text, ts, by) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET text=?1, ts=?2, by=?3'
  ).bind(text, ts, user.display_name).run();
  return json({ announcement: { id: String(ts), text, ts, by: user.display_name } });
}

async function handleAdminSetPin(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  const body = await readJson(request);
  const newPin = String(body.newPin || '');
  if (!PIN_RE.test(newPin)) return json({ error: 'PIN must be 4-6 digits.' }, 400);
  if (user.pin_hash) {
    const currentPin = String(body.currentPin || '');
    const check = await hashSecret(currentPin, user.pin_salt);
    if (check !== user.pin_hash) return json({ error: 'Current PIN is incorrect.' }, 400);
  }
  const pinSalt = makeSalt();
  const pinHash = await hashSecret(newPin, pinSalt);
  await env.DB.prepare('UPDATE users SET pin_salt = ?1, pin_hash = ?2 WHERE username = ?3').bind(pinSalt, pinHash, user.username).run();
  return json({ ok: true });
}

async function handleAdminUnlock(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  if (!user.pin_hash) return json({ error: 'Set an admin PIN first.' }, 400);
  const body = await readJson(request);
  const pin = String(body.pin || '');
  const check = await hashSecret(pin, user.pin_salt);
  if (check !== user.pin_hash) return json({ error: 'Incorrect PIN.' }, 400);

  const adminToken = makeToken();
  await env.DB.prepare('INSERT INTO admin_sessions (admin_token, username, expires) VALUES (?1, ?2, ?3)')
    .bind(adminToken, user.username, Date.now() + ADMIN_SESSION_MS).run();
  return json({ adminToken, expiresInMs: ADMIN_SESSION_MS });
}

async function handleAdminUsers(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  if (!(await requireAdminSession(request, env, user))) return json({ error: 'Admin session expired — unlock again.' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT display_name as username, email, is_admin as isAdmin, best_wpm as bestWpm,
            json_array_length(history) as testsLogged, created_at as createdAt
     FROM users ORDER BY display_name COLLATE NOCASE`
  ).all();
  return json({ users: results.map(r => ({ ...r, isAdmin: !!r.isAdmin })) });
}

async function handleAdminResetStats(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  if (!(await requireAdminSession(request, env, user))) return json({ error: 'Admin session expired — unlock again.' }, 401);
  const body = await readJson(request);
  const key = String(body.username || '').trim().toLowerCase();
  const target = await env.DB.prepare('SELECT username FROM users WHERE username = ?1').bind(key).first();
  if (!target) return json({ error: 'User not found.' }, 404);
  await env.DB.prepare("UPDATE users SET best_wpm = 0, history = '[]' WHERE username = ?1").bind(key).run();
  return json({ ok: true });
}

async function handleAdminDeleteUser(request, env) {
  const user = await requireUser(request, env);
  if (!user || !user.is_admin) return json({ error: 'Admins only.' }, 403);
  if (!(await requireAdminSession(request, env, user))) return json({ error: 'Admin session expired — unlock again.' }, 401);
  const body = await readJson(request);
  const key = String(body.username || '').trim().toLowerCase();
  const ADMIN_USERNAME = (env.ADMIN_USERNAME || 'elnathan').trim().toLowerCase();

  if (key === user.username) return json({ error: "You can't delete your own account from here." }, 400);
  if (key === ADMIN_USERNAME) return json({ error: "Can't delete the designated admin account." }, 400);
  const target = await env.DB.prepare('SELECT username FROM users WHERE username = ?1').bind(key).first();
  if (!target) return json({ error: 'User not found.' }, 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM users WHERE username = ?1').bind(key),
    env.DB.prepare('DELETE FROM sessions WHERE username = ?1').bind(key)
  ]);
  return json({ ok: true });
}

/* ================= router ================= */
const ROUTES = [
  ['POST', '/api/signup', handleSignup],
  ['POST', '/api/login', handleLogin],
  ['POST', '/api/logout', handleLogout],
  ['GET', '/api/me', handleMe],
  ['POST', '/api/settings', handleSettings],
  ['POST', '/api/result', handleResult],
  ['GET', '/api/leaderboard', (req, env) => handleLeaderboard(env)],
  ['GET', '/api/announcement', (req, env) => handleGetAnnouncement(env)],
  ['POST', '/api/admin/announcement', handlePostAnnouncement],
  ['POST', '/api/admin/set-pin', handleAdminSetPin],
  ['POST', '/api/admin/unlock', handleAdminUnlock],
  ['GET', '/api/admin/users', handleAdminUsers],
  ['POST', '/api/admin/reset-stats', handleAdminResetStats],
  ['POST', '/api/admin/delete-user', handleAdminDeleteUser]
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    for (const [method, path, handler] of ROUTES) {
      if (request.method === method && url.pathname === path) {
        try {
          return await handler(request, env);
        } catch (err) {
          return json({ error: 'Server error: ' + err.message }, 500);
        }
      }
    }
    // Anything else reaching this Worker (not matched by a static asset
    // either) is a genuinely unknown route.
    return json({ error: 'Not found' }, 404);
  }
};
