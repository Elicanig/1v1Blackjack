import { formatHandTotalLine } from './match-view-model.js';
const app = document.getElementById('app');
let spotlightInitialized = false;
let hoverGlowInitialized = false;
let inviteCountdownTicker = null;
const PERMISSION_ERROR_PATTERNS = [
  /not allowed by the user agent/i,
  /not allowed by the platform/i,
  /permission denied/i,
  /the request is not allowed/i
];

function initialViewFromPath() {
  const pathname = window.location.pathname.toLowerCase();
  if (pathname === '/profile') return 'profile';
  if (pathname === '/friends') return 'friends';
  if (pathname === '/lobbies' || pathname === '/lobby') return 'lobbies';
  if (pathname === '/challenges') return 'challenges';
  if (pathname === '/notifications') return 'notifications';
  if (pathname === '/rules') return 'rules';
  if (pathname === '/match') return 'match';
  return 'home';
}

function joinCodeFromLocation() {
  const fromQuery = new URLSearchParams(window.location.search).get('code') || new URLSearchParams(window.location.search).get('joinLobby');
  if (fromQuery) return fromQuery;
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return '';
  const query = hash.slice(qIdx + 1);
  return new URLSearchParams(query).get('code') || '';
}

function initCursorSpotlight() {
  if (spotlightInitialized) return;
  spotlightInitialized = true;
}

function useHoverGlow() {
  if (hoverGlowInitialized) return;
  hoverGlowInitialized = true;

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = media.matches;
  let raf = null;
  let targetEl = null;
  let lx = 0;
  let ly = 0;

  const flush = () => {
    raf = null;
    if (!targetEl || reduced) return;
    targetEl.style.setProperty('--hx', `${lx}px`);
    targetEl.style.setProperty('--hy', `${ly}px`);
  };

  const smoothstep = (t) => t * t * (3 - 2 * t);

  const queue = (el, x, y, w, h) => {
    if (reduced) return;
    targetEl = el;
    lx = x;
    ly = y;
    const nx = w > 0 ? x / w : 0.5;
    const ny = h > 0 ? y / h : 0.5;
    const edgeX = Math.min(nx, 1 - nx);
    const edgeY = Math.min(ny, 1 - ny);
    const edge = Math.min(edgeX, edgeY);
    const edgeLinear = Math.max(0, Math.min(1, edge * 2));
    const edgeFactor = smoothstep(edgeLinear);
    el.style.setProperty('--nx', String(nx));
    el.style.setProperty('--ny', String(ny));
    el.style.setProperty('--edge', String(edgeFactor));
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const onMove = (e) => {
    if (reduced) return;
    const el = e.target.closest?.('.glow-follow');
    if (!el) return;
    const r = el.getBoundingClientRect();
    queue(el, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };

  const onOver = (e) => {
    const el = e.target.closest?.('.glow-follow');
    if (el) {
      if (el.classList.contains('is-hovering')) return;
      el.classList.add('is-hovering');
      const r = el.getBoundingClientRect();
      queue(el, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    }
  };

  const onOut = (e) => {
    const el = e.target.closest?.('.glow-follow');
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    el.classList.remove('is-hovering');
  };

  const onWindowLeave = () => {
    document.querySelectorAll('.glow-follow.is-hovering').forEach((el) => el.classList.remove('is-hovering'));
  };

  const onPrefChange = () => {
    reduced = media.matches;
    if (reduced) onWindowLeave();
  };

  app.addEventListener('pointermove', onMove, { passive: true });
  app.addEventListener('pointerover', onOver, { passive: true });
  app.addEventListener('pointerout', onOut, { passive: true });
  app.addEventListener('pointerleave', onWindowLeave, { passive: true });
  media.addEventListener('change', onPrefChange);
}

function applyGlowFollowClasses() {
  app
    .querySelectorAll('button.primary, button.gold, button.ghost, .bot-segmented button, .tabs .nav-pill, .nav button:not(.warn), .card.section')
    .forEach((el) => el.classList.add('glow-follow'));
}

const state = {
  token: localStorage.getItem('bb_auth_token') || localStorage.getItem('bb_token') || null,
  authUsername: localStorage.getItem('bb_auth_username') || '',
  authNotice: '',
  revealPin: false,
  newPin: '',
  me: null,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  incomingFriendChallenges: [],
  outgoingFriendChallenges: [],
  notifications: [],
  notificationsOpen: false,
  toasts: [],
  challenges: [],
  view: initialViewFromPath(),
  socket: null,
  status: '',
  error: '',
  patchNotes: [],
  patchNotesDeploy: null,
  appVersion: 'dev',
  currentLobby: null,
  currentMatch: null,
  pendingFriendInviteCode: new URLSearchParams(window.location.search).get('friendInvite'),
  pendingLobbyCode: joinCodeFromLocation(),
  lobbyJoinInput: '',
  lastRenderedView: '',
  freeClaimed: false,
  freeClaimedAt: null,
  freeClaimNextAt: null,
  freeClaimRemainingMs: 0,
  showMorePatchNotes: false,
  friendInvite: null,
  friendInviteRemainingMs: 0,
  lastRoundResultKey: '',
  roundResultModal: null,
  currentBet: 5,
  selectedBotDifficulty: 'normal',
  botStakeType: 'FAKE',
  emotePickerOpen: false,
  floatingEmote: null,
  challengeModalFriend: null,
  challengeBet: 25,
  challengeMessage: '',
  showMatchDetails: false,
  leaveMatchModal: false
};

let freeClaimTicker = null;

function updateFreeClaimCountdown() {
  const next = state.freeClaimNextAt ? new Date(state.freeClaimNextAt).getTime() : 0;
  state.freeClaimRemainingMs = next ? Math.max(0, next - Date.now()) : 0;
  if (state.freeClaimRemainingMs <= 0) {
    state.freeClaimed = false;
  }
}

function formatCooldown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const FALLBACK_PATCH_NOTES = [
  { date: '2026-02-15', title: 'Account persistence hardening', bullets: ['Fix: accounts now persist across deployments and patches (no forced re-registration).', 'Storage boot now loads existing persistent data without reseeding users.'] },
  { date: '2026-02-14', title: 'Match UI fit and polish pass', bullets: ['Match layout cleaned up for no-overlap/no-scroll card-first flow.', 'Logo shine slowed down and stats/rules strip refinements applied.'] },
  { date: '2026-02-13', title: 'Gameplay and polish updates', bullets: ['Instant round-end handling for bust and naturals.', 'Improved notifications overlay and profile PIN controls.'] },
  { date: '2026-02-12', title: 'Practice and split flow updates', bullets: ['Practice bot mode no longer affects real chips/stats.', 'Split flow now stays on the same player until all split hands are completed.'] },
  { date: '2026-02-11', title: 'Security and progression improvements', bullets: ['Per-view hand sanitization prevents hidden-card leakage.', 'Challenge tiers and rewards are persisted server-side.'] }
];

function setStatus(message = '') {
  if (message) pushToast(message);
}

function pushToast(message, type = 'info') {
  const toast = { id: Math.random().toString(36).slice(2), message, type };
  state.toasts = [...state.toasts, toast].slice(-3);
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== toast.id);
    render();
  }, 2500);
}

function inviteRemainingMs() {
  if (!state.friendInvite?.expiresAt) return 0;
  const expiresAt = new Date(state.friendInvite.expiresAt).getTime();
  return Math.max(0, expiresAt - Date.now());
}

function formatInviteCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function syncInviteCountdownUI() {
  const label = document.getElementById('inviteCountdown');
  const copyBtn = document.getElementById('copyInviteLinkBtn');
  if (!label) return;
  state.friendInviteRemainingMs = inviteRemainingMs();
  const expired = state.friendInviteRemainingMs <= 0;
  label.textContent = expired ? 'Expired' : `Expires in ${formatInviteCountdown(state.friendInviteRemainingMs)}`;
  if (copyBtn) copyBtn.disabled = expired;
}

function syncFreeClaimUI() {
  const label = document.getElementById('freeClaimCountdown');
  const btn = document.getElementById('claimFreeBtn');
  if (!label || !btn) return;
  const onCooldown = state.freeClaimRemainingMs > 0;
  label.textContent = onCooldown ? `Next claim in ${formatCooldown(state.freeClaimRemainingMs)}` : 'Available now';
  btn.disabled = onCooldown;
  btn.textContent = onCooldown ? 'On cooldown' : `Claim +${state.me?.nextStreakReward || 50}`;
}

async function loadPatchNotes() {
  try {
    const data = await api('/api/patch-notes', { method: 'GET' });
    state.patchNotes = data?.notes || FALLBACK_PATCH_NOTES;
    state.patchNotesDeploy = data?.currentDeploy || null;
  } catch {
    state.patchNotes = FALLBACK_PATCH_NOTES;
    state.patchNotesDeploy = null;
  }
}

async function loadVersion() {
  try {
    const data = await api('/api/version', { method: 'GET' });
    state.appVersion = data?.version || 'dev';
  } catch {
    state.appVersion = 'dev';
  }
}

function normalizeAppError(message) {
  const text = String(message || '').trim();
  if (!text) return '';
  if (PERMISSION_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return '';
  return text;
}

function setError(message = '') {
  const safeMessage = normalizeAppError(message);
  if (!safeMessage) {
    if (message) console.warn('Suppressed browser/platform exception:', message);
    return;
  }
  if (/invalid user|invalid token|invalid auth/i.test(safeMessage)) {
    state.authNotice = 'Session expired, please login.';
    state.error = '';
    state.me = null;
    return render();
  }
  state.error = safeMessage;
  state.status = '';
  render();
}

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...options, headers }).then(async (r) => {
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const fallback = `Request failed (${r.status})`;
      throw new Error((body && body.error) || fallback);
    }
    return body;
  });
}

async function safeCopy(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function connectSocket() {
  if (!state.token) return;
  if (state.socket) state.socket.disconnect();

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect_error', (e) => setError(e?.message || 'Connection error'));
  state.socket.on('notify:list', ({ notifications }) => {
    state.notifications = notifications || [];
    render();
  });
  state.socket.on('notify:new', (notification) => {
    state.notifications = [notification, ...state.notifications].slice(0, 60);
    pushToast(notification.message, notification.type);
  });
  state.socket.on('friend:challengeStarted', ({ matchId }) => {
    if (matchId) {
      goToView('match');
      pushToast('Friend challenge match started.');
      render();
    }
  });
  state.socket.on('game:emote', (event) => {
    if (!event) return;
    state.floatingEmote = event;
    render();
    setTimeout(() => {
      if (state.floatingEmote?.ts === event.ts) {
        state.floatingEmote = null;
        render();
      }
    }, 2000);
  });
  state.socket.on('lobby:update', (lobby) => {
    state.currentLobby = lobby;
    render();
  });
  state.socket.on('match:state', (match) => {
    state.currentMatch = match;
    state.leaveMatchModal = false;
    const myBankroll = match.players?.[state.me?.id]?.bankroll;
    if (state.me && Number.isFinite(myBankroll)) {
      state.me.chips = myBankroll;
    }
    if (typeof match.selectedBet === 'number') {
      const preferred = state.currentBet;
      state.currentBet = match.selectedBet;
      if (state.me?.id) localStorage.setItem(`bb_last_bet_${state.me.id}`, String(match.selectedBet));
      if (match.canEditBet && Number.isFinite(preferred) && preferred !== match.selectedBet) {
        emitSetBaseBet(preferred);
      }
    }
    goToView('match');
    state.emotePickerOpen = false;
    render();
  });
  state.socket.on('match:error', ({ error }) => setError(error));
  state.socket.on('round:result', ({ matchId, roundNumber, outcome, deltaChips }) => {
    // One-shot modal trigger keyed by match+round to prevent duplicate firing.
    const key = `${matchId}:${roundNumber}`;
    if (state.lastRoundResultKey === key) return;
    state.lastRoundResultKey = key;
    state.roundResultModal = {
      title: outcome === 'win' ? 'You Win' : outcome === 'lose' ? 'You Lose' : 'Push',
      delta: deltaChips || 0,
      detail: `Round ${roundNumber}`
    };
    render();
  });
  state.socket.on('user:update', ({ user }) => {
    if (!user || !state.me || user.id !== state.me.id) return;
    state.me = { ...state.me, ...user };
    render();
  });
  state.socket.on('match:ended', ({ reason }) => {
    setStatus(reason);
    state.currentMatch = null;
    state.currentLobby = null;
    state.leaveMatchModal = false;
    goToView('home');
    loadMe();
  });
}

async function loadMe() {
  if (!state.token) return;
  try {
    const auth = await api('/api/auth/me', { method: 'POST', body: JSON.stringify({ authToken: state.token }) });
    if (!auth?.ok) throw new Error('Invalid auth');
    const data = await api('/api/me');
    state.me = data.user;
    state.authUsername = data.user.username;
    localStorage.setItem('bb_auth_token', state.token);
    localStorage.setItem('bb_auth_username', state.authUsername);
    localStorage.setItem('bb_token', state.token);
    state.friends = data.friends || [];
    state.incomingRequests = data.friendRequests?.incoming || [];
    state.outgoingRequests = data.friendRequests?.outgoing || [];
    state.incomingFriendChallenges = data.friendChallenges?.incoming || [];
    state.outgoingFriendChallenges = data.friendChallenges?.outgoing || [];
    state.notifications = data.notifications || [];
    state.challenges = data.challenges || [];
    state.freeClaimed = !Boolean(data.freeClaimAvailable);
    state.freeClaimedAt = null;
    state.freeClaimNextAt = data.freeClaimNextAt || null;
    if (state.me) {
      state.me.streakCount = data.streakCount ?? state.me.streakCount ?? 0;
      state.me.nextStreakReward = data.nextStreakReward ?? state.me.nextStreakReward ?? 50;
    }
    updateFreeClaimCountdown();
    if (typeof data.user?.selectedBet === 'number') {
      const local = Number(localStorage.getItem(`bb_last_bet_${data.user.id}`));
      state.currentBet = Number.isFinite(local) && local > 0 ? local : data.user.selectedBet;
      localStorage.setItem(`bb_last_bet_${data.user.id}`, String(state.currentBet));
    }

    if (state.pendingFriendInviteCode) {
      await acceptFriendInvite(state.pendingFriendInviteCode);
      state.pendingFriendInviteCode = null;
      clearQuery();
    }

    if (state.pendingLobbyCode) {
      state.lobbyJoinInput = String(state.pendingLobbyCode).trim();
      goToView('lobbies');
      clearQuery();
      state.pendingLobbyCode = null;
    }

    await loadPatchNotes();
    await loadVersion();
    render();
  } catch (e) {
    localStorage.removeItem('bb_auth_token');
    localStorage.removeItem('bb_auth_username');
    localStorage.removeItem('bb_token');
    state.token = null;
    state.authUsername = '';
    state.authNotice = 'Session expired, please login.';
    state.me = null;
    state.friends = [];
    state.incomingRequests = [];
    state.outgoingRequests = [];
    state.notifications = [];
    state.incomingFriendChallenges = [];
    state.outgoingFriendChallenges = [];
    state.challenges = [];
    state.freeClaimed = false;
    state.freeClaimedAt = null;
    state.freeClaimNextAt = null;
    state.freeClaimRemainingMs = 0;
    state.patchNotes = FALLBACK_PATCH_NOTES;
    state.patchNotesDeploy = null;
    state.appVersion = 'dev';
    render();
  }
}

function clearQuery() {
  history.replaceState({}, '', window.location.pathname);
}

function goToView(view) {
  state.view = view;
  state.error = '';
  const routes = {
    home: '/',
    profile: '/profile',
    friends: '/friends',
    lobbies: '/lobbies',
    challenges: '/challenges',
    notifications: '/notifications',
    rules: '/rules',
    match: '/match'
  };
  const next = routes[view] || '/';
  if (window.location.pathname !== next) {
    history.replaceState({}, '', next);
  }
}

function handCanSplit(hand) {
  if (!hand) return false;
  if (hand.cards.length !== 2) return false;
  if ((hand.splitDepth || 0) >= 3) return false;
  return hand.cards[0].rank && hand.cards[1].rank && hand.cards[0].rank === hand.cards[1].rank;
}

function isMyTurn() {
  if (!state.currentMatch || !state.me) return false;
  return state.currentMatch.phase === 'ACTION_TURN' && state.currentMatch.currentTurn === state.me.id;
}

function getMyPlayerState() {
  return state.currentMatch?.players?.[state.me.id] || null;
}

function getOpponentId() {
  return state.currentMatch?.playerIds?.find((id) => id !== state.me.id);
}

function playerName(id) {
  if (!id) return 'Unknown';
  const participantName = state.currentMatch?.participants?.[id]?.username;
  if (participantName) return participantName;
  if (state.me?.id === id) return state.me.username;
  const friend = state.friends.find((f) => f.id === id);
  if (friend) return friend.username;
  return id.slice(0, 6);
}

function emitAction(action) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:action', { matchId: state.currentMatch.id, action });
}

function emitPressureDecision(decision) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:pressureDecision', { matchId: state.currentMatch.id, decision });
}

function emitSetBaseBet(amount) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:setBaseBet', { matchId: state.currentMatch.id, amount });
}

function emitConfirmBet() {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:confirmBet', { matchId: state.currentMatch.id });
}

function emitLeaveMatch() {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:leave', { matchId: state.currentMatch.id });
}

function emitEmote(type, value) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('game:emote', { matchId: state.currentMatch.id, type, value });
}

function adjustBet(delta) {
  if (!state.currentMatch) return;
  if (!state.currentMatch.canEditBet) return;
  const min = state.currentMatch.minBet || 5;
  const max = Math.min(state.currentMatch.maxBetCap || 500, state.me?.chips || 0);
  const next = Math.max(min, Math.min(max, state.currentBet + delta));
  state.currentBet = next;
  if (state.me?.id) localStorage.setItem(`bb_last_bet_${state.me.id}`, String(next));
  emitSetBaseBet(next);
  render();
}

async function handleAuth(mode, form) {
  const username = form.querySelector('[name="username"]').value.trim();
  const pin = form.querySelector('[name="pin"]')?.value.trim();
  if (!username) return setError('Username required');
  if (mode === 'login' && !/^\d{4}$/.test(pin || '')) return setError('Enter a valid 4-digit PIN.');
  try {
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register' ? { username } : { username, pin };
    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.token = data.authToken;
    state.authUsername = username;
    state.authNotice = '';
    localStorage.setItem('bb_auth_token', data.authToken);
    localStorage.setItem('bb_auth_username', username);
    localStorage.setItem('bb_token', data.authToken);
    if (mode === 'register') {
      state.newPin = String(data.pin || '');
      const copied = await safeCopy(state.newPin);
      setStatus(copied ? 'Account created. PIN copied.' : 'Account created. Save your PIN.');
    } else {
      state.newPin = '';
      setStatus('Logged in.');
    }
    connectSocket();
    await loadMe();
  } catch (e) {
    if (mode === 'login') {
      state.authNotice = 'Incorrect username or PIN.';
      render();
    } else {
      setError(e.message);
    }
  }
}

async function saveProfile(form) {
  const avatarStyle = form.querySelector('[name="avatar_style"]').value.trim();
  const avatarSeed = form.querySelector('[name="avatar_seed"]').value.trim();
  const bio = form.querySelector('[name="bio"]').value.trim();
  try {
    const data = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ avatarStyle, avatarSeed, bio })
    });
    state.me = data.user;
    setStatus('Profile saved.');
  } catch (e) {
    setError(e.message);
  }
}

async function addFriend(form) {
  const username = form.querySelector('[name="friend_username"]').value.trim();
  try {
    const data = await api('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    state.friends = data.friends;
    state.incomingRequests = data.incoming || [];
    state.outgoingRequests = data.outgoing || [];
    pushToast('Friend request sent.');
  } catch (e) {
    setError(e.message);
  }
}

async function createFriendInvite(regenerate = false) {
  try {
    const data = await api('/api/friends/invite-link', {
      method: 'POST',
      body: JSON.stringify({ regenerate })
    });
    state.friendInvite = {
      url: data.inviteUrl,
      token: data.token,
      expiresAt: data.expiresAt
    };
    state.friendInviteRemainingMs = inviteRemainingMs();
    const ok = await safeCopy(data.inviteUrl);
    if (ok) pushToast(regenerate ? 'Invite link regenerated and copied.' : 'Friend invite link copied.');
    else pushToast("Couldn't copy — select and copy manually.");
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function acceptFriendInvite(code) {
  try {
    const data = await api('/api/friends/invite-link/accept', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    state.friends = data.friends;
    pushToast(`Added ${data.inviter.username} as a friend.`);
  } catch (e) {
    setError(e.message);
  }
}

async function createLobby() {
  try {
    const data = await api('/api/lobbies/create', { method: 'POST' });
    state.currentLobby = data.lobby;
    goToView('lobbies');
    setStatus(`Lobby ready: ${data.lobby.id}`);
    state.socket?.emit('lobby:watch', data.lobby.id);
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function joinLobby(lobbyIdInput) {
  try {
    const code = String(lobbyIdInput || '').trim().toUpperCase();
    if (!code) return setError('Enter a lobby code.');
    const data = await api('/api/lobbies/join', {
      method: 'POST',
      body: JSON.stringify({ lobbyId: code })
    });
    state.currentLobby = data.lobby;
    goToView(data.matchId ? 'match' : 'lobbies');
    state.lobbyJoinInput = code;
    state.socket?.emit('lobby:watch', data.lobby.id);
    if (!data.matchId) setStatus('Joined lobby. Waiting for match...');
  } catch (e) {
    setError(e.message);
  }
}

async function loadFriendsData() {
  try {
    const data = await api('/api/friends/list');
    state.friends = data.friends || [];
    state.incomingRequests = data.incoming || [];
    state.outgoingRequests = data.outgoing || [];
    state.incomingFriendChallenges = data.incomingChallenges || [];
    state.outgoingFriendChallenges = data.outgoingChallenges || [];
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function sendFriendChallenge(toUsername, bet, message) {
  try {
    await api('/api/friends/challenge', {
      method: 'POST',
      body: JSON.stringify({ toUsername, bet, message })
    });
    state.challengeModalFriend = null;
    pushToast(`Challenge sent to ${toUsername}.`);
    await loadFriendsData();
  } catch (e) {
    setError(e.message);
  }
}

async function respondFriendChallenge(challengeId, decision) {
  try {
    const data = await api('/api/friends/challenge/respond', {
      method: 'POST',
      body: JSON.stringify({ challengeId, decision })
    });
    if (data.matchId) {
      pushToast('Challenge accepted. Match starting.');
      goToView('match');
    } else {
      pushToast('Challenge declined.');
    }
    await loadFriendsData();
  } catch (e) {
    setError(e.message);
  }
}

async function acceptRequest(requestId) {
  try {
    const data = await api('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ requestId })
    });
    state.friends = data.friends || [];
    state.incomingRequests = data.incoming || [];
    state.outgoingRequests = data.outgoing || [];
    pushToast('Friend request accepted.');
  } catch (e) {
    setError(e.message);
  }
}

async function declineRequest(requestId) {
  try {
    const data = await api('/api/friends/decline', {
      method: 'POST',
      body: JSON.stringify({ requestId })
    });
    state.friends = data.friends || [];
    state.incomingRequests = data.incoming || [];
    state.outgoingRequests = data.outgoing || [];
    pushToast('Friend request declined.');
  } catch (e) {
    setError(e.message);
  }
}

async function inviteFriendToLobby(username) {
  try {
    const data = await api('/api/lobbies/invite', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    state.currentLobby = data.lobby;
    goToView('lobbies');
    state.socket?.emit('lobby:watch', data.lobby.id);
    pushToast(`Invite sent to ${username}.`);
    render();
  } catch (e) {
    setError(e.message);
  }
}

function unreadCount() {
  return (state.notifications || []).filter((n) => !n.read).length;
}

async function clearNotifications() {
  try {
    const data = await api('/api/notifications/clear', { method: 'POST' });
    state.notifications = data.notifications || [];
    render();
  } catch (e) {
    setError(e.message);
  }
}

function runNotificationAction(notification) {
  const action = notification?.action;
  if (!action) return;
  if (action.kind === 'join_lobby') {
    const code = action.data?.lobbyCode;
    if (code) joinLobby(code);
  } else if (action.kind === 'friend_challenge') {
    goToView('friends');
    loadFriendsData();
  } else if (action.kind === 'open_match') {
    goToView('match');
    render();
  }
}

async function startBotMatch() {
  try {
    const data = await api('/api/lobbies/bot', {
      method: 'POST',
      body: JSON.stringify({ difficulty: state.selectedBotDifficulty, stakeType: state.botStakeType })
    });
    state.currentLobby = null;
    state.currentMatch = data.match;
    goToView('match');
    setStatus(`${state.botStakeType === 'REAL' ? 'Real-chip' : 'Practice'} bot match started (${state.selectedBotDifficulty}).`);
  } catch (e) {
    setError(e.message);
  }
}

async function claimFree100() {
  try {
    const data = await api('/api/free-claim', { method: 'POST' });
    state.me.chips = data.chips;
    state.me.streakCount = data.streakCount ?? state.me.streakCount;
    state.me.nextStreakReward = data.nextReward ?? state.me.nextStreakReward;
    state.freeClaimed = !data.reward;
    state.freeClaimedAt = data.claimedAt || null;
    state.freeClaimNextAt = data.nextAt || null;
    updateFreeClaimCountdown();
    setStatus(data.reward > 0 ? `Daily streak claim: +${data.reward} chips` : 'Daily streak on cooldown.');
    syncFreeClaimUI();
  } catch (e) {
    try {
      const data = await api('/api/me');
      state.freeClaimNextAt = data.freeClaimNextAt || null;
      state.freeClaimed = !Boolean(data.freeClaimAvailable);
      updateFreeClaimCountdown();
      setStatus('Daily streak on cooldown.');
      syncFreeClaimUI();
    } catch {
      setError(e.message);
    }
  }
}

async function loadChallenges() {
  try {
    const data = await api('/api/challenges');
    state.challenges = data.challenges;
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function claimChallenge(id) {
  try {
    const data = await api('/api/challenges/claim', {
      method: 'POST',
      body: JSON.stringify({ id })
    });
    setStatus(`Challenge claimed: +${data.reward} chips`);
    state.me.chips = data.chips;
    await loadChallenges();
  } catch (e) {
    setError(e.message);
  }
}

function logout() {
  if (state.socket) state.socket.disconnect();
  state.socket = null;
  state.token = null;
  state.me = null;
  state.currentMatch = null;
  state.currentLobby = null;
  state.revealPin = false;
  state.newPin = '';
  localStorage.removeItem('bb_token');
  localStorage.removeItem('bb_auth_token');
  localStorage.removeItem('bb_auth_username');
  render();
}

function renderNotificationBell() {
  const unread = unreadCount();
  return `
    <div class="notif-wrap">
      <button id="notifBell" class="ghost" aria-label="Notifications">
        Notifications ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ''}
      </button>
    </div>
  `;
}

function bindNotificationUI() {
  const bell = document.getElementById('notifBell');
  if (bell) {
    bell.onclick = () => {
      state.notificationsOpen = !state.notificationsOpen;
      render();
    };
  }
  const clearBtn = document.getElementById('clearNotifBtn');
  if (clearBtn) clearBtn.onclick = clearNotifications;
}

function syncToasts() {
  let wrap = document.getElementById('toastStack');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastStack';
    wrap.className = 'toast-stack';
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = state.toasts.map((t) => `<div class="toast-item">${t.message}</div>`).join('');
}

function syncNotificationOverlay() {
  let mount = document.getElementById('notifOverlayMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'notifOverlayMount';
    document.body.appendChild(mount);
  }
  if (!state.notificationsOpen) {
    mount.innerHTML = '';
    return;
  }
  mount.innerHTML = `
    <div class="notif-overlay-backdrop" id="notifBackdrop"></div>
    <div class="notif-overlay-panel card">
      <div class="notif-head">
        <strong>Notifications</strong>
        <div class="row">
          <button id="clearNotifBtn" class="ghost">Clear</button>
          <button id="closeNotifBtn" class="ghost">Close</button>
        </div>
      </div>
      ${
        state.notifications.length
          ? state.notifications
              .map(
                (n) => `
            <div class="notif-item">
              <div>${n.message}</div>
              ${
                n.type === 'friend_challenge'
                  ? `<div class="row">
                       <button class="primary" data-notif-ch-accept="${n.action?.data?.challengeId || ''}">Accept</button>
                       <button class="warn" data-notif-ch-decline="${n.action?.data?.challengeId || ''}">Decline</button>
                     </div>`
                  : n.action
                    ? `<button data-notif-action="${n.id}" class="primary">${n.action.label || 'Open'}</button>`
                    : ''
              }
            </div>
          `
              )
              .join('')
          : '<div class="muted">No notifications yet.</div>'
      }
    </div>
  `;
  const backdrop = document.getElementById('notifBackdrop');
  if (backdrop) {
    backdrop.onclick = () => {
      state.notificationsOpen = false;
      render();
    };
  }
  const clearBtn = document.getElementById('clearNotifBtn');
  if (clearBtn) clearBtn.onclick = clearNotifications;
  const closeBtn = document.getElementById('closeNotifBtn');
  if (closeBtn) closeBtn.onclick = () => {
    state.notificationsOpen = false;
    render();
  };
  mount.querySelectorAll('[data-notif-action]').forEach((btn) => {
    btn.onclick = () => {
      const notif = state.notifications.find((n) => n.id === btn.dataset.notifAction);
      runNotificationAction(notif);
      state.notificationsOpen = false;
      render();
    };
  });
  mount.querySelectorAll('[data-notif-ch-accept]').forEach((btn) => {
    btn.onclick = () => {
      respondFriendChallenge(btn.dataset.notifChAccept, 'accept');
      state.notificationsOpen = false;
      render();
    };
  });
  mount.querySelectorAll('[data-notif-ch-decline]').forEach((btn) => {
    btn.onclick = () => {
      respondFriendChallenge(btn.dataset.notifChDecline, 'decline');
      state.notificationsOpen = false;
      render();
    };
  });
}

function syncRoundResultModal() {
  let mount = document.getElementById('roundResultMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'roundResultMount';
    document.body.appendChild(mount);
  }
  if (!state.roundResultModal) {
    mount.innerHTML = '';
    return;
  }
  const delta = state.roundResultModal.delta || 0;
  const sign = delta > 0 ? '+' : '';
  mount.innerHTML = `
    <div class="result-overlay">
      <div class="result-modal card">
        <h3>${state.roundResultModal.title}</h3>
        <div class="muted">${state.roundResultModal.detail}</div>
        <div class="result-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${sign}${delta} chips</div>
        <button id="roundResultContinue" class="primary">Continue</button>
      </div>
    </div>
  `;
  const continueBtn = document.getElementById('roundResultContinue');
  if (continueBtn) {
    continueBtn.onclick = () => {
      state.roundResultModal = null;
      render();
    };
  }
}

function renderTopbar(title = 'Blackjack Battle') {
  const chipText = state.me?.chips?.toLocaleString?.() || '0';
  return `
    <div class="card topbar">
      <div class="topbar-left">
        <div class="logo" id="topLogo" tabindex="0"><span>${title}</span></div>
        <div class="chip-balance"><span class="chip-icon">◎</span>${chipText}</div>
      </div>
      <div class="topbar-center tabs">
        <button data-go="home" class="nav-pill ${state.view === 'home' ? 'nav-active' : ''}">Home</button>
        <button data-go="profile" class="nav-pill ${state.view === 'profile' ? 'nav-active' : ''}">Profile</button>
        <button data-go="friends" class="nav-pill ${state.view === 'friends' ? 'nav-active' : ''}">Friends</button>
        <button data-go="lobbies" class="nav-pill ${state.view === 'lobbies' ? 'nav-active' : ''}">Lobbies</button>
        <button data-go="challenges" class="nav-pill ${state.view === 'challenges' ? 'nav-active' : ''}">Challenges</button>
        <button data-go="rules" class="nav-pill ${state.view === 'rules' ? 'nav-active' : ''}">Rules</button>
      </div>
      <div class="topbar-right nav">
        ${renderNotificationBell()}
        <button class="warn" id="logoutBtn">Logout</button>
      </div>
    </div>
  `;
}

function bindShellNav() {
  app.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => {
      goToView(btn.dataset.go);
      if (state.view === 'friends') loadFriendsData();
      render();
    };
  });
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;
  const logo = document.getElementById('topLogo');
  if (logo) {
    logo.onmouseenter = () => logo.classList.add('shine');
    logo.onmouseleave = () => logo.classList.remove('shine');
    logo.onanimationend = () => logo.classList.remove('shine');
  }
}

function renderAuth() {
  app.innerHTML = `
    <div class="card auth">
      <h1>Blackjack Battle</h1>
      <p class="muted">1v1 real-time blackjack with poker-style pressure betting.</p>
      <div class="grid">
        <form id="loginForm" class="section card">
          <h3>Login</h3>
          <div class="grid">
            <input name="username" placeholder="Username" autocomplete="username" value="${state.authUsername || ''}" />
            <input name="pin" placeholder="4-digit PIN" autocomplete="one-time-code" inputmode="numeric" maxlength="4" />
            <button class="primary" type="submit">Login</button>
          </div>
        </form>
        <form id="registerForm" class="section card">
          <h3>Register</h3>
          <div class="grid">
            <input name="username" placeholder="Unique username" autocomplete="username" />
            <button class="gold" type="submit">Create Account</button>
          </div>
        </form>
      </div>
      ${
        state.newPin
          ? `<div class="card section" style="margin-top:0.8rem">
              <strong>Your login PIN: ${state.newPin}</strong>
              <div class="muted">Save this PIN. You will need it to log in on new devices.</div>
              <button id="copyPinBtn" class="gold" style="margin-top:0.5rem">Copy PIN</button>
            </div>`
          : ''
      }
      ${state.authNotice ? `<p class="muted">${state.authNotice}</p>` : ''}
      ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
    </div>
  `;

  document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    handleAuth('login', e.currentTarget);
  };
  document.getElementById('registerForm').onsubmit = (e) => {
    e.preventDefault();
    handleAuth('register', e.currentTarget);
  };
  const copyPinBtn = document.getElementById('copyPinBtn');
  if (copyPinBtn) {
    copyPinBtn.onclick = async () => {
      const ok = await safeCopy(state.newPin);
      pushToast(ok ? 'PIN copied.' : "Couldn't copy — please select and copy manually.");
    };
  }
}

function renderHome() {
  const me = state.me;
  const notes = state.patchNotes?.length ? state.patchNotes : FALLBACK_PATCH_NOTES;
  const latest = notes[0];

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}
    <main class="view-stack dashboard">
      <p class="muted view-subtitle">${me.username}</p>
      <div class="dashboard-grid">
        <section class="col card section reveal-panel glow-follow glow-follow--panel">
        <h2>Play</h2>
        <p class="muted">Open Lobbies to create or join private 1v1 games.</p>
        <div class="row">
          <button class="primary" id="openLobbiesBtn">Lobbies</button>
          <button class="ghost" id="quickPlayBtn">Quick Play</button>
        </div>
        <div class="grid" style="margin-top:0.7rem">
          <div class="muted">Play Against Bot</div>
          <div class="bot-segmented bot-slider" data-diff-slider>
            <div class="bot-slider-indicator" style="transform:translateX(${['easy', 'medium', 'normal'].indexOf(state.selectedBotDifficulty) * 100}%);"></div>
            <button data-bot="easy" class="${state.selectedBotDifficulty === 'easy' ? 'is-selected' : ''}">Easy</button>
            <button data-bot="medium" class="${state.selectedBotDifficulty === 'medium' ? 'is-selected' : ''}">Medium</button>
            <button data-bot="normal" class="${state.selectedBotDifficulty === 'normal' ? 'is-selected' : ''}">Normal</button>
          </div>
          <div class="bot-segmented bot-slider stake-slider" data-stake-slider>
            <div class="bot-slider-indicator" style="transform:translateX(${state.botStakeType === 'REAL' ? 0 : 100}%);"></div>
            <button data-stake="REAL" class="${state.botStakeType === 'REAL' ? 'is-selected' : ''}">Real Chips</button>
            <button data-stake="FAKE" class="${state.botStakeType === 'FAKE' ? 'is-selected' : ''}">Practice</button>
          </div>
          <div class="muted">Practice uses fake chips and won&apos;t affect your account.</div>
          <button class="gold" id="playBotBtn">Play Bot</button>
        </div>
        </section>
        <section class="col card section reveal-panel glow-follow glow-follow--panel">
        <h2>Stats</h2>
        <div class="kpis">
          <div class="kpi"><div class="muted">Total Matches</div><strong>${me.stats.matchesPlayed || 0}</strong></div>
          <div class="kpi"><div class="muted">Hands Won</div><strong>${me.stats.handsWon}</strong></div>
          <div class="kpi"><div class="muted">Hands Lost</div><strong>${me.stats.handsLost}</strong></div>
          <div class="kpi"><div class="muted">Pushes</div><strong>${me.stats.pushes || me.stats.handsPush || 0}</strong></div>
          <div class="kpi"><div class="muted">Blackjacks</div><strong>${me.stats.blackjacks || 0}</strong></div>
          <div class="kpi"><div class="muted">6–7 Dealt</div><strong>${me.stats.sixSevenDealt || 0}</strong></div>
        </div>
        <div class="free-claim-card">
          <div>
            <strong>Daily Streak</strong>
            <div class="muted">Streak: ${me.streakCount || 0} day${(me.streakCount || 0) === 1 ? '' : 's'} • Next reward +${me.nextStreakReward || 50}</div>
            <div class="muted" id="freeClaimCountdown">${state.freeClaimRemainingMs > 0 ? `Next claim in ${formatCooldown(state.freeClaimRemainingMs)}` : 'Available now'}</div>
          </div>
          <button class="gold" id="claimFreeBtn" ${state.freeClaimRemainingMs > 0 ? 'disabled' : ''}>${state.freeClaimRemainingMs > 0 ? 'On cooldown' : 'Claim +100'}</button>
        </div>
        <div class="bet-history">
          <h4>Bet History (Last 10)</h4>
          ${
            (me.betHistory || []).length
              ? `<div class="history-list">
                  ${(me.betHistory || [])
                    .slice(0, 10)
                    .map(
                      (h) => `<div class="history-row">
                        <span>${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>${h.mode}</span>
                        <span>Bet ${h.bet}</span>
                        <span>${h.result}</span>
                        <span class="${h.net >= 0 ? 'gain' : 'loss'}">${h.net >= 0 ? '+' : ''}${h.net}</span>
                      </div>`
                    )
                    .join('')}
                 </div>`
              : '<div class="muted">No real-chip hand history yet.</div>'
          }
        </div>
        </section>
        <section class="card section patch-card">
          <h2>Patch Notes</h2>
          ${
            latest
              ? `<div class="patch-latest">
                    <div class="muted">Latest update ${latest.date}${state.patchNotesDeploy?.commit ? ` • ${state.patchNotesDeploy.commit.slice(0, 7)}` : ''}</div>
                    <strong class="patch-date">${latest.title || 'Latest update'}</strong>
                 </div>`
              : ''
          }
      ${
        notes.slice(0, state.showMorePatchNotes ? notes.length : 3)
          .map(
            (entry) => `
          <article class="patch-item">
            <strong class="patch-date">${entry.date} • ${entry.title || 'Update'}</strong>
            <ul class="patch-list">
              ${entry.bullets.map((b) => `<li class="muted">${b}</li>`).join('')}
            </ul>
            ${
              state.showMorePatchNotes && entry.body
                ? `<div class="muted patch-body">${entry.body}</div>`
                : ''
            }
          </article>
        `
          )
          .join('')
      }
      <button id="togglePatchNotesBtn" class="ghost">${state.showMorePatchNotes ? 'View less' : 'View more'}</button>
        </section>
        <section class="card section patch-card rules-strip">
          <div>
            <strong>Rules:</strong> Blackjack 3:2 • 1 deck • reshuffle each round • surrender available
          </div>
          <div class="muted">Version: ${state.appVersion || 'dev'}</div>
          <button id="openRulesBtn" class="ghost">Rules</button>
        </section>
      </div>
    </main>
  `;

  bindShellNav();
  const togglePatchNotesBtn = document.getElementById('togglePatchNotesBtn');
  if (togglePatchNotesBtn) {
    togglePatchNotesBtn.onclick = () => {
      state.showMorePatchNotes = !state.showMorePatchNotes;
      render();
    };
  }
  document.getElementById('openLobbiesBtn').onclick = () => {
    goToView('lobbies');
    render();
  };
  document.getElementById('quickPlayBtn').onclick = () => {
    goToView('friends');
    render();
  };
  app.querySelectorAll('[data-bot]').forEach((btn) => {
    btn.onclick = () => {
      state.selectedBotDifficulty = btn.dataset.bot;
      render();
    };
  });
  app.querySelectorAll('[data-stake]').forEach((el) => {
    el.onclick = () => {
      state.botStakeType = el.dataset.stake;
      render();
    };
  });
  const playBotBtn = document.getElementById('playBotBtn');
  if (playBotBtn) playBotBtn.onclick = () => startBotMatch();

  const claimBtn = document.getElementById('claimFreeBtn');
  if (claimBtn) claimBtn.onclick = claimFree100;
  const openRulesBtn = document.getElementById('openRulesBtn');
  if (openRulesBtn) {
    openRulesBtn.onclick = () => {
      goToView('rules');
      render();
    };
  }
  syncFreeClaimUI();
}

function renderProfile() {
  const me = state.me;
  const preview = `https://api.dicebear.com/9.x/${encodeURIComponent(me.avatarStyle || 'adventurer')}/svg?seed=${encodeURIComponent(
    me.avatarSeed || me.username
  )}`;
  app.innerHTML = `
    ${renderTopbar('Profile')}
    <main class="view-stack">
      <div class="card section">
      <form id="profileForm" class="grid">
        <div class="row">
          <div class="col">
            <label>Username</label>
            <input value="${me.username}" disabled />
          </div>
          <div class="col">
            <label>Avatar Style</label>
            <select name="avatar_style">
              ${['adventurer', 'pixel-art', 'bottts', 'fun-emoji']
                .map((s) => `<option value="${s}" ${me.avatarStyle === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="col">
            <label>Avatar Seed</label>
            <input name="avatar_seed" value="${me.avatarSeed || me.username}" />
          </div>
          <div class="col">
            <label>Preview</label>
            <div style="display:flex;align-items:center;gap:10px">
              <img src="${preview}" alt="avatar preview" style="width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,0.15)" />
              <span class="muted">Generated automatically</span>
            </div>
          </div>
        </div>
        <div>
          <label>Bio</label>
          <textarea name="bio" rows="3">${me.bio || ''}</textarea>
        </div>
        <button class="primary" type="submit">Save Profile</button>
      </form>
      <p class="muted">Chip balance: ${me.chips}</p>
      <div class="row" style="align-items:center;gap:10px">
        <strong>Login PIN:</strong>
        <span>${state.revealPin ? me.pin || '****' : me.pinMasked || '****'}</span>
        <button id="togglePinBtn" class="ghost" type="button">${state.revealPin ? 'Hide PIN' : 'Show PIN'}</button>
        <button id="copyPinBtnProfile" class="ghost" type="button">Copy PIN</button>
      </div>
      </div>
    </main>
  `;
  bindShellNav();
  const togglePinBtn = document.getElementById('togglePinBtn');
  if (togglePinBtn) {
    togglePinBtn.onclick = () => {
      state.revealPin = !state.revealPin;
      render();
    };
  }
  const copyPinBtnProfile = document.getElementById('copyPinBtnProfile');
  if (copyPinBtnProfile) {
    copyPinBtnProfile.onclick = async () => {
      const ok = await safeCopy(me.pin || '');
      pushToast(ok ? 'PIN copied.' : "Couldn't copy — please select and copy manually.");
    };
  }
  document.getElementById('profileForm').onsubmit = (e) => {
    e.preventDefault();
    saveProfile(e.currentTarget);
  };
}

function renderFriends() {
  const inviteRemaining = state.friendInvite ? inviteRemainingMs() : 0;
  const inviteExpired = inviteRemaining <= 0;
  app.innerHTML = `
    ${renderTopbar('Friends')}
    <main class="view-stack">
      <div class="row">
      <div class="col card section">
        <h3>Send Friend Request</h3>
        <form id="friendForm" class="row friend-request-form">
          <input name="friend_username" placeholder="Friend username" />
          <button class="primary" type="submit">Request</button>
        </form>
        <div class="invite-link-tools">
          <div class="row invite-link-actions">
            <button id="inviteLinkBtn" class="primary" type="button">Generate Friend Invite Link</button>
            <button id="regenInviteLinkBtn" class="ghost" type="button">Regenerate</button>
          </div>
          ${
            state.friendInvite
              ? `<div class="grid" style="margin-top:0.55rem">
                  <input value="${state.friendInvite.url}" readonly />
                  <div class="row">
                    <button id="copyInviteLinkBtn" class="ghost" type="button" ${inviteExpired ? 'disabled' : ''}>Copy</button>
                    <span class="muted" id="inviteCountdown">${inviteExpired ? 'Expired' : `Expires in ${formatInviteCountdown(inviteRemaining)}`}</span>
                    <span class="muted">(${new Date(state.friendInvite.expiresAt).toLocaleTimeString()})</span>
                  </div>
                </div>`
              : ''
          }
        </div>
        <h3 style="margin-top:1rem">Incoming Friend Challenges</h3>
        ${
          state.incomingFriendChallenges.length
            ? state.incomingFriendChallenges
                .map(
                  (c) => `<div class="friend challenge-invite">
                    <div>
                      <strong>${c.fromUsername}</strong>
                      <div class="muted">Bet ${c.bet} chips ${c.message ? `• "${c.message}"` : ''}</div>
                      <div class="muted">Expires ${new Date(c.expiresAt).toLocaleTimeString()}</div>
                    </div>
                    <div class="row">
                      <button class="primary" data-challenge-accept="${c.id}">Accept</button>
                      <button class="warn" data-challenge-decline="${c.id}">Decline</button>
                    </div>
                  </div>`
                )
                .join('')
            : '<p class="muted">No incoming challenges.</p>'
        }
        <h3 style="margin-top:1rem">Incoming Requests</h3>
        ${
          state.incomingRequests.length
            ? state.incomingRequests
                .map(
                  (r) => `
            <div class="friend">
              <div><strong>${r.username}</strong></div>
              <div class="row">
                <button class="primary" data-accept="${r.id}">Accept</button>
                <button class="warn" data-decline="${r.id}">Decline</button>
              </div>
            </div>
          `
                )
                .join('')
            : '<p class="muted">No incoming requests.</p>'
        }
      </div>
      <div class="col card section">
        <h3>Friend List</h3>
        ${(state.friends || []).length === 0 ? '<p class="muted">No friends yet.</p>' : ''}
        ${(state.friends || [])
          .map(
            (f) => `
          <div class="friend">
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                ${
                  f.avatarUrl || f.avatar
                    ? `<img src="${f.avatarUrl || f.avatar}" alt="${f.username} avatar" style="width:26px;height:26px;border-radius:999px;border:1px solid rgba(255,255,255,0.16)" />`
                    : `<span style="width:26px;height:26px;border-radius:999px;display:inline-grid;place-items:center;background:rgba(255,255,255,0.12)">${(f.username || '?').slice(0, 1).toUpperCase()}</span>`
                }
                <span class="status-dot status-${f.presence || (f.online ? 'online' : 'offline')}"></span>
                <strong>${f.username}</strong>
              </div>
              <div class="muted">${f.presence === 'in_match' ? 'In match' : f.online ? 'Online' : 'Offline'} • ${f.chips} chips</div>
            </div>
            <div class="row">
              <button data-invite="${f.username}">Invite</button>
              <button class="ghost" data-challenge-open="${f.username}">Challenge</button>
            </div>
          </div>
        `
          )
          .join('')}
        <h3 style="margin-top:1rem">Outgoing Pending</h3>
        ${
          state.outgoingRequests.length
            ? state.outgoingRequests
                .map((r) => `<div class="friend"><div><strong>${r.username}</strong></div><span class="muted">Pending…</span></div>`)
                .join('')
            : '<p class="muted">No pending requests.</p>'
        }
      </div>
      </div>

    </main>
    ${
      state.challengeModalFriend
        ? `<div class="modal">
            <div class="modal-panel card">
              <h3>Challenge ${state.challengeModalFriend}</h3>
              <div class="grid">
                <label>Bet
                  <input id="challengeBetInput" type="number" min="5" max="${state.me?.chips || 0}" value="${state.challengeBet}" />
                </label>
                <label>Message
                  <input id="challengeMsgInput" maxlength="120" value="${state.challengeMessage || ''}" placeholder="Good luck" />
                </label>
              </div>
              <div class="row" style="margin-top:0.7rem">
                <button id="sendChallengeBtn" class="primary">Send Challenge</button>
                <button id="cancelChallengeBtn" class="ghost">Cancel</button>
              </div>
            </div>
          </div>`
        : ''
    }
  `;
  bindShellNav();

  document.getElementById('friendForm').onsubmit = (e) => {
    e.preventDefault();
    addFriend(e.currentTarget);
  };

  document.getElementById('inviteLinkBtn').onclick = () => createFriendInvite(false);
  const regenBtn = document.getElementById('regenInviteLinkBtn');
  if (regenBtn) regenBtn.onclick = () => createFriendInvite(true);
  const copyInviteBtn = document.getElementById('copyInviteLinkBtn');
  if (copyInviteBtn) {
    copyInviteBtn.onclick = async () => {
      if (inviteRemainingMs() <= 0) {
        pushToast('Invite expired. Regenerate to get a new link.');
        return;
      }
      const ok = await safeCopy(state.friendInvite?.url || '');
      pushToast(ok ? 'Invite link copied.' : "Couldn't copy — please select and copy manually.");
    };
  }
  syncInviteCountdownUI();
  app.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.onclick = () => acceptRequest(btn.dataset.accept);
  });
  app.querySelectorAll('[data-decline]').forEach((btn) => {
    btn.onclick = () => declineRequest(btn.dataset.decline);
  });
  app.querySelectorAll('[data-invite]').forEach((btn) => {
    btn.onclick = () => inviteFriendToLobby(btn.dataset.invite);
  });
  app.querySelectorAll('[data-challenge-open]').forEach((btn) => {
    btn.onclick = () => {
      state.challengeModalFriend = btn.dataset.challengeOpen;
      state.challengeBet = Math.max(5, Math.min(50, state.me?.chips || 50));
      state.challengeMessage = '';
      render();
    };
  });
  app.querySelectorAll('[data-challenge-accept]').forEach((btn) => {
    btn.onclick = () => respondFriendChallenge(btn.dataset.challengeAccept, 'accept');
  });
  app.querySelectorAll('[data-challenge-decline]').forEach((btn) => {
    btn.onclick = () => respondFriendChallenge(btn.dataset.challengeDecline, 'decline');
  });
  const sendChallengeBtn = document.getElementById('sendChallengeBtn');
  if (sendChallengeBtn) {
    sendChallengeBtn.onclick = () => {
      const bet = Number(document.getElementById('challengeBetInput')?.value || state.challengeBet);
      const msg = String(document.getElementById('challengeMsgInput')?.value || '');
      sendFriendChallenge(state.challengeModalFriend, bet, msg);
    };
  }
  const cancelChallengeBtn = document.getElementById('cancelChallengeBtn');
  if (cancelChallengeBtn) {
    cancelChallengeBtn.onclick = () => {
      state.challengeModalFriend = null;
      render();
    };
  }
}

function renderLobby() {
  const lobby = state.currentLobby;
  const hasPrefilledCode = Boolean((state.lobbyJoinInput || '').trim());
  app.innerHTML = `
    ${renderTopbar('Lobbies')}
    <main class="view-stack">
      <div class="row lobby-grid">
        <section class="col card section">
      <h3>Create Lobby</h3>
      <p class="muted">Create only when you want to host a private 1v1 room.</p>
      <button class="primary" id="createLobbyBtn">Create Lobby</button>
        </section>
        <section class="col card section">
          <h3>Join Existing Lobby</h3>
          <p class="muted">Enter a lobby code to join. This does not create a lobby.</p>
          <form id="joinLobbyForm" class="row">
            <input name="lobby_id" placeholder="Lobby code" value="${state.lobbyJoinInput || ''}" />
            <button class="primary" type="submit">${hasPrefilledCode ? 'Join Lobby' : 'Join'}</button>
          </form>
        </section>
      </div>

    ${
      lobby
        ? `
      <div class="card section">
        <div class="lobby">
          <div>
            <div><strong>Code:</strong> ${lobby.id}</div>
            <div class="muted">Owner: ${playerName(lobby.ownerId)}</div>
            <div class="muted">Opponent: ${lobby.opponentId ? playerName(lobby.opponentId) : 'Waiting...'}</div>
          </div>
          <button id="copyLobbyCode">Copy Join Code</button>
        </div>
        <p class="muted">Share this lobby code with one friend. Match starts when both players are connected.</p>
      </div>`
        : ''
    }

    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
    </main>
  `;

  bindShellNav();
  const createBtn = document.getElementById('createLobbyBtn');
  if (createBtn) createBtn.onclick = createLobby;

  document.getElementById('joinLobbyForm').onsubmit = (e) => {
    e.preventDefault();
    const code = e.currentTarget.querySelector('[name="lobby_id"]').value.trim().toUpperCase();
    state.lobbyJoinInput = code;
    if (code) joinLobby(code);
  };

  const copyBtn = document.getElementById('copyLobbyCode');
  if (copyBtn && lobby) {
    copyBtn.onclick = async () => {
      const link = `${window.location.origin}/lobbies?code=${lobby.id}`;
      const ok = await safeCopy(link);
      if (ok) pushToast('Lobby link copied.');
      else pushToast("Couldn't copy — select and copy manually.");
    };
  }
}

function renderChallenges() {
  const groups = state.challenges || { hourly: [], daily: [], weekly: [], skill: [] };
  const renderTier = (label, key) => `
    <div class="card section" style="margin-top:1rem">
      <h3>${label}</h3>
      ${
        (groups[key] || [])
          .map(
            (c) => `
          <div class="challenge ${c.progress >= c.goal && !c.claimed ? 'challenge-ready' : ''}">
            <div>
              <div><strong>${c.title}</strong></div>
              <div class="muted">${c.description}</div>
              <div class="muted">${c.progress}/${c.goal} • Reward ${c.rewardChips} chips</div>
            </div>
            <button class="${c.progress >= c.goal && !c.claimed ? 'claim-wiggle' : ''}" data-claim="${c.id}" ${c.claimed || c.progress < c.goal ? 'disabled' : ''}>${c.claimed ? 'Claimed' : 'Claim'}</button>
          </div>
        `
          )
          .join('') || '<p class="muted">No active challenges.</p>'
      }
    </div>
  `;
  app.innerHTML = `
    ${renderTopbar('Challenges')}
    <main class="view-stack">
      ${renderTier('Hourly Challenges', 'hourly')}
      ${renderTier('Daily Challenges', 'daily')}
      ${renderTier('Weekly Challenges', 'weekly')}
      ${renderTier('Skill Challenges', 'skill')}
    </main>
  `;
  bindShellNav();

  app.querySelectorAll('[data-claim]').forEach((btn) => {
    btn.onclick = () => claimChallenge(btn.dataset.claim);
  });
}

function renderNotifications() {
  app.innerHTML = `
    ${renderTopbar('Notifications')}
    <main class="view-stack">
      <div class="card section">
      ${
        state.notifications.length
          ? state.notifications
              .map(
                (n) => `
            <div class="notif-item">
              <div>${n.message}</div>
              <div class="muted">${new Date(n.createdAt).toLocaleString()}</div>
              ${
                n.type === 'friend_challenge'
                  ? `<div class="row">
                       <button class="primary" data-notif-ch-accept="${n.action?.data?.challengeId || ''}">Accept</button>
                       <button class="warn" data-notif-ch-decline="${n.action?.data?.challengeId || ''}">Decline</button>
                     </div>`
                  : n.action
                    ? `<button data-notif-action="${n.id}" class="primary">${n.action.label || 'Open'}</button>`
                    : ''
              }
            </div>
          `
              )
              .join('')
          : '<p class="muted">No notifications yet.</p>'
      }
      <div class="row" style="margin-top:0.8rem">
        <button id="clearNotifViewBtn" class="ghost">Clear all</button>
      </div>
      </div>
    </main>
  `;
  bindShellNav();
  const clearBtn = document.getElementById('clearNotifViewBtn');
  if (clearBtn) clearBtn.onclick = clearNotifications;
  app.querySelectorAll('[data-notif-action]').forEach((btn) => {
    btn.onclick = () => {
      const notif = state.notifications.find((n) => n.id === btn.dataset.notifAction);
      runNotificationAction(notif);
    };
  });
  app.querySelectorAll('[data-notif-ch-accept]').forEach((btn) => {
    btn.onclick = () => respondFriendChallenge(btn.dataset.notifChAccept, 'accept');
  });
  app.querySelectorAll('[data-notif-ch-decline]').forEach((btn) => {
    btn.onclick = () => respondFriendChallenge(btn.dataset.notifChDecline, 'decline');
  });
}

function renderRules() {
  app.innerHTML = `
    ${renderTopbar('Rules')}
    <main class="view-stack">
      <div class="card section">
        <h3>Rules & Fairness</h3>
        <ul class="patch-list">
          <li class="muted">Blackjack pays 3:2 for natural blackjack.</li>
          <li class="muted">Single 52-card deck, reshuffled every round.</li>
          <li class="muted">Each player sees one opponent upcard; hidden cards reveal at resolution.</li>
          <li class="muted">Surrender loses 75% of the hand bet.</li>
          <li class="muted">Split/double pressure requires opponent to match or surrender.</li>
          <li class="muted">Leaving a PvP match is treated as forfeit.</li>
        </ul>
        <div class="muted">Version: ${state.appVersion || 'dev'}</div>
      </div>
    </main>
  `;
  bindShellNav();
}

function renderHand(hand, index, active, pressureTagged = false) {
  const labels = [];
  if (hand.bust) labels.push('Bust');
  if (hand.surrendered) labels.push('Surrendered');
  if (hand.stood) labels.push('Stood');
  if (hand.locked && !hand.bust && !hand.surrendered && !hand.stood) labels.push('Locked');
  if (hand.doubled) labels.push('Doubled');
  if (hand.isSoft) labels.push('Soft');
  if (hand.outcome) labels.push(hand.outcome.toUpperCase());
  if (active && !hand.locked) labels.unshift('Active');

  return `
    <div class="hand ${active ? 'active' : ''}">
      <div class="hand-head">
        <strong>Hand ${index + 1} ${pressureTagged ? '<span class="pressure-dot" title="Pressure decision applies">*</span>' : ''}</strong>
        <span class="hand-chip">Bet: ${hand.bet}</span>
      </div>
      <div class="muted">${formatHandTotalLine(hand)}</div>
      <div class="muted hand-status">${labels.join(' • ') || 'In play'}</div>
      <div class="cards">
        ${hand.cards.map((card, cardIndex) => renderPlayingCard(card, cardIndex)).join('')}
      </div>
    </div>
  `;
}

function renderPlayingCard(card, cardIndex = 0) {
  if (card.hidden) {
    return `<div class="playing-card hidden deal-in" style="animation-delay:${cardIndex * 40}ms" aria-label="Face-down card"></div>`;
  }

  const suitMap = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const symbol = suitMap[card.suit] || '?';
  const isRed = card.suit === 'H' || card.suit === 'D';
  const colorClass = isRed ? 'red' : 'black';
  return `
    <div class="playing-card face ${colorClass} deal-in" style="animation-delay:${cardIndex * 40}ms" aria-label="${card.rank}${symbol}">
      <div class="corner top"><span class="rank">${card.rank}</span><span class="suit">${symbol}</span></div>
      <div class="center-suit">${symbol}</div>
      <div class="corner bottom"><span class="rank">${card.rank}</span><span class="suit">${symbol}</span></div>
    </div>
  `;
}

function renderMatch() {
  const match = state.currentMatch;
  const me = state.me;
  if (!match) {
    goToView('home');
    return render();
  }

  const myState = match.players[me.id];
  const oppId = getOpponentId();
  const oppState = match.players[oppId];
  const activeHand = myState.hands[myState.activeHandIndex] || null;
  const myTurn = isMyTurn();
  const pressure = match.pendingPressure;
  const waitingPressure = pressure && pressure.opponentId === me.id;
  const isBettingPhase = match.phase === 'ROUND_INIT';
  const opponentConnected = match.disconnects[oppId]?.connected;
  const isBotOpponent = Boolean(match.participants?.[oppId]?.isBot);
  const isPvpMatch = !isBotOpponent;
  const phaseLabelMap = {
    ROUND_INIT: 'Betting',
    ACTION_TURN: 'Action',
    PRESSURE_RESPONSE: 'Pressure',
    HAND_ADVANCE: 'Advance',
    ROUND_RESOLVE: 'Resolve',
    NEXT_ROUND: 'Next Round'
  };
  const phaseLabel = phaseLabelMap[match.phase] || match.phase;
  const roundResolved = match.phase === 'ROUND_RESOLVE' || match.phase === 'NEXT_ROUND';
  const canAct = myTurn && !waitingPressure && activeHand && !activeHand.locked;
  const canEditBet = Boolean(match.canEditBet);
  const canConfirmBet = Boolean(match.canConfirmBet);
  const myConfirmed = Boolean(match.betConfirmedByPlayer?.[me.id]);
  const oppConfirmed = Boolean(match.betConfirmedByPlayer?.[oppId]);
  const minBet = match.minBet || 5;
  const maxBet = Math.min(match.maxBetCap || 500, state.me?.chips || 0);
  const actionHint = canAct
    ? 'Choose an action for your active hand.'
    : waitingPressure
      ? 'Respond to pressure: Match or Surrender.'
      : 'Waiting for next turn.';
  const pressureMine = waitingPressure ? new Set(pressure?.affectedHandIndices || []) : new Set();
  const pressureOpp = pressure && pressure.opponentId === oppId ? new Set(pressure?.affectedHandIndices || []) : new Set();

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}
    <main class="view-stack match-view">
      <div class="match match-shell card section reveal-panel">
        ${
          isBettingPhase
            ? `<section class="betting-layout">
                <div class="betting-header">
                  <h3>Round ${match.roundNumber} — Place your bet</h3>
                  <div class="bankroll-pill"><span class="muted">Bankroll</span> <strong>${(myState.bankroll ?? me.chips).toLocaleString()}</strong></div>
                </div>
                <div class="match-zone betting-zone">
                  <div class="bet-control">
                    <div class="bet-head">
                      <strong>Base Bet</strong>
                      <span class="muted">Min ${minBet} / Max ${maxBet}</span>
                    </div>
                    <div class="bet-row">
                      <button id="betMinus" class="ghost" ${!canEditBet ? 'disabled' : ''}>-</button>
                      <div class="bet-pill">${state.currentBet}</div>
                      <button id="betPlus" class="ghost" ${!canEditBet ? 'disabled' : ''}>+</button>
                      <button data-bet-quick="5" class="gold" ${!canEditBet ? 'disabled' : ''}>+5</button>
                      <button data-bet-quick="10" class="gold" ${!canEditBet ? 'disabled' : ''}>+10</button>
                      <button data-bet-quick="25" class="gold" ${!canEditBet ? 'disabled' : ''}>+25</button>
                    </div>
                    <div class="bet-confirm-row">
                      <button id="confirmBetBtn" class="primary" ${!canConfirmBet ? 'disabled' : ''}>Confirm Bet</button>
                      <div class="muted">${myConfirmed ? 'You confirmed.' : 'Waiting for your confirmation.'} ${oppConfirmed ? 'Opponent confirmed.' : 'Waiting for opponent...'}</div>
                    </div>
                  </div>
                </div>
              </section>`
            : `<section class="match-main play-layout">
                <div class="status-strip">
                  <div class="strip-item"><span class="muted">Round</span> <strong>${match.roundNumber}</strong></div>
                  <div class="strip-item"><span class="muted">Turn</span> <strong class="${myTurn ? 'your-turn' : ''}">${myTurn ? 'You' : playerName(match.currentTurn)}</strong></div>
                  <div class="strip-item"><span class="muted">Phase</span> <strong>${phaseLabel}</strong></div>
                  <div class="strip-item bankroll-pill"><span class="muted">Bankroll</span> <strong>${(myState.bankroll ?? me.chips).toLocaleString()}</strong></div>
                </div>
                <div class="match-zone opponent-zone">
                  <div class="zone-head">
                    <h4>Opponent: ${playerName(oppId)}
                    ${
                      state.floatingEmote && state.floatingEmote.fromUserId === oppId
                        ? `<span class="emote-bubble ${state.floatingEmote.type === 'emoji' ? 'emoji' : 'quip'}">${state.floatingEmote.value}</span>`
                        : ''
                    }
                    </h4>
                    <span class="muted">${isBotOpponent ? 'Bot practice' : opponentConnected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                  <div class="hands">
                    ${oppState.hands.map((h, idx) => renderHand(h, idx, idx === oppState.activeHandIndex, pressureOpp.has(idx))).join('')}
                  </div>
                </div>
                <div class="match-zone you-zone">
                  <div class="zone-head">
                    <h4>You: ${playerName(me.id)}</h4>
                    <span class="turn ${myTurn ? 'turn-on' : ''}">${myTurn ? 'Your turn' : 'Stand by'}</span>
                  </div>
                  <div class="hands">
                    ${myState.hands.map((h, idx) => renderHand(h, idx, idx === myState.activeHandIndex, pressureMine.has(idx))).join('')}
                  </div>
                </div>

                <div class="actions-panel" ${roundResolved ? 'style="display:none"' : ''}>
                  <div class="actions actions-compact">
                    <button data-action="hit" title="${canAct ? 'Draw one card' : actionHint}" class="primary" ${!canAct ? 'disabled' : ''}>Hit</button>
                    <button data-action="stand" title="${canAct ? 'Lock this hand' : actionHint}" class="ghost" ${!canAct ? 'disabled' : ''}>Stand</button>
                    <button data-action="double" title="${canAct ? 'Double bet, take one card, lock hand' : actionHint}" ${!canAct || activeHand.doubled ? 'disabled' : ''}>Double</button>
                    <button data-action="split" title="${handCanSplit(activeHand) ? 'Split pair into two hands' : 'Split requires pair'}" ${!canAct || !handCanSplit(activeHand) ? 'disabled' : ''}>Split</button>
                    <button class="warn" data-action="surrender" title="${canAct ? 'Lose 75% and lock hand' : actionHint}" ${!canAct ? 'disabled' : ''}>Surrender</button>
                    ${
                      isPvpMatch
                        ? `<button id="toggleEmoteBtn" class="ghost" type="button">🙂 Emote</button>
                           <button id="leaveMatchBtn" class="ghost leave-btn" type="button">Leave</button>`
                        : ''
                    }
                  </div>
                  ${
                    isPvpMatch && state.emotePickerOpen
                      ? `<div class="emote-row">
                          <div class="emote-popover card">
                            <div class="emote-grid">
                              <button data-emote-type="emoji" data-emote-value="😂">😂</button>
                              <button data-emote-type="emoji" data-emote-value="😭">😭</button>
                              <button data-emote-type="emoji" data-emote-value="👍">👍</button>
                              <button data-emote-type="emoji" data-emote-value="😡">😡</button>
                            </div>
                            <div class="emote-quips">
                              <button data-emote-type="quip" data-emote-value="Bitchmade">Bitchmade</button>
                              <button data-emote-type="quip" data-emote-value="Fuck you">Fuck you</button>
                              <button data-emote-type="quip" data-emote-value="Skill issue">Skill issue</button>
                              <button data-emote-type="quip" data-emote-value="L">L</button>
                            </div>
                          </div>
                        </div>`
                      : ''
                  }
                  ${
                    pressure
                      ? `<div class="pressure-banner">
                        <strong>Pressure Bet Response Required</strong>
                        <div class="muted">${playerName(pressure.initiatorId)} used <strong>${pressure.type}</strong>.</div>
                        ${
                          waitingPressure
                            ? `<div class="muted">Match +${pressure.delta} chips or surrender this hand.</div>
                               <div class="pressure-actions">
                                 <button class="primary" id="pressureMatch">Match Bet</button>
                                 <button class="warn" id="pressureSurrender">Surrender Hand</button>
                               </div>`
                            : '<div class="muted">Waiting for opponent decision...</div>'
                        }
                      </div>`
                      : ''
                  }
                  ${
                    state.leaveMatchModal
                      ? `<div class="leave-inline">
                        <strong>Leave Match?</strong>
                        <p class="muted">You will forfeit this round and end the match.</p>
                        <div class="pressure-actions">
                          <button id="confirmLeaveMatchBtn" class="warn">Leave Match</button>
                          <button id="cancelLeaveMatchBtn" class="ghost">Cancel</button>
                        </div>
                      </div>`
                      : ''
                  }
                </div>

                <details class="match-details">
                  <summary>Details</summary>
                  <div class="muted">
                    ${
                      isBotOpponent
                        ? `Opponent is ${playerName(oppId)} (${match.participants?.[oppId]?.difficulty} difficulty).`
                        : `Disconnect grace: up to 60 seconds reconnect is allowed. Connected states: You ${
                            match.disconnects[me.id]?.connected ? 'online' : 'offline'
                          } / Opponent ${opponentConnected ? 'online' : 'offline'}`
                    }
                  </div>
                  <div class="muted">${actionHint}</div>
                </details>
              </section>`
        }
      </div>
    </main>
  `;
  bindShellNav();

  app.querySelectorAll('[data-action]').forEach((btn) => {
    btn.onclick = () => emitAction(btn.dataset.action);
  });
  const betMinus = document.getElementById('betMinus');
  if (betMinus) betMinus.onclick = () => adjustBet(-5);
  const betPlus = document.getElementById('betPlus');
  if (betPlus) betPlus.onclick = () => adjustBet(5);
  app.querySelectorAll('[data-bet-quick]').forEach((btn) => {
    btn.onclick = () => adjustBet(Number(btn.dataset.betQuick));
  });
  const confirmBetBtn = document.getElementById('confirmBetBtn');
  if (confirmBetBtn) confirmBetBtn.onclick = () => emitConfirmBet();

  const matchBtn = document.getElementById('pressureMatch');
  if (matchBtn) matchBtn.onclick = () => emitPressureDecision('match');

  const surrenderBtn = document.getElementById('pressureSurrender');
  if (surrenderBtn) surrenderBtn.onclick = () => emitPressureDecision('surrender');
  const emoteToggleBtn = document.getElementById('toggleEmoteBtn');
  if (emoteToggleBtn) {
    emoteToggleBtn.onclick = () => {
      state.emotePickerOpen = !state.emotePickerOpen;
      render();
    };
  }
  app.querySelectorAll('[data-emote-type]').forEach((btn) => {
    btn.onclick = () => {
      emitEmote(btn.dataset.emoteType, btn.dataset.emoteValue);
      state.emotePickerOpen = false;
      render();
    };
  });
  const leaveMatchBtn = document.getElementById('leaveMatchBtn');
  if (leaveMatchBtn) {
    leaveMatchBtn.onclick = () => {
      state.leaveMatchModal = true;
      render();
    };
  }
  const confirmLeaveMatchBtn = document.getElementById('confirmLeaveMatchBtn');
  if (confirmLeaveMatchBtn) {
    confirmLeaveMatchBtn.onclick = () => {
      state.leaveMatchModal = false;
      emitLeaveMatch();
    };
  }
  const cancelLeaveMatchBtn = document.getElementById('cancelLeaveMatchBtn');
  if (cancelLeaveMatchBtn) {
    cancelLeaveMatchBtn.onclick = () => {
      state.leaveMatchModal = false;
      render();
    };
  }
}

function render() {
  const enteringFriends = state.lastRenderedView !== 'friends' && state.view === 'friends';
  state.lastRenderedView = state.view;
  app.dataset.view = state.view;
  if (!state.token || !state.me) {
    renderAuth();
  } else {
    if (state.view === 'profile') {
      renderProfile();
    } else if (state.view === 'friends') {
      renderFriends();
    } else if (state.view === 'lobbies') {
      renderLobby();
    } else if (state.view === 'challenges') {
      renderChallenges();
    } else if (state.view === 'notifications') {
      renderNotifications();
    } else if (state.view === 'rules') {
      renderRules();
    } else if (state.view === 'match') {
      renderMatch();
    } else {
      renderHome();
    }
  }
  applyGlowFollowClasses();
  bindNotificationUI();
  syncToasts();
  syncNotificationOverlay();
  syncRoundResultModal();
  if (enteringFriends && state.token) loadFriendsData();
}

(async function init() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.notificationsOpen) {
      state.notificationsOpen = false;
      render();
    }
  });
  window.addEventListener('popstate', () => {
    state.view = initialViewFromPath();
    render();
  });
  initCursorSpotlight();
  useHoverGlow();
  if (!freeClaimTicker) {
    freeClaimTicker = setInterval(() => {
      if (!state.token || !state.me || !state.freeClaimNextAt) return;
      updateFreeClaimCountdown();
      if (state.view === 'home') syncFreeClaimUI();
    }, 1000);
  }
  if (!inviteCountdownTicker) {
    inviteCountdownTicker = setInterval(() => {
      if (!state.friendInvite) return;
      if (state.view === 'friends') syncInviteCountdownUI();
      else state.friendInviteRemainingMs = inviteRemainingMs();
    }, 1000);
  }
  render();
  if (state.token) {
    await loadMe();
    if (state.token && state.me) {
      connectSocket();
      await loadChallenges();
      render();
    }
  }
})();
