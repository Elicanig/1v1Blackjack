import { formatHandTotalLine } from './match-view-model.js';
const app = document.getElementById('app');
let spotlightInitialized = false;
let hoverGlowInitialized = false;
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
      el.classList.add('is-hovering');
      const r = el.getBoundingClientRect();
      queue(el, r.width / 2, r.height / 2, r.width, r.height);
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
    .querySelectorAll('button.primary, button.gold, button.ghost, .bot-segmented button, .nav button:not(.warn)')
    .forEach((el) => el.classList.add('glow-follow'));
}

const state = {
  token: localStorage.getItem('bb_auth_token') || localStorage.getItem('bb_token') || null,
  authUsername: localStorage.getItem('bb_auth_username') || '',
  authNotice: '',
  me: null,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  notifications: [],
  notificationsOpen: false,
  toasts: [],
  challenges: [],
  view: initialViewFromPath(),
  socket: null,
  status: '',
  error: '',
  currentLobby: null,
  currentMatch: null,
  pendingFriendInviteCode: new URLSearchParams(window.location.search).get('friendInvite'),
  pendingLobbyCode: joinCodeFromLocation(),
  lobbyJoinInput: '',
  lastRenderedView: '',
  freeClaimed: false,
  freeClaimedAt: null,
  currentBet: 5,
  selectedBotDifficulty: 'normal'
};

function setStatus(message = '') {
  state.status = message;
  state.error = '';
  render();
}

function pushToast(message, type = 'info') {
  const toast = { id: Math.random().toString(36).slice(2), message, type };
  state.toasts = [...state.toasts, toast].slice(-3);
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== toast.id);
    render();
  }, 2800);
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
  state.socket.on('lobby:update', (lobby) => {
    state.currentLobby = lobby;
    render();
  });
  state.socket.on('match:state', (match) => {
    state.currentMatch = match;
    if (typeof match.selectedBet === 'number') {
      const preferred = state.currentBet;
      state.currentBet = match.selectedBet;
      if (state.me?.id) localStorage.setItem(`bb_last_bet_${state.me.id}`, String(match.selectedBet));
      if (match.canEditBet && Number.isFinite(preferred) && preferred !== match.selectedBet) {
        emitSetBaseBet(preferred);
      }
    }
    goToView('match');
    render();
  });
  state.socket.on('match:error', ({ error }) => setError(error));
  state.socket.on('match:ended', ({ reason }) => {
    setStatus(reason);
    state.currentMatch = null;
    state.currentLobby = null;
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
    state.notifications = data.notifications || [];
    state.challenges = data.challenges || [];
    state.freeClaimed = Boolean(data.freeClaimed || data.user?.hasClaimedFree100);
    state.freeClaimedAt = null;
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
    state.challenges = [];
    state.freeClaimed = false;
    state.freeClaimedAt = null;
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
  const authToken = form.querySelector('[name="auth_token"]')?.value.trim();
  if (!username) return setError('Username required');
  try {
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register' ? { username } : { username, authToken };
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
      const copied = await safeCopy(data.authToken);
      setStatus(copied ? 'Account created. Session token copied.' : `Account created. Session token: ${data.authToken}`);
    } else {
      setStatus('Logged in.');
    }
    connectSocket();
    await loadMe();
  } catch (e) {
    if (mode === 'login') {
      state.authNotice = 'Login failed. Check username and session token.';
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

async function createFriendInvite() {
  try {
    const data = await api('/api/friends/invite-link', { method: 'POST' });
    const ok = await safeCopy(data.link);
    if (ok) pushToast('Friend invite link copied.');
    else pushToast("Couldn't copy — select and copy manually.");
    setStatus(data.link);
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
    setStatus(`Added ${data.inviter.username} as a friend.`);
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
    goToView(data.matchId ? 'match' : 'lobby');
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
    render();
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
  }
}

async function startBotMatch(difficulty) {
  state.selectedBotDifficulty = difficulty;
  try {
    const data = await api('/api/lobbies/bot', {
      method: 'POST',
      body: JSON.stringify({ difficulty })
    });
    state.currentLobby = null;
    state.currentMatch = data.match;
    goToView('match');
    setStatus(`Practice match started vs ${difficulty} bot.`);
  } catch (e) {
    setError(e.message);
  }
}

async function claimFree100() {
  try {
    const data = await api('/api/free-claim', { method: 'POST' });
    state.me.chips = data.chips;
    state.freeClaimed = true;
    state.freeClaimedAt = data.claimedAt || null;
    setStatus(data.reward > 0 ? `Claimed free +${data.reward} chips` : 'Free chips already claimed.');
  } catch (e) {
    setError(e.message);
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
  localStorage.removeItem('bb_token');
  localStorage.removeItem('bb_auth_token');
  localStorage.removeItem('bb_auth_username');
  render();
}

function renderNotificationBell() {
  const unread = unreadCount();
  return `
    <div class="notif-wrap">
      <button id="notifBell" class="ghost">Notifications ${unread > 0 ? `<span class="notif-badge">${unread}</span>` : ''}</button>
      ${
        state.notificationsOpen
          ? `<div class="notif-panel card">
              <div class="notif-head">
                <strong>Notifications</strong>
                <button id="clearNotifBtn" class="ghost">Clear</button>
              </div>
              ${
                state.notifications.length
                  ? state.notifications
                      .map(
                        (n) => `
                    <div class="notif-item">
                      <div>${n.message}</div>
                      ${
                        n.action
                          ? `<button data-notif-action="${n.id}" class="primary">${n.action.label || 'Open'}</button>`
                          : ''
                      }
                    </div>
                  `
                      )
                      .join('')
                  : '<div class="muted">No notifications yet.</div>'
              }
            </div>`
          : ''
      }
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
  app.querySelectorAll('[data-notif-action]').forEach((btn) => {
    btn.onclick = () => {
      const notif = state.notifications.find((n) => n.id === btn.dataset.notifAction);
      runNotificationAction(notif);
      state.notificationsOpen = false;
    };
  });
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

function renderTopbar(title = 'Blackjack Battle') {
  return `
    <div class="card topbar">
      <div class="logo">${title}</div>
      <div class="nav">
        <button data-go="home" class="${state.view === 'home' ? 'nav-active' : ''}">Home</button>
        <button data-go="profile" class="${state.view === 'profile' ? 'nav-active' : ''}">Profile</button>
        <button data-go="friends" class="${state.view === 'friends' ? 'nav-active' : ''}">Friends</button>
        <button data-go="lobbies" class="${state.view === 'lobbies' ? 'nav-active' : ''}">Lobbies</button>
        <button data-go="challenges" class="${state.view === 'challenges' ? 'nav-active' : ''}">Challenges</button>
        <button data-go="notifications" class="${state.view === 'notifications' ? 'nav-active' : ''}">Notifications</button>
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
}

function renderAuth() {
  app.innerHTML = `
    <div class="card auth">
      <h1>Blackjack Battle</h1>
      <p class="muted">1v1 real-time blackjack with poker-style pressure betting.</p>
      <div class="grid">
        <form id="loginForm" class="section card">
          <h3>Login With Session Token</h3>
          <div class="grid">
            <input name="username" placeholder="Username" autocomplete="username" value="${state.authUsername || ''}" />
            <input name="auth_token" placeholder="Session token (optional)" autocomplete="off" />
            <button class="primary" type="submit">Login</button>
          </div>
        </form>
        <form id="registerForm" class="section card">
          <h3>Register</h3>
          <div class="grid">
            <input name="username" placeholder="Unique username" autocomplete="username" />
            <button class="gold" type="submit">Create Account + Token</button>
          </div>
        </form>
      </div>
      ${state.authNotice ? `<p class="muted">${state.authNotice}</p>` : ''}
      ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
      ${state.status ? `<p class="muted">${state.status}</p>` : ''}
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
}

function renderHome() {
  const me = state.me;

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}
    <p class="muted">${me.username} • ${me.chips} chips</p>

    <div class="row">
      <div class="col card section reveal-panel glow-follow glow-follow--panel">
        <h2>Play</h2>
        <p class="muted">Open Lobbies to create or join private 1v1 games.</p>
        <div class="row">
          <button class="primary" id="openLobbiesBtn">Lobbies</button>
          <button class="ghost" id="quickPlayBtn">Quick Play</button>
        </div>
        <div class="grid" style="margin-top:0.7rem">
          <div class="muted">Play Against Bot</div>
          <div class="row bot-segmented">
            <button data-bot="easy" class="${state.selectedBotDifficulty === 'easy' ? 'is-selected' : ''}">Easy</button>
            <button data-bot="medium" class="${state.selectedBotDifficulty === 'medium' ? 'is-selected' : ''}">Medium</button>
            <button data-bot="normal" class="${state.selectedBotDifficulty === 'normal' ? 'is-selected' : ''}">Normal</button>
          </div>
        </div>
      </div>
      <div class="col card section reveal-panel glow-follow glow-follow--panel">
        <h2>Stats</h2>
        <div class="kpis">
          <div class="kpi"><div class="muted">Matches</div><strong>${me.stats.matchesPlayed}</strong></div>
          <div class="kpi"><div class="muted">Rounds Won</div><strong>${me.stats.roundsWon}</strong></div>
          <div class="kpi"><div class="muted">Hands Won</div><strong>${me.stats.handsWon}</strong></div>
          <div class="kpi"><div class="muted">Hands Lost</div><strong>${me.stats.handsLost}</strong></div>
          <div class="kpi"><div class="muted">Pushes</div><strong>${me.stats.pushes || me.stats.handsPush || 0}</strong></div>
        </div>
        <div class="free-claim-card">
          <div>
            <strong>Free 100 Chips</strong>
            <div class="muted">${state.freeClaimed ? 'Claimed' : 'One-time bankroll boost'}</div>
          </div>
          <button class="gold" id="claimFreeBtn" ${state.freeClaimed ? 'disabled' : ''}>${state.freeClaimed ? 'Claimed' : 'Claim free 100 chips'}</button>
        </div>
      </div>
    </div>

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    
  `;

  bindShellNav();
  document.getElementById('openLobbiesBtn').onclick = () => {
    goToView('lobbies');
    render();
  };
  document.getElementById('quickPlayBtn').onclick = () => {
    goToView('friends');
    render();
  };
  app.querySelectorAll('[data-bot]').forEach((btn) => {
    btn.onclick = () => startBotMatch(btn.dataset.bot);
  });

  const claimBtn = document.getElementById('claimFreeBtn');
  if (claimBtn) claimBtn.onclick = claimFree100;
}

function renderProfile() {
  const me = state.me;
  const preview = `https://api.dicebear.com/9.x/${encodeURIComponent(me.avatarStyle || 'adventurer')}/svg?seed=${encodeURIComponent(
    me.avatarSeed || me.username
  )}`;
  app.innerHTML = `
    ${renderTopbar('Profile')}

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
      ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    </div>
  `;
  bindShellNav();
  document.getElementById('profileForm').onsubmit = (e) => {
    e.preventDefault();
    saveProfile(e.currentTarget);
  };
}

function renderFriends() {
  app.innerHTML = `
    ${renderTopbar('Friends')}

    <div class="row">
      <div class="col card section">
        <h3>Send Friend Request</h3>
        <form id="friendForm" class="row">
          <input name="friend_username" placeholder="Friend username" />
          <button class="primary" type="submit">Request</button>
        </form>
        <button id="inviteLinkBtn" style="margin-top:0.7rem">Generate Friend Invite Link</button>
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
              <strong>${f.username}</strong>
              <div class="muted">${f.online ? 'Online' : 'Offline'} • ${f.chips} chips</div>
            </div>
            <button data-invite="${f.username}">Invite</button>
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

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
  `;
  bindShellNav();

  document.getElementById('friendForm').onsubmit = (e) => {
    e.preventDefault();
    addFriend(e.currentTarget);
  };

  document.getElementById('inviteLinkBtn').onclick = createFriendInvite;
  app.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.onclick = () => acceptRequest(btn.dataset.accept);
  });
  app.querySelectorAll('[data-decline]').forEach((btn) => {
    btn.onclick = () => declineRequest(btn.dataset.decline);
  });
  app.querySelectorAll('[data-invite]').forEach((btn) => {
    btn.onclick = () => inviteFriendToLobby(btn.dataset.invite);
  });
}

function renderLobby() {
  const lobby = state.currentLobby;
  const hasPrefilledCode = Boolean((state.lobbyJoinInput || '').trim());
  app.innerHTML = `
    ${renderTopbar('Lobbies')}

    <div class="card section">
      <h3>Create Lobby</h3>
      <p class="muted">Create only when you want to host a private 1v1 room.</p>
      <button class="primary" id="createLobbyBtn">Create Lobby</button>
    </div>

    ${
      lobby
        ? `
      <div class="card section" style="margin-top:1rem">
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

    <div class="card section" style="margin-top:1rem">
      <h3>Join Existing Lobby</h3>
      <p class="muted">Enter a lobby code to join. This does not create a lobby.</p>
      <form id="joinLobbyForm" class="row">
        <input name="lobby_id" placeholder="Lobby code" value="${state.lobbyJoinInput || ''}" />
        <button class="primary" type="submit">${hasPrefilledCode ? 'Join Lobby' : 'Join'}</button>
      </form>
    </div>

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
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
      setStatus(link);
    };
  }
}

function renderChallenges() {
  const groups = state.challenges || { hourly: [], daily: [], weekly: [] };
  const renderTier = (label, key) => `
    <div class="card section" style="margin-top:1rem">
      <h3>${label}</h3>
      ${
        (groups[key] || [])
          .map(
            (c) => `
          <div class="challenge">
            <div>
              <div><strong>${c.title}</strong></div>
              <div class="muted">${c.description}</div>
              <div class="muted">${c.progress}/${c.goal} • Reward ${c.rewardChips} chips</div>
            </div>
            <button data-claim="${c.id}" ${c.claimed || c.progress < c.goal ? 'disabled' : ''}>${c.claimed ? 'Claimed' : 'Claim'}</button>
          </div>
        `
          )
          .join('') || '<p class="muted">No active challenges.</p>'
      }
    </div>
  `;
  app.innerHTML = `
    ${renderTopbar('Challenges')}

    ${renderTier('Hourly Challenges', 'hourly')}
    ${renderTier('Daily Challenges', 'daily')}
    ${renderTier('Weekly Challenges', 'weekly')}

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
  `;
  bindShellNav();

  app.querySelectorAll('[data-claim]').forEach((btn) => {
    btn.onclick = () => claimChallenge(btn.dataset.claim);
  });
}

function renderNotifications() {
  app.innerHTML = `
    ${renderTopbar('Notifications')}
    <div class="card section">
      ${
        state.notifications.length
          ? state.notifications
              .map(
                (n) => `
            <div class="notif-item">
              <div>${n.message}</div>
              <div class="muted">${new Date(n.createdAt).toLocaleString()}</div>
              ${n.action ? `<button data-notif-action="${n.id}" class="primary">${n.action.label || 'Open'}</button>` : ''}
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
}

function renderHand(hand, index, active) {
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
        <strong>Hand ${index + 1}</strong>
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
  const phaseLabelMap = {
    ROUND_INIT: 'Betting',
    ACTION_TURN: 'Action',
    PRESSURE_RESPONSE: 'Pressure',
    HAND_ADVANCE: 'Advance',
    ROUND_RESOLVE: 'Resolve',
    NEXT_ROUND: 'Next Round'
  };
  const phaseLabel = phaseLabelMap[match.phase] || match.phase;
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

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}

    <div class="match table-layout card section reveal-panel">
      <div class="status-strip">
        <div class="strip-item"><span class="muted">Round</span> <strong>${match.roundNumber}</strong></div>
        <div class="strip-item"><span class="muted">Turn</span> <strong class="${myTurn ? 'your-turn' : ''}">${isBettingPhase ? 'Betting' : myTurn ? 'You' : playerName(match.currentTurn)}</strong></div>
        <div class="strip-item"><span class="muted">Phase</span> <strong>${phaseLabel}</strong></div>
        <div class="strip-item"><span class="muted">Bankroll</span> <strong>${myState.bankroll ?? me.chips} chips</strong></div>
      </div>

      ${
        isBettingPhase
          ? `<div class="match-zone">
              <div class="zone-head">
                <h4>Choose your bet for Round ${match.roundNumber}</h4>
                <span class="muted">${myConfirmed ? 'You confirmed' : 'Waiting for your confirmation'}</span>
              </div>
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
                <div class="row">
                  <button id="confirmBetBtn" class="primary" ${!canConfirmBet ? 'disabled' : ''}>Confirm Bet</button>
                  <div class="muted">${oppConfirmed ? 'Opponent confirmed' : 'Waiting for opponent...'}</div>
                </div>
              </div>
              <div class="muted">Cards are dealt only after both players confirm.</div>
            </div>`
          : ''
      }

      <div class="match-zone opponent-zone" ${isBettingPhase ? 'style="display:none"' : ''}>
        <div class="zone-head">
          <h4>Opponent: ${playerName(oppId)}</h4>
          <span class="muted">${isBotOpponent ? 'Bot practice' : opponentConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div class="hands">
          ${oppState.hands.map((h, idx) => renderHand(h, idx, idx === oppState.activeHandIndex)).join('')}
        </div>
      </div>

      <div class="match-zone you-zone" ${isBettingPhase ? 'style="display:none"' : ''}>
        <div class="zone-head">
          <h4>You: ${playerName(me.id)}</h4>
          <span class="turn ${myTurn ? 'turn-on' : ''}">${myTurn ? 'Your turn' : 'Stand by'}</span>
        </div>
        <div class="hands">
          ${myState.hands.map((h, idx) => renderHand(h, idx, idx === myState.activeHandIndex)).join('')}
        </div>
      </div>

      <div class="actions-panel card section" ${isBettingPhase ? 'style="display:none"' : ''}>
        <div class="bet-control">
          <div class="bet-head">
            <strong>Base Bet</strong>
            <span class="muted">Locked for this round</span>
          </div>
          <div class="muted">Base bet posted: ${match.baseBet} ${match.allInPlayers?.[oppId] ? `• ${playerName(oppId)} is all-in` : ''}</div>
        </div>

        <div class="actions actions-primary">
          <button data-action="hit" title="${canAct ? 'Draw one card' : actionHint}" class="primary" ${!canAct ? 'disabled' : ''}>Hit</button>
          <button data-action="stand" title="${canAct ? 'Lock this hand' : actionHint}" class="ghost" ${!canAct ? 'disabled' : ''}>Stand</button>
        </div>
        <div class="actions actions-secondary">
          <button data-action="double" title="${canAct ? 'Double bet, take one card, lock hand' : actionHint}" ${!canAct || activeHand.doubled ? 'disabled' : ''}>Double</button>
          <button data-action="split" title="${handCanSplit(activeHand) ? 'Split pair into two hands' : 'Split requires pair'}" ${!canAct || !handCanSplit(activeHand) ? 'disabled' : ''}>Split</button>
          <button class="warn" data-action="surrender" title="${canAct ? 'Lose 75% and lock hand' : actionHint}" ${!canAct ? 'disabled' : ''}>Surrender</button>
        </div>
        <div class="muted">${actionHint}</div>
      </div>

      ${
        pressure
          ? `<div class="card section pressure-banner">
            <strong>Pressure Bet Response Required:</strong>
            ${playerName(pressure.initiatorId)} used <strong>${pressure.type}</strong>.
            ${
              waitingPressure
                ? `Match +${pressure.delta} chips or surrender this hand.
                   <div class="row" style="margin-top:0.5rem">
                     <button class="primary" id="pressureMatch">Match Bet</button>
                     <button class="warn" id="pressureSurrender">Surrender Hand</button>
                   </div>`
                : '<div class="muted">Waiting for opponent decision...</div>'
            }
          </div>`
          : ''
      }

      <div class="muted">
        ${
          isBotOpponent
            ? `Opponent is ${playerName(oppId)} (${match.participants?.[oppId]?.difficulty} difficulty).`
            : `Disconnect grace: up to 60 seconds reconnect is allowed. Connected states: You ${
                match.disconnects[me.id]?.connected ? 'online' : 'offline'
              } / Opponent ${opponentConnected ? 'online' : 'offline'}`
        }
      </div>

      ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    </div>
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
    } else if (state.view === 'match') {
      renderMatch();
    } else {
      renderHome();
    }
  }
  applyGlowFollowClasses();
  bindNotificationUI();
  syncToasts();
  if (enteringFriends && state.token) loadFriendsData();
}

(async function init() {
  window.addEventListener('popstate', () => {
    state.view = initialViewFromPath();
    render();
  });
  initCursorSpotlight();
  useHoverGlow();
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
