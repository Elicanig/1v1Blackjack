import { formatHandTotalLine } from './match-view-model.js';
const app = document.getElementById('app');
let spotlightInitialized = false;
let hoverGlowInitialized = false;

function initCursorSpotlight() {
  if (spotlightInitialized) return;
  spotlightInitialized = true;

  const root = document.documentElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = null;
  let px = window.innerWidth / 2;
  let py = window.innerHeight / 2;
  let enabled = !media.matches;

  const apply = () => {
    raf = null;
    if (!enabled) return;
    root.style.setProperty('--mx', `${px}px`);
    root.style.setProperty('--my', `${py}px`);
    root.style.setProperty('--spotlight-alpha', '0.42');
  };

  const onMove = (e) => {
    if (!enabled) return;
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  };

  const onLeave = () => {
    root.style.setProperty('--spotlight-alpha', '0');
  };

  const onEnter = () => {
    if (!enabled) return;
    root.style.setProperty('--spotlight-alpha', '0.42');
  };

  const onPrefChange = () => {
    enabled = !media.matches;
    if (!enabled) {
      root.style.setProperty('--spotlight-alpha', '0');
    }
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('pointerenter', onEnter, { passive: true });
  media.addEventListener('change', onPrefChange);
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

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  document.addEventListener('pointerout', onOut, { passive: true });
  window.addEventListener('pointerleave', onWindowLeave, { passive: true });
  media.addEventListener('change', onPrefChange);
}

function applyGlowFollowClasses() {
  app
    .querySelectorAll('button.primary, button.gold, button.ghost, .bot-segmented button, .nav button:not(.warn)')
    .forEach((el) => el.classList.add('glow-follow'));
}

const state = {
  token: localStorage.getItem('bb_token') || null,
  me: null,
  friends: [],
  challenges: [],
  view: 'home',
  socket: null,
  status: '',
  error: '',
  currentLobby: null,
  currentMatch: null,
  pendingFriendInviteCode: new URLSearchParams(window.location.search).get('friendInvite'),
  pendingLobbyCode: new URLSearchParams(window.location.search).get('joinLobby'),
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

function setError(message = '') {
  state.error = message;
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

function connectSocket() {
  if (!state.token) return;
  if (state.socket) state.socket.disconnect();

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect_error', (e) => setError(e.message));
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
    state.view = 'match';
    render();
  });
  state.socket.on('match:error', ({ error }) => setError(error));
  state.socket.on('match:ended', ({ reason }) => {
    setStatus(reason);
    state.currentMatch = null;
    state.currentLobby = null;
    state.view = 'home';
    loadMe();
  });
}

async function loadMe() {
  if (!state.token) return;
  try {
    const data = await api('/api/me');
    state.me = data.user;
    state.friends = data.friends || [];
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
      await joinLobby(state.pendingLobbyCode);
      state.pendingLobbyCode = null;
      clearQuery();
    }

    render();
  } catch (e) {
    localStorage.removeItem('bb_token');
    state.token = null;
    state.me = null;
    state.friends = [];
    state.challenges = [];
    state.freeClaimed = false;
    state.freeClaimedAt = null;
    render();
  }
}

function clearQuery() {
  history.replaceState({}, '', '/');
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
  const password = form.querySelector('[name="password"]').value;
  if (!username || !password) return setError('Username and password required');
  try {
    const data = await api(`/api/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    state.token = data.token;
    localStorage.setItem('bb_token', data.token);
    setStatus(mode === 'register' ? 'Account created.' : 'Logged in.');
    connectSocket();
    await loadMe();
  } catch (e) {
    setError(e.message);
  }
}

async function saveProfile(form) {
  const avatar = form.querySelector('[name="avatar"]').value.trim();
  const bio = form.querySelector('[name="bio"]').value.trim();
  try {
    const data = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ avatar, bio })
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
    const data = await api('/api/friends/add', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    state.friends = data.friends;
    setStatus('Friend added.');
  } catch (e) {
    setError(e.message);
  }
}

async function createFriendInvite() {
  try {
    const data = await api('/api/friends/invite-link', { method: 'POST' });
    await navigator.clipboard.writeText(data.link);
    setStatus(`Friend invite link copied: ${data.link}`);
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
    state.view = 'lobby';
    setStatus('Private lobby created. Link copied.');
    await navigator.clipboard.writeText(data.link);
    state.socket?.emit('lobby:watch', data.lobby.id);
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function joinLobby(lobbyIdInput) {
  try {
    const data = await api('/api/lobbies/join', {
      method: 'POST',
      body: JSON.stringify({ lobbyId: lobbyIdInput })
    });
    state.currentLobby = data.lobby;
    state.view = data.matchId ? 'match' : 'lobby';
    state.socket?.emit('lobby:watch', data.lobby.id);
    if (!data.matchId) setStatus('Joined lobby. Waiting for match...');
  } catch (e) {
    setError(e.message);
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
    state.view = 'match';
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
  render();
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
            <input name="username" placeholder="Username" autocomplete="username" />
            <input name="password" type="password" placeholder="Password" autocomplete="current-password" />
            <button class="primary" type="submit">Login</button>
          </div>
        </form>
        <form id="registerForm" class="section card">
          <h3>Register</h3>
          <div class="grid">
            <input name="username" placeholder="Unique username" autocomplete="username" />
            <input name="password" type="password" placeholder="Password" autocomplete="new-password" />
            <button class="gold" type="submit">Create Account</button>
          </div>
        </form>
      </div>
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
    <div class="card topbar">
      <div>
        <div class="logo">Blackjack Battle</div>
        <div class="muted">${me.username} • ${me.chips} chips</div>
      </div>
      <div class="nav">
        <button data-go="home" class="${state.view === 'home' ? 'nav-active' : ''}">Home</button>
        <button data-go="profile" class="${state.view === 'profile' ? 'nav-active' : ''}">Profile</button>
        <button data-go="friends" class="${state.view === 'friends' ? 'nav-active' : ''}">Friends</button>
        <button data-go="lobby" class="${state.view === 'lobby' ? 'nav-active' : ''}">Lobbies</button>
        <button data-go="challenges" class="${state.view === 'challenges' ? 'nav-active' : ''}">Challenges</button>
        <button class="warn" id="logoutBtn">Logout</button>
      </div>
    </div>

    <div class="row">
      <div class="col card section reveal-panel glow-follow glow-follow--panel">
        <h2>Play</h2>
        <p class="muted">Host a private 1v1 lobby or jump in using your friend link.</p>
        <div class="row">
          <button class="primary" id="createLobbyBtn">Create Private Lobby</button>
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
    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
  `;

  app.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => {
      state.view = btn.dataset.go;
      render();
    };
  });

  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('createLobbyBtn').onclick = createLobby;
  document.getElementById('quickPlayBtn').onclick = () => {
    state.view = 'friends';
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
  app.innerHTML = `
    <div class="card topbar">
      <div class="logo">Profile</div>
      <div class="nav"><button id="backHome">Back</button></div>
    </div>

    <div class="card section">
      <form id="profileForm" class="grid">
        <div class="row">
          <div class="col">
            <label>Username</label>
            <input value="${me.username}" disabled />
          </div>
          <div class="col">
            <label>Avatar URL</label>
            <input name="avatar" value="${me.avatar || ''}" />
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
      ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
    </div>
  `;

  document.getElementById('backHome').onclick = () => {
    state.view = 'home';
    render();
  };
  document.getElementById('profileForm').onsubmit = (e) => {
    e.preventDefault();
    saveProfile(e.currentTarget);
  };
}

function renderFriends() {
  app.innerHTML = `
    <div class="card topbar">
      <div class="logo">Friends</div>
      <div class="nav"><button id="backHome">Back</button></div>
    </div>

    <div class="row">
      <div class="col card section">
        <h3>Add Friend by Username</h3>
        <form id="friendForm" class="row">
          <input name="friend_username" placeholder="Friend username" />
          <button class="primary" type="submit">Add</button>
        </form>
        <button id="inviteLinkBtn" style="margin-top:0.7rem">Generate Friend Invite Link</button>
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
              <div class="muted">${f.chips} chips</div>
            </div>
            <button data-invite="${f.id}">Invite to Lobby</button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
  `;

  document.getElementById('backHome').onclick = () => {
    state.view = 'home';
    render();
  };

  document.getElementById('friendForm').onsubmit = (e) => {
    e.preventDefault();
    addFriend(e.currentTarget);
  };

  document.getElementById('inviteLinkBtn').onclick = createFriendInvite;
  app.querySelectorAll('[data-invite]').forEach((btn) => {
    btn.onclick = () => createLobby();
  });
}

function renderLobby() {
  const lobby = state.currentLobby;
  app.innerHTML = `
    <div class="card topbar">
      <div class="logo">Lobby</div>
      <div class="nav"><button id="backHome">Back</button></div>
    </div>

    <div class="card section">
      ${
        !lobby
          ? '<p class="muted">No lobby active.</p>'
          : `
        <div class="lobby">
          <div>
            <div><strong>Code:</strong> ${lobby.id}</div>
            <div class="muted">Owner: ${playerName(lobby.ownerId)}</div>
            <div class="muted">Opponent: ${lobby.opponentId ? playerName(lobby.opponentId) : 'Waiting...'}</div>
          </div>
          <button id="copyLobbyCode">Copy Join Code</button>
        </div>
        <p class="muted">Share this lobby code with one friend. Match starts when both players are connected.</p>
      `
      }
    </div>

    <div class="card section" style="margin-top:1rem">
      <h3>Join Existing Lobby</h3>
      <form id="joinLobbyForm" class="row">
        <input name="lobby_id" placeholder="Lobby code" />
        <button class="primary" type="submit">Join</button>
      </form>
    </div>

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
  `;

  document.getElementById('backHome').onclick = () => {
    state.view = 'home';
    render();
  };

  document.getElementById('joinLobbyForm').onsubmit = (e) => {
    e.preventDefault();
    const code = e.currentTarget.querySelector('[name="lobby_id"]').value.trim();
    if (code) joinLobby(code);
  };

  const copyBtn = document.getElementById('copyLobbyCode');
  if (copyBtn && lobby) {
    copyBtn.onclick = async () => {
      const link = `${window.location.origin}/?joinLobby=${lobby.id}`;
      await navigator.clipboard.writeText(link);
      setStatus(`Lobby link copied: ${link}`);
    };
  }
}

function renderChallenges() {
  app.innerHTML = `
    <div class="card topbar">
      <div class="logo">Challenges</div>
      <div class="nav"><button id="backHome">Back</button></div>
    </div>

    <div class="card section">
      ${(state.challenges || [])
        .map(
          (c) => `
        <div class="challenge">
          <div>
            <div><strong>${c.title}</strong></div>
            <div class="muted">${c.progress}/${c.target} • Reward ${c.reward} chips</div>
          </div>
          <button data-claim="${c.id}" ${c.claimed || c.progress < c.target ? 'disabled' : ''}>${
            c.claimed ? 'Claimed' : 'Claim'
          }</button>
        </div>
      `
        )
        .join('')}
    </div>

    ${state.status ? `<p class="muted">${state.status}</p>` : ''}
    ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
  `;

  document.getElementById('backHome').onclick = () => {
    state.view = 'home';
    render();
  };

  app.querySelectorAll('[data-claim]').forEach((btn) => {
    btn.onclick = () => claimChallenge(btn.dataset.claim);
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
    state.view = 'home';
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
    <div class="card topbar">
      <div class="logo">Blackjack Battle</div>
      <div class="nav">
        <button id="backHome">Home</button>
      </div>
    </div>

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
      ${state.error ? `<p class="muted" style="color:#bc3f3f">${state.error}</p>` : ''}
    </div>
  `;

  document.getElementById('backHome').onclick = () => {
    state.view = 'home';
    render();
  };

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
  app.dataset.view = state.view;
  if (!state.token || !state.me) {
    renderAuth();
  } else {
    if (state.view === 'profile') {
      renderProfile();
    } else if (state.view === 'friends') {
      renderFriends();
    } else if (state.view === 'lobby') {
      renderLobby();
    } else if (state.view === 'challenges') {
      renderChallenges();
    } else if (state.view === 'match') {
      renderMatch();
    } else {
      renderHome();
    }
  }
  applyGlowFollowClasses();
}

(async function init() {
  initCursorSpotlight();
  useHoverGlow();
  render();
  if (state.token) {
    connectSocket();
    await loadMe();
    await loadChallenges();
    render();
  }
})();
