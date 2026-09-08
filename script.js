/* ============================================================
   SpeedType — client (server-backed version)
   The typing engine itself (word generation, rendering, keystroke
   handling, timing) runs entirely client-side, same as before.
   Accounts, settings, stats and the admin panel now talk to a
   real server instead of localStorage, so they sync across
   devices.
   ============================================================ */

const WORD_LIST = [
  'time','year','people','way','day','man','thing','woman','life','child','world','school','state','family','student',
  'group','country','problem','hand','part','place','case','week','company','system','program','question','work','government','number',
  'night','point','home','water','room','mother','area','money','story','fact','month','lot','right','study','book',
  'eye','job','word','business','issue','side','kind','head','house','service','friend','father','power','hour','game',
  'line','end','member','law','car','city','community','name','president','team','minute','idea','body','information','back',
  'parent','face','others','level','office','door','health','person','art','war','history','party','result','change','morning',
  'reason','research','girl','guy','moment','air','teacher','force','education','foot','boy','age','policy','process','music',
  'market','sense','nation','plan','college','interest','death','experience','effect','use','class','control','care','field','development',
  'role','effort','rate','heart','drug','show','leader','light','voice','wife','whole','police','mind','price','report',
  'decision','son','view','relationship','town','road','arm','wall','value','property','structure','love','industry','self','risk',
  'space','table','ground','form','event','official','matter','ball','model','order','practice','rest','performance','paper','future',
  'sound','couple','south','project','activity','mouth','staff','answer','skill','individual','oil','ability','organization','sport','item',
  'stage','difference','energy','memory','building','wind','need','application','baby','trade','store','material','camera','network','picture',
  'season','red','image','tree','author','wood','patient','test','current','wait','support','position','device','choice',
  'unit','sun','loss','stock','environment','floor','share','military','beat','film','sky','box','pattern'
];

const THEMES = [
  { id: 'analog', label: 'Analog' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'paper', label: 'Paper' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Ocean' }
];

/* ============================================================
   API helper
   ============================================================ */
function getToken() { return localStorage.getItem('tf_token') || ''; }
function setToken(t) { localStorage.setItem('tf_token', t); }
function clearToken() { localStorage.removeItem('tf_token'); }

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (res.status === 401 && path !== '/api/login' && path !== '/api/signup') {
    handleSessionExpired();
  }
  return { ok: res.ok, status: res.status, data };
}

function handleSessionExpired() {
  clearToken();
  currentProfile = null;
  showAuthScreen('Your session ended — please log in again.');
}

/* ============================================================
   App state
   ============================================================ */
let currentProfile = null; // { username, isAdmin, hasPin, settings, stats }
let adminToken = null;     // only kept in memory, never persisted

function defaultSettings() {
  return { theme: 'analog', font: 'jetbrains', caretStyle: 'line', smoothCaret: true, sound: false, blindMode: false };
}

const state = {
  mode: 'time',
  amount: 30,
  isGuest: false,
  words: [],
  flatTargets: [],
  typedStates: [],
  currentIndex: 0,
  testActive: false,
  testEnded: false,
  startTime: null,
  timeLeft: 30,
  timerHandle: null,
  liveWpmHistory: []
};

/* ---------------- DOM refs ---------------- */
const authScreen = document.getElementById('authScreen');
const appRoot = document.getElementById('appRoot');
const tabLogin = document.getElementById('tabLogin');
const tabSignup = document.getElementById('tabSignup');
const authUsername = document.getElementById('authUsername');
const authUsernameLabel = document.getElementById('authUsernameLabel');
const authEmailField = document.getElementById('authEmailField');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authError = document.getElementById('authError');

const typeArea = document.getElementById('typeArea');
const statsLive = document.getElementById('statsLive');
const liveStatNum = document.getElementById('liveStatNum');
const liveWpmNum = document.getElementById('liveWpmNum');
const liveStatLabel = document.getElementById('liveStatLabel');
const resultsEl = document.getElementById('results');
const testWrap = document.getElementById('testWrap');
const configBar = document.getElementById('configBar');
const profileBtn = document.getElementById('profileBtn');
const settingsBtn = document.getElementById('settingsBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const drawer = document.getElementById('drawer');
const overlayScrim = document.getElementById('overlayScrim');
const drawerClose = document.getElementById('drawerClose');
const themeSwatches = document.getElementById('themeSwatches');
const fontPill = document.getElementById('fontPill');
const caretPill = document.getElementById('caretPill');
const smoothCaretSwitch = document.getElementById('smoothCaretSwitch');
const soundSwitch = document.getElementById('soundSwitch');
const blindModeSwitch = document.getElementById('blindModeSwitch');
const accountBox = document.getElementById('accountBox');
const adminSection = document.getElementById('adminSection');
const adminSectionInner = document.getElementById('adminSectionInner');
const pinModal = document.getElementById('pinModal');
const pinModalTitle = document.getElementById('pinModalTitle');
const pinModalSub = document.getElementById('pinModalSub');
const pinInput = document.getElementById('pinInput');
const pinSubmit = document.getElementById('pinSubmit');
const pinCancel = document.getElementById('pinCancel');
const pinError = document.getElementById('pinError');
const adminPanel = document.getElementById('adminPanel');
const adminTableBody = document.getElementById('adminTableBody');
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardList = document.getElementById('leaderboardList');
const leaderboardClose = document.getElementById('leaderboardClose');
const guestBtn = document.getElementById('guestBtn');
const announceBanner = document.getElementById('announceBanner');
const announceText = document.getElementById('announceText');
const announceDismiss = document.getElementById('announceDismiss');
const announceInput = document.getElementById('announceInput');
const sendAnnounceBtn = document.getElementById('sendAnnounceBtn');
const clearAnnounceBtn = document.getElementById('clearAnnounceBtn');
const announceMsg = document.getElementById('announceMsg');

/* ============================================================
   Auth screen
   ============================================================ */
let authMode = 'login';
tabLogin.addEventListener('click', () => setAuthMode('login'));
tabSignup.addEventListener('click', () => setAuthMode('signup'));
function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle('active', mode === 'login');
  tabSignup.classList.toggle('active', mode === 'signup');
  authSubmitBtn.textContent = mode === 'login' ? 'Log in' : 'Sign up';
  authEmailField.classList.toggle('hidden', mode === 'login');
  authUsernameLabel.textContent = mode === 'login' ? 'Username or email' : 'Username';
  authUsername.placeholder = mode === 'login' ? 'e.g. elnathan or you@example.com' : 'e.g. elnathan';
  authError.textContent = '';
}

authSubmitBtn.addEventListener('click', doAuthSubmit);
authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });
authUsername.addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });
authEmail.addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });

async function doAuthSubmit() {
  const username = authUsername.value.trim();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.textContent = '';
  if (!username || !password) { authError.textContent = 'Enter a username and password.'; return; }
  if (authMode === 'signup' && !email) { authError.textContent = 'Enter your email.'; return; }

  authSubmitBtn.disabled = true;
  const original = authSubmitBtn.textContent;
  authSubmitBtn.textContent = authMode === 'login' ? 'Logging in...' : 'Signing up...';

  const body = authMode === 'signup' ? { username, email, password } : { username, password };
  const { ok, data } = await api('/api/' + authMode, { method: 'POST', body });

  authSubmitBtn.disabled = false;
  authSubmitBtn.textContent = original;

  if (!ok) { authError.textContent = data.error || 'Something went wrong.'; return; }
  setToken(data.token);
  currentProfile = data.profile;
  enterApp();
}

function showAuthScreen(message) {
  stopAnnouncementPolling();
  authScreen.style.display = 'flex';
  appRoot.style.display = 'none';
  if (message) authError.textContent = message;
  authUsername.value = '';
  authPassword.value = '';
  window.scrollTo(0, 0);
}

guestBtn.addEventListener('click', enterAsGuest);
function enterAsGuest() {
  state.isGuest = true;
  currentProfile = { username: 'Guest', isAdmin: false, hasPin: false, settings: defaultSettings(), stats: { bestWpm: 0, history: [] } };
  enterApp();
}

/* ============================================================
   Entering the app
   ============================================================ */
async function enterApp() {
  authScreen.style.display = 'none';
  appRoot.style.display = '';
  applyAllSettings();
  syncConfigBarUI();
  startNewTest();
  refreshTopbar();
  startAnnouncementPolling();
  window.scrollTo(0, 0);
}

async function doLogout() {
  stopAnnouncementPolling();
  if (!state.isGuest) await api('/api/logout', { method: 'POST', body: { token: getToken() } });
  clearToken();
  currentProfile = null;
  adminToken = null;
  state.isGuest = false;
  location.reload();
}

/* ============================================================
   Word / test generation (unchanged typing engine)
   ============================================================ */
function randomWord() { return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)]; }

function buildTargetWords() {
  const count = state.mode === 'words' ? state.amount : 200;
  const words = [];
  for (let i = 0; i < count; i++) words.push(randomWord());
  return words;
}

function flattenWords(words) {
  const flat = [];
  words.forEach((word, wIdx) => {
    word.split('').forEach(ch => flat.push({ char: ch, wordIndex: wIdx }));
    if (wIdx < words.length - 1) flat.push({ char: ' ', wordIndex: wIdx });
  });
  return flat;
}

function renderTypeArea() {
  typeArea.innerHTML = '';
  let wordSpan = null;
  let lastWordIndex = -1;
  state.flatTargets.forEach((entry, i) => {
    if (entry.wordIndex !== lastWordIndex) {
      wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      typeArea.appendChild(wordSpan);
      lastWordIndex = entry.wordIndex;
    }
    const charSpan = document.createElement('span');
    charSpan.className = 'char';
    charSpan.textContent = entry.char === ' ' ? '\u00A0' : entry.char;
    charSpan.dataset.index = i;
    wordSpan.appendChild(charSpan);
  });
  updateCaretPosition();
}

function updateCaretPosition() {
  const chars = typeArea.querySelectorAll('.char');
  chars.forEach(c => c.classList.remove('current'));
  if (state.currentIndex < chars.length) chars[state.currentIndex].classList.add('current');
}

function startNewTest() {
  clearInterval(state.timerHandle);
  state.words = buildTargetWords();
  state.flatTargets = flattenWords(state.words);
  state.typedStates = new Array(state.flatTargets.length).fill(undefined);
  state.currentIndex = 0;
  state.testActive = false;
  state.testEnded = false;
  state.startTime = null;
  state.timeLeft = state.mode === 'time' ? state.amount : 0;
  state.liveWpmHistory = [];
  liveWpmNum.textContent = '0';

  resultsEl.classList.remove('show');
  testWrap.style.display = '';
  statsLive.classList.remove('show');
  typeArea.classList.remove('blurred');
  renderTypeArea();
  updateLiveStatsDisplay();
  typeArea.focus({ preventScroll: true });
}

/* ============================================================
   Typing input handling (unchanged)
   ============================================================ */
typeArea.setAttribute('tabindex', '0');
typeArea.addEventListener('keydown', onKeyDown);
typeArea.addEventListener('click', () => typeArea.focus({ preventScroll: true }));

function onKeyDown(e) {
  if (state.testEnded) return;
  if (e.key === 'Tab') { e.preventDefault(); startNewTest(); return; }
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.typedStates[state.currentIndex] = undefined;
      renderCharState(state.currentIndex);
      updateCaretPosition();
    }
    return;
  }
  if (e.key.length !== 1) return;
  e.preventDefault();

  if (!state.testActive) beginTest();

  const target = state.flatTargets[state.currentIndex];
  if (!target) return;
  const correct = e.key === target.char;
  state.typedStates[state.currentIndex] = correct ? 'correct' : 'incorrect';
  renderCharState(state.currentIndex);
  playKeySound();
  state.currentIndex++;
  updateCaretPosition();

  if (state.mode === 'words' && state.currentIndex >= state.flatTargets.length) {
    endTest();
    return;
  }
  if (state.mode === 'time' && state.currentIndex >= state.flatTargets.length - 20) {
    extendTimeModeWords();
  }
}

function extendTimeModeWords() {
  const extra = buildTargetWords().slice(0, 60);
  const startWordIndex = state.words.length;
  extra.forEach((w) => state.words.push(w));
  const extraFlat = flattenWords(extra).map(entry => ({ char: entry.char, wordIndex: entry.wordIndex + startWordIndex }));
  state.flatTargets.push({ char: ' ', wordIndex: startWordIndex - 1 });
  state.flatTargets = state.flatTargets.concat(extraFlat);
  state.typedStates = state.typedStates.concat(new Array(extraFlat.length + 1).fill(undefined));
  renderTypeArea();
  updateCaretPosition();
}

function renderCharState(index) {
  const el = typeArea.querySelector('.char[data-index="' + index + '"]');
  if (!el) return;
  el.classList.remove('correct', 'incorrect');
  const s = state.typedStates[index];
  if (s === 'correct') el.classList.add('correct');
  else if (s === 'incorrect') el.classList.add('incorrect');
}

function playKeySound() {
  if (!currentProfile || !currentProfile.settings.sound) return;
  try {
    const ctx = playKeySound._ctx || (playKeySound._ctx = new (window.AudioContext || window.webkitAudioContext)());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 520;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) { /* audio not available, ignore */ }
}

/* ============================================================
   Timer / live stats (unchanged)
   ============================================================ */
function beginTest() {
  state.testActive = true;
  state.startTime = Date.now();
  statsLive.classList.add('show');
  if (currentProfile) applyBlindMode(currentProfile.settings.blindMode);
  state.timerHandle = setInterval(tick, 1000);
  tick();
}

function tick() {
  const elapsedSec = (Date.now() - state.startTime) / 1000;
  if (state.mode === 'time') {
    state.timeLeft = Math.max(0, Math.ceil(state.amount - elapsedSec));
    if (state.timeLeft <= 0) { endTest(); return; }
  }
  const liveWpm = computeLiveWpm(elapsedSec);
  liveWpmNum.textContent = liveWpm;
  state.liveWpmHistory.push({ t: Math.round(elapsedSec), wpm: liveWpm });
  updateLiveStatsDisplay();
}

function computeLiveWpm(elapsedSec) {
  const minutes = Math.max(elapsedSec / 60, 1 / 60);
  const correct = state.typedStates.filter(s => s === 'correct').length;
  return Math.round((correct / 5) / minutes);
}

function updateLiveStatsDisplay() {
  if (state.mode === 'time') {
    liveStatNum.textContent = state.testActive ? state.timeLeft : state.amount;
    liveStatLabel.textContent = 'seconds left';
  } else {
    const typed = state.typedStates.filter(s => s).length;
    liveStatNum.textContent = typed + ' / ' + state.flatTargets.length;
    liveStatLabel.textContent = 'characters';
  }
}

/* ============================================================
   Ending a test + results — now posts to the server
   ============================================================ */
async function endTest() {
  clearInterval(state.timerHandle);
  state.testActive = false;
  state.testEnded = true;

  const elapsedMs = state.startTime ? (Date.now() - state.startTime) : 0;
  const elapsedMinutes = state.mode === 'time'
    ? state.amount / 60
    : Math.max(elapsedMs / 60000, 1 / 600);

  const correct = state.typedStates.filter(s => s === 'correct').length;
  const incorrect = state.typedStates.filter(s => s === 'incorrect').length;
  const totalTyped = correct + incorrect;
  const wpm = Math.round((correct / 5) / elapsedMinutes) || 0;
  const rawWpm = Math.round((totalTyped / 5) / elapsedMinutes) || 0;
  const accuracy = totalTyped > 0 ? Math.round((correct / totalTyped) * 100) : 100;

  const result = { mode: state.mode, amount: state.amount, wpm, rawWpm, accuracy, correct, incorrect, totalTyped };

  showResults(result);

  if (state.isGuest) {
    // guest stats are session-only — track locally so the account box still
    // feels alive, but nothing is sent anywhere or saved after a reload
    currentProfile.stats.history.unshift(Object.assign({ ts: Date.now() }, result));
    currentProfile.stats.history = currentProfile.stats.history.slice(0, 100);
    if (wpm > currentProfile.stats.bestWpm) currentProfile.stats.bestWpm = wpm;
    refreshTopbar();
    if (drawer.classList.contains('show')) refreshAccountBox();
    return;
  }

  const { ok, data } = await api('/api/result', { method: 'POST', body: result });
  if (ok && currentProfile) {
    currentProfile.stats = data.stats;
    refreshTopbar();
    if (!drawer.classList.contains('show')) return;
    refreshAccountBox();
  }
}

function showResults(result) {
  testWrap.style.display = 'none';
  statsLive.classList.remove('show');
  resultsEl.classList.add('show');

  document.getElementById('resWpm').textContent = result.wpm;
  document.getElementById('resAccuracy').textContent = result.accuracy + '%';
  document.getElementById('resRaw').textContent = result.rawWpm;
  document.getElementById('resChars').textContent = result.correct + '/' + result.incorrect;
  document.getElementById('resTime').textContent = (result.mode === 'time' ? result.amount : Math.round(result.totalTyped)) + (result.mode === 'time' ? 's' : ' chars');

  renderGraph(state.liveWpmHistory);
}

function renderGraph(history) {
  const svg = document.getElementById('graphSvg');
  if (!history.length) { svg.innerHTML = ''; return; }
  const w = 600, h = 140, pad = 24;
  const maxWpm = Math.max(10, ...history.map(p => p.wpm));
  const maxT = Math.max(1, ...history.map(p => p.t));
  const points = history.map(p => {
    const x = pad + (p.t / maxT) * (w - pad * 2);
    const y = h - pad - (p.wpm / maxWpm) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.innerHTML =
    '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="var(--border)" stroke-width="1"/>' +
    '<polyline points="' + points + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
}

/* ============================================================
   Config bar
   ============================================================ */
configBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.config-btn');
  if (!btn) return;
  if (btn.dataset.mode) {
    state.mode = btn.dataset.mode;
    state.amount = state.mode === 'time' ? 30 : 25;
  } else if (btn.dataset.amount) {
    state.amount = Number(btn.dataset.amount);
  }
  syncConfigBarUI();
  startNewTest();
});

function syncConfigBarUI() {
  configBar.querySelectorAll('[data-group]').forEach(group => {
    const forThisMode = group.dataset.group === (state.mode === 'time' ? 'time-amount' : 'words-amount');
    group.style.display = forThisMode ? '' : 'none';
  });
  configBar.querySelectorAll('.config-btn').forEach(btn => {
    if (btn.dataset.mode) btn.classList.toggle('active', btn.dataset.mode === state.mode);
    if (btn.dataset.amount) btn.classList.toggle('active', Number(btn.dataset.amount) === state.amount);
  });
}

/* ============================================================
   Settings drawer
   ============================================================ */
function openDrawer() {
  drawer.classList.add('show');
  overlayScrim.classList.add('show');
  refreshDrawer();
}
function closeDrawer() {
  drawer.classList.remove('show');
  overlayScrim.classList.remove('show');
  adminPanel.classList.remove('show');
}
settingsBtn.addEventListener('click', openDrawer);
profileBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
overlayScrim.addEventListener('click', () => { closeDrawer(); closeLeaderboard(); });

function refreshDrawer() {
  if (!currentProfile) return;

  themeSwatches.innerHTML = '';
  THEMES.forEach(t => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'theme-swatch' + (currentProfile.settings.theme === t.id ? ' active' : '');
    el.innerHTML = '<div class="swatch-preview" data-preview="' + t.id + '"></div>' + t.label;
    el.addEventListener('click', () => {
      currentProfile.settings.theme = t.id;
      applyTheme(t.id);
      saveSettingsToServer();
      refreshDrawer();
    });
    themeSwatches.appendChild(el);
  });
  paintSwatchPreviews();

  setPillActive(fontPill, currentProfile.settings.font);
  setPillActive(caretPill, currentProfile.settings.caretStyle);
  setSwitch(smoothCaretSwitch, currentProfile.settings.smoothCaret);
  setSwitch(soundSwitch, currentProfile.settings.sound);
  setSwitch(blindModeSwitch, currentProfile.settings.blindMode);

  refreshAccountBox();
}

function paintSwatchPreviews() {
  const swatchColors = {
    analog: ['#14171A', '#F2A93B', '#1C2024'],
    terminal: ['#0A0F0A', '#4CFF4C', '#0F160F'],
    paper: ['#F3F1EA', '#C77B2E', '#FFFFFF'],
    sunset: ['#201626', '#FF9F5A', '#2A1B32'],
    ocean: ['#0D1B24', '#4FD1C5', '#12242F']
  };
  document.querySelectorAll('[data-preview]').forEach(el => {
    const colors = swatchColors[el.dataset.preview] || ['#333', '#666', '#999'];
    el.innerHTML = colors.map(c => '<span style="background:' + c + '"></span>').join('');
  });
}
function setPillActive(pillEl, value) { pillEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value)); }
function setSwitch(el, on) { el.classList.toggle('on', !!on); }

fontPill.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  currentProfile.settings.font = btn.dataset.value;
  applyFont(btn.dataset.value);
  saveSettingsToServer();
  refreshDrawer();
});
caretPill.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  currentProfile.settings.caretStyle = btn.dataset.value;
  applyCaretStyle(btn.dataset.value);
  saveSettingsToServer();
  refreshDrawer();
});
smoothCaretSwitch.addEventListener('click', () => toggleBoolSetting('smoothCaret', smoothCaretSwitch, applySmoothCaret));
soundSwitch.addEventListener('click', () => toggleBoolSetting('sound', soundSwitch));
blindModeSwitch.addEventListener('click', () => toggleBoolSetting('blindMode', blindModeSwitch, applyBlindMode));

function toggleBoolSetting(key, switchEl, applyFn) {
  const next = !currentProfile.settings[key];
  currentProfile.settings[key] = next;
  setSwitch(switchEl, next);
  if (applyFn) applyFn(next);
  saveSettingsToServer();
}

let settingsSaveTimer = null;
function saveSettingsToServer() {
  if (state.isGuest) return; // nothing to sync — guest settings just live in memory for this session
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    api('/api/settings', { method: 'POST', body: currentProfile.settings });
  }, 250);
}

/* ---------------- applying settings to the DOM ---------------- */
function applyTheme(themeId) { document.documentElement.setAttribute('data-theme', themeId); }
function applyFont(fontId) {
  const fonts = { jetbrains: "'JetBrains Mono', monospace", consolas: "Consolas, monospace", courier: "'Courier New', monospace" };
  typeArea.style.fontFamily = fonts[fontId] || fonts.jetbrains;
}
function applyCaretStyle(style) {
  typeArea.classList.remove('caret-block', 'caret-underline');
  if (style === 'block') typeArea.classList.add('caret-block');
  if (style === 'underline') typeArea.classList.add('caret-underline');
}
function applySmoothCaret(on) { typeArea.classList.toggle('smooth-caret', on); }
function applyBlindMode(on) { typeArea.classList.toggle('blurred', on && state.testActive); }

function applyAllSettings() {
  if (!currentProfile) return;
  applyTheme(currentProfile.settings.theme);
  applyFont(currentProfile.settings.font);
  applyCaretStyle(currentProfile.settings.caretStyle);
  applySmoothCaret(currentProfile.settings.smoothCaret);
}

/* ============================================================
   Account section + topbar
   ============================================================ */
function refreshTopbar() {
  if (!currentProfile) return;
  profileBtn.innerHTML = (currentProfile.isAdmin ? '<span class="admin-dot"></span>' : '') + escapeHtml(currentProfile.username);
}

function refreshAccountBox() {
  if (!currentProfile) return;
  if (state.isGuest) {
    accountBox.innerHTML = `
      <div class="account-box">
        <div class="account-name">Guest</div>
        <div class="account-meta">This session only: ${currentProfile.stats.bestWpm} wpm best &middot; ${currentProfile.stats.history.length} tests. Nothing is saved.</div>
      </div>
      <button class="btn-block primary" id="guestSignupBtn" type="button" style="margin-top:14px;">Sign up to save your stats</button>
      <button class="btn-block ghost" id="logoutBtn2" type="button" style="margin-top:8px;">Back to login</button>
    `;
    document.getElementById('guestSignupBtn').addEventListener('click', () => { closeDrawer(); doLogout(); });
    document.getElementById('logoutBtn2').addEventListener('click', doLogout);
    return;
  }
  accountBox.innerHTML = `
    <div class="account-box">
      <div class="account-name">${escapeHtml(currentProfile.username)}${currentProfile.isAdmin ? ' \uD83D\uDC51' : ''}</div>
      <div class="account-meta">Best: ${currentProfile.stats.bestWpm} wpm &middot; ${currentProfile.stats.history.length} tests logged</div>
    </div>
    <button class="btn-block ghost" id="logoutBtn2" type="button" style="margin-top:14px;">Log out</button>
  `;
  document.getElementById('logoutBtn2').addEventListener('click', doLogout);
  refreshAdminSection();
}

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

/* ============================================================
   Leaderboard (new — only possible with a real server)
   ============================================================ */
leaderboardBtn.addEventListener('click', openLeaderboard);
leaderboardClose.addEventListener('click', closeLeaderboard);
async function openLeaderboard() {
  leaderboardModal.classList.add('show');
  leaderboardList.innerHTML = '<div class="lb-empty">Loading...</div>';
  const { ok, data } = await api('/api/leaderboard');
  if (!ok) { leaderboardList.innerHTML = '<div class="lb-empty">Could not load the leaderboard.</div>'; return; }
  if (!data.leaderboard.length) { leaderboardList.innerHTML = '<div class="lb-empty">No completed tests yet — be the first!</div>'; return; }
  leaderboardList.innerHTML = data.leaderboard.map((row, i) => `
    <div class="lb-row">
      <span class="lb-rank">#${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.username)}${row.isAdmin ? ' \uD83D\uDC51' : ''}</span>
      <span class="lb-wpm">${row.bestWpm} wpm</span>
    </div>
  `).join('');
}
function closeLeaderboard() { leaderboardModal.classList.remove('show'); }

/* ============================================================
   Announcement banner (polled — this app has no live connection)
   ============================================================ */
let announcePollHandle = null;
function startAnnouncementPolling() {
  checkAnnouncement();
  clearInterval(announcePollHandle);
  announcePollHandle = setInterval(checkAnnouncement, 45000);
}
function stopAnnouncementPolling() { clearInterval(announcePollHandle); announcePollHandle = null; }

async function checkAnnouncement() {
  const { ok, data } = await api('/api/announcement');
  if (!ok) return;
  const dismissedId = localStorage.getItem('speedtype_dismissed_announcement');
  if (data.announcement && data.announcement.id !== dismissedId) {
    announceText.textContent = data.announcement.text;
    announceBanner.dataset.id = data.announcement.id;
    announceBanner.classList.remove('hidden');
  } else if (!data.announcement) {
    announceBanner.classList.add('hidden');
  }
}
announceDismiss.addEventListener('click', () => {
  localStorage.setItem('speedtype_dismissed_announcement', announceBanner.dataset.id || '');
  announceBanner.classList.add('hidden');
});

sendAnnounceBtn.addEventListener('click', async () => {
  const text = announceInput.value.trim();
  if (!text) { announceMsg.textContent = 'Enter a message first.'; announceMsg.className = 'form-msg error'; return; }
  const { ok, data } = await api('/api/admin/announcement', { method: 'POST', headers: { 'X-Admin-Token': adminToken || '' }, body: { text } });
  if (!ok) { announceMsg.textContent = data.error || 'Could not post it.'; announceMsg.className = 'form-msg error'; return; }
  announceMsg.textContent = 'Posted — live for everyone now.'; announceMsg.className = 'form-msg ok';
  announceInput.value = '';
  checkAnnouncement();
});
clearAnnounceBtn.addEventListener('click', async () => {
  const { ok, data } = await api('/api/admin/announcement', { method: 'POST', headers: { 'X-Admin-Token': adminToken || '' }, body: { text: '' } });
  if (!ok) { announceMsg.textContent = data.error || 'Could not clear it.'; announceMsg.className = 'form-msg error'; return; }
  announceMsg.textContent = 'Cleared.'; announceMsg.className = 'form-msg ok';
  announceBanner.classList.add('hidden');
});

/* ============================================================
   Admin: PIN setup + admin panel
   ============================================================ */
function refreshAdminSection() {
  if (!currentProfile.isAdmin) { adminSection.style.display = 'none'; return; }
  adminSection.style.display = '';
  adminSectionInner.innerHTML = currentProfile.hasPin ? `
    <div class="account-meta" style="margin-bottom:10px;">Admin PIN is set on your account.</div>
    <button class="btn-block ghost" id="changePinBtn" type="button">Change PIN</button>
    <button class="btn-block primary" id="openAdminBtn" type="button" style="margin-top:8px;">Open admin panel</button>
  ` : `
    <div class="account-meta" style="margin-bottom:10px;">Set a PIN to lock the admin panel behind more than just your username.</div>
    <button class="btn-block primary" id="setPinBtn" type="button">Create admin PIN</button>
  `;
  const setPinBtn = document.getElementById('setPinBtn');
  if (setPinBtn) setPinBtn.addEventListener('click', () => openPinModal('create'));
  const changePinBtn = document.getElementById('changePinBtn');
  if (changePinBtn) changePinBtn.addEventListener('click', () => openPinModal('verify-then-create'));
  const openAdminBtn = document.getElementById('openAdminBtn');
  if (openAdminBtn) openAdminBtn.addEventListener('click', () => openPinModal('verify'));
}

let pinFlow = null;
let pendingCurrentPin = null;
function openPinModal(flow) {
  pinFlow = flow;
  pendingCurrentPin = null;
  pinInput.value = '';
  pinError.textContent = '';
  if (flow === 'create') {
    pinModalTitle.textContent = 'Create your admin PIN';
    pinModalSub.textContent = '4-6 digits. Stored securely on the server, tied to your account.';
  } else if (flow === 'verify-then-create') {
    pinModalTitle.textContent = 'Enter your current PIN';
    pinModalSub.textContent = 'Verify your current PIN before setting a new one.';
  } else {
    pinModalTitle.textContent = 'Enter admin PIN';
    pinModalSub.textContent = 'Unlock the admin panel for this session.';
  }
  pinModal.classList.add('show');
  pinInput.focus();
}
function closePinModal() { pinModal.classList.remove('show'); pinFlow = null; }
pinCancel.addEventListener('click', closePinModal);
pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') pinSubmit.click(); });

pinSubmit.addEventListener('click', async () => {
  const val = pinInput.value.trim();
  if (!/^\d{4,6}$/.test(val)) { pinError.textContent = 'PIN must be 4-6 digits.'; return; }
  pinSubmit.disabled = true;

  if (pinFlow === 'create') {
    const { ok, data } = await api('/api/admin/set-pin', { method: 'POST', body: { newPin: val, currentPin: pendingCurrentPin } });
    pinSubmit.disabled = false;
    if (!ok) { pinError.textContent = data.error || 'Could not set PIN.'; return; }
    currentProfile.hasPin = true;
    closePinModal();
    refreshDrawer();
  } else if (pinFlow === 'verify-then-create') {
    pendingCurrentPin = val;
    pinSubmit.disabled = false;
    openPinModal('create');
    pendingCurrentPin = val; // openPinModal resets it, restore after
  } else if (pinFlow === 'verify') {
    const { ok, data } = await api('/api/admin/unlock', { method: 'POST', body: { pin: val } });
    pinSubmit.disabled = false;
    if (!ok) { pinError.textContent = data.error || 'Incorrect PIN.'; return; }
    adminToken = data.adminToken;
    closePinModal();
    openAdminPanel();
  }
});

async function openAdminPanel() {
  adminPanel.classList.add('show');
  adminTableBody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  const { ok, data } = await api('/api/admin/users', { headers: { 'X-Admin-Token': adminToken || '' } });
  if (!ok) {
    adminTableBody.innerHTML = '<tr><td colspan="4">' + escapeHtml(data.error || 'Could not load users.') + '</td></tr>';
    return;
  }
  adminTableBody.innerHTML = data.users.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}${u.isAdmin ? ' \uD83D\uDC51' : ''}</td>
      <td class="num">${u.bestWpm}</td>
      <td class="num">${u.testsLogged}</td>
      <td>
        ${u.isAdmin ? '' : `<button data-reset="${u.username.toLowerCase()}">Reset</button> <button data-delete="${u.username.toLowerCase()}">Delete</button>`}
      </td>
    </tr>
  `).join('');

  adminTableBody.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { ok } = await api('/api/admin/reset-stats', { method: 'POST', headers: { 'X-Admin-Token': adminToken || '' }, body: { username: btn.dataset.reset } });
      if (ok) openAdminPanel();
    });
  });
  adminTableBody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Permanently delete the account "' + btn.dataset.delete + '"?')) return;
      const { ok } = await api('/api/admin/delete-user', { method: 'POST', headers: { 'X-Admin-Token': adminToken || '' }, body: { username: btn.dataset.delete } });
      if (ok) openAdminPanel();
    });
  });
}

/* ============================================================
   Boot
   ============================================================ */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
setAuthMode('login');
(async function boot() {
  const token = getToken();
  if (!token) { showAuthScreen(); return; }
  const { ok, data } = await api('/api/me');
  if (!ok) { showAuthScreen(); return; }
  currentProfile = data.profile;
  enterApp();
})();

document.getElementById('redoBtn') && document.getElementById('redoBtn').addEventListener('click', startNewTest);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDrawer(); closePinModal(); closeLeaderboard(); }
});
