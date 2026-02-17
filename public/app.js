import { formatHandTotalLine } from './match-view-model.js';
import { renderSuitIconSvg } from './suit-icons.js';
import {
  OFFLINE_BASE_BET,
  OFFLINE_STARTING_BANKROLL,
  OFFLINE_STORAGE_KEYS,
  applyOfflineRoundStats,
  createOfflineMatch,
  loadOfflineProfile,
  offlineApplyAction,
  offlineConfirmBet,
  offlineRoundChoice,
  offlineSetBaseBet,
  saveOfflineProfile
} from './offline-bot.js';
const app = document.getElementById('app');
let spotlightInitialized = false;
let hoverGlowInitialized = false;
let inviteCountdownTicker = null;
let matchTurnTicker = null;
let challengeCountdownTicker = null;
let quickPlayConnectTimer = null;
let botMatchLaunchTimer = null;
const PERMISSION_ERROR_PATTERNS = [
  /not allowed by the user agent/i,
  /not allowed by the platform/i,
  /permission denied/i,
  /the request is not allowed/i
];
const BOT_BET_RANGES = {
  easy: { min: 1, max: 250 },
  medium: { min: 100, max: 500 },
  normal: { min: 500, max: 2000 }
};
const QUICK_PLAY_BUCKETS = [10, 50, 100, 250, 500, 1000, 2000, 5000];
const HIGH_ROLLER_MIN_BET = 2500;
const HIGH_ROLLER_UNLOCK_CHIPS = 10000;
const HIGH_ROLLER_UNLOCK_MESSAGE = `High Roller unlocks at ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips.`;
const SPLIT_TENS_EVENT_ID = 'split_tens_24h';
const LEADERBOARD_LIMIT = 25;
const RANKED_TIER_META = Object.freeze({
  BRONZE: { label: 'Bronze', icon: '◈', minElo: 0, fixedBet: 50 },
  SILVER: { label: 'Silver', icon: '✦', minElo: 1200, fixedBet: 100 },
  GOLD: { label: 'Gold', icon: '⬢', minElo: 1400, fixedBet: 250 },
  DIAMOND: { label: 'Diamond', icon: '◆', minElo: 1600, fixedBet: 500 },
  LEGENDARY: { label: 'Legendary', icon: '♛', minElo: 1850, fixedBet: 1000 }
});
const RANKED_TIER_ORDER = ['LEGENDARY', 'DIAMOND', 'GOLD', 'SILVER', 'BRONZE'];
const TITLE_DEFS = Object.freeze([
  { key: '', label: 'None', unlockHint: 'No title equipped', category: 'utility' },
  { key: 'HIGH_ROLLER', label: 'High Roller', unlockHint: 'Play 10 high roller matches.', category: 'skill' },
  { key: 'GIANT_KILLER', label: 'Giant Killer', unlockHint: 'Beat a higher-level or richer opponent.', category: 'skill' },
  { key: 'STREAK_LORD', label: 'Streak Lord', unlockHint: 'Reach a 10-match win streak.', category: 'skill' },
  { key: 'RISING_STAR', label: 'Rising Star', unlockHint: 'Reach level 10.', category: 'level' },
  { key: 'TABLE_REGULAR', label: 'Table Regular', unlockHint: 'Reach level 25.', category: 'level' },
  { key: 'VETERAN', label: 'Veteran', unlockHint: 'Reach level 50.', category: 'level' },
  { key: 'ELITE_GRINDER', label: 'Elite Grinder', unlockHint: 'Reach level 75.', category: 'level' },
  { key: 'LEGEND', label: 'Legend', unlockHint: 'Reach level 100.', category: 'level' },
  { key: 'BLACKJACK_MAGNET', label: 'Blackjack Magnet', unlockHint: 'Deal 25 natural blackjacks.', category: 'skill' },
  { key: 'NATURAL_BORN', label: 'Natural Born', unlockHint: 'Deal 75 natural blackjacks.', category: 'skill' },
  { key: 'SPLIT_SPECIALIST', label: 'Split Specialist', unlockHint: 'Use Split 25 times.', category: 'skill' },
  { key: 'DOUBLE_TROUBLE', label: 'Double Trouble', unlockHint: 'Use Double 25 times.', category: 'skill' },
  { key: 'PUSH_MASTER', label: 'Push Master', unlockHint: 'Record 40 pushes.', category: 'skill' },
  { key: 'ROAD_WARRIOR', label: 'Road Warrior', unlockHint: 'Complete 100 matches.', category: 'skill' },
  { key: 'TABLE_SHARK', label: 'Table Shark', unlockHint: 'Win 150 hands.', category: 'skill' },
  { key: 'CHIP_COLLECTOR', label: 'Chip Collector', unlockHint: 'Win 5,000 chips total.', category: 'skill' },
  { key: 'CHIP_TITAN', label: 'Chip Titan', unlockHint: 'Win 20,000 chips total.', category: 'skill' },
  { key: 'RANKED_CONTENDER', label: 'Ranked Contender', unlockHint: 'Win 10 ranked series.', category: 'skill' },
  { key: 'RANKED_CONQUEROR', label: 'Ranked Conqueror', unlockHint: 'Win 30 ranked series.', category: 'skill' },
  { key: 'PVP_DUELIST', label: 'PvP Duelist', unlockHint: 'Win 25 PvP matches.', category: 'skill' },
  { key: 'SEVEN_SENSE', label: 'Seven Sense', unlockHint: "Get 20 starting 6-7's.", category: 'skill' },
  { key: 'DAILY_GRINDER', label: 'Daily Grinder', unlockHint: 'Reach a 7-day daily win streak.', category: 'skill' },
  { key: 'UNBREAKABLE', label: 'Unbreakable', unlockHint: 'Reach a 15-match win streak.', category: 'skill' },
  { key: 'ACE_ENGINEER', label: 'Ace Engineer', unlockHint: 'Use Double 75 times.', category: 'skill' },
  { key: 'TABLE_ARCHITECT', label: 'Table Architect', unlockHint: 'Use Split 75 times.', category: 'skill' },
  { key: 'IRON_BANKROLL', label: 'Iron Bankroll', unlockHint: 'Win 50,000 chips total.', category: 'skill' },
  { key: 'SERIES_GENERAL', label: 'Series General', unlockHint: 'Win 60 ranked series.', category: 'skill' },
  { key: 'HEADHUNTER', label: 'Headhunter', unlockHint: 'Win 80 PvP matches.', category: 'skill' },
  { key: 'WINDFALL', label: 'Windfall', unlockHint: 'Win 300 hands.', category: 'skill' },
  { key: 'TABLE_ANCHOR', label: 'Table Anchor', unlockHint: 'Complete 250 matches.', category: 'skill' },
  { key: 'IMMORTAL_STREAK', label: 'Immortal Streak', unlockHint: 'Reach a 20-match win streak.', category: 'skill' }
]);
const TITLE_DEF_MAP = new Map(TITLE_DEFS.filter((entry) => entry.key).map((entry) => [entry.key, entry]));
const DECK_SKIN_DEFS = Object.freeze([
  { id: 'CLASSIC', name: 'Classic Felt', description: 'Traditional white cards and emerald backs.', minLevelRequired: 1, token: 'classic', unlockHint: 'Available by default.' },
  { id: 'GOLD', name: 'Gold Reserve', description: 'Warm ivory cards with gilded trim.', minLevelRequired: 10, token: 'gold', unlockHint: 'Reach level 10.' },
  { id: 'NEON', name: 'Neon Pulse', description: 'Cyber-glow accents with crisp contrast.', minLevelRequired: 20, token: 'neon', unlockHint: 'Reach level 20.' },
  { id: 'OBSIDIAN', name: 'Obsidian Luxe', description: 'Dark premium face with metallic highlights.', minLevelRequired: 35, token: 'obsidian', unlockHint: 'Reach level 35.' },
  { id: 'AURORA', name: 'Aurora Royale', description: 'Prismatic finish with subtle shimmer.', minLevelRequired: 50, token: 'aurora', unlockHint: 'Reach level 50.' },
  { id: 'OBSIDIAN_LUXE_II', name: 'Obsidian Luxe II', description: 'Deep black stone, gold inlays, and a low ember glow.', minLevelRequired: 1, token: 'obsidian-luxe-ii', unlockHint: 'Reach a 25-match win streak.' },
  { id: 'AURORA_ROYALE_II', name: 'Aurora Royale II', description: 'Animated aurora gradient with polished royal trim.', minLevelRequired: 1, token: 'aurora-royale-ii', unlockHint: 'Reach 1900 ranked Elo.' },
  { id: 'VOID_PRISM', name: 'Void Prism', description: 'Dark glass finish with shifting spectral highlights.', minLevelRequired: 1, token: 'void-prism', unlockHint: 'Win 120 ranked series.' },
  { id: 'CELESTIAL_IVORY', name: 'Celestial Ivory', description: 'Pearl ivory marble with star-gold filigree.', minLevelRequired: 1, token: 'celestial-ivory', unlockHint: 'Deal 300 natural blackjacks.' }
]);
const DECK_SKIN_MAP = new Map(DECK_SKIN_DEFS.map((entry) => [entry.id, entry]));
const PROFILE_BORDER_DEFS = Object.freeze([
  { id: 'NONE', name: 'None', minLevelRequired: 1, tier: 'Default', previewToken: 'none' },
  { id: 'BRONZE_TRIM', name: 'Bronze Trim', minLevelRequired: 10, tier: 'Common', previewToken: 'bronze-trim' },
  { id: 'GILDED_EDGE', name: 'Gilded Edge', minLevelRequired: 20, tier: 'Uncommon', previewToken: 'gilded-edge' },
  { id: 'EMERALD_CIRCUIT', name: 'Emerald Circuit', minLevelRequired: 30, tier: 'Rare', previewToken: 'emerald-circuit' },
  { id: 'NEBULA_FRAME', name: 'Nebula Frame', minLevelRequired: 40, tier: 'Epic', previewToken: 'nebula-frame' },
  { id: 'MYTHIC_CREST', name: 'Mythic Crest', minLevelRequired: 50, tier: 'Mythic', previewToken: 'mythic-crest' },
  { id: 'ROYAL_AURORA', name: 'Royal Aurora', minLevelRequired: 60, tier: 'Mythic', previewToken: 'royal-aurora' },
  { id: 'OBSIDIAN_CROWN', name: 'Obsidian Crown', minLevelRequired: 70, tier: 'Legendary', previewToken: 'obsidian-crown' },
  { id: 'SOLAR_FLARE', name: 'Solar Flare', minLevelRequired: 80, tier: 'Legendary', previewToken: 'solar-flare' },
  { id: 'CELESTIAL_LATTICE', name: 'Celestial Lattice', minLevelRequired: 90, tier: 'Ascendant', previewToken: 'celestial-lattice' },
  { id: 'ETERNAL_SOVEREIGN', name: 'Eternal Sovereign', minLevelRequired: 100, tier: 'Ascendant', previewToken: 'eternal-sovereign' }
]);
const PROFILE_BORDER_DEF_MAP = new Map(PROFILE_BORDER_DEFS.map((entry) => [entry.id, entry]));
const CORE_FAVORITE_STAT_KEYS = new Set([
  'TOTAL_MATCHES',
  'HANDS_WON',
  'HANDS_LOST',
  'PUSHES',
  'BLACKJACKS',
  'SIX_SEVEN_DEALT'
]);
const FAVORITE_STAT_DEFS = Object.freeze([
  {
    key: 'TOTAL_MATCHES',
    label: 'Total Matches',
    description: 'All completed matches across modes.',
    read: (me) => Number(me?.stats?.matchesPlayed) || 0
  },
  {
    key: 'HANDS_WON',
    label: 'Hands Won',
    description: 'Total blackjack hands won.',
    read: (me) => Number(me?.stats?.handsWon) || 0
  },
  {
    key: 'HANDS_LOST',
    label: 'Hands Lost',
    description: 'Total blackjack hands lost.',
    read: (me) => Number(me?.stats?.handsLost) || 0
  },
  {
    key: 'PUSHES',
    label: 'Pushes',
    description: 'Hands ending in a tie.',
    read: (me) => Number(me?.stats?.pushes) || 0
  },
  {
    key: 'BLACKJACKS',
    label: 'Blackjacks',
    description: 'Natural 21 count.',
    read: (me) => Number(me?.stats?.blackjacks) || 0
  },
  {
    key: 'SIX_SEVEN_DEALT',
    label: "6-7's Dealt",
    description: 'Initial two cards are 6 and 7 (any order).',
    read: (me) => Number(me?.stats?.sixSevenDealt) || 0
  },
  {
    key: 'SPLITS_ATTEMPTED',
    label: 'Splits Attempted',
    description: 'Times you split a pair.',
    read: (_me, expanded) => Number(expanded?.splitsAttempted) || 0
  },
  {
    key: 'DOUBLES_ATTEMPTED',
    label: 'Doubles Attempted',
    description: 'Times you doubled down.',
    read: (_me, expanded) => Number(expanded?.doublesAttempted) || 0
  },
  {
    key: 'SURRENDERS',
    label: 'Surrenders',
    description: 'Hands surrendered.',
    read: (_me, expanded) => Number(expanded?.surrenders) || 0
  },
  {
    key: 'BUSTS',
    label: 'Busts',
    description: 'Hands busted over 21.',
    read: (_me, expanded) => Number(expanded?.busts) || 0
  },
  {
    key: 'LONGEST_WIN_STREAK',
    label: 'Longest Win Streak',
    description: 'Best hand streak without losing.',
    read: (_me, expanded) => Number(expanded?.longestWinStreak) || 0
  },
  {
    key: 'LONGEST_LOSS_STREAK',
    label: 'Longest Loss Streak',
    description: 'Longest rough streak.',
    read: (_me, expanded) => Number(expanded?.longestLossStreak) || 0
  },
  {
    key: 'RANKED_ELO',
    label: 'Ranked Elo',
    description: 'Current ranked rating.',
    read: (me) => Number(me?.rankedElo) || 0
  },
  {
    key: 'RANKED_WINS',
    label: 'Ranked Wins',
    description: 'Total ranked game wins.',
    read: (me) => Number(me?.rankedWins) || 0
  },
  {
    key: 'RANKED_LOSSES',
    label: 'Ranked Losses',
    description: 'Total ranked game losses.',
    read: (me) => Number(me?.rankedLosses) || 0
  },
  {
    key: 'PVP_WINS',
    label: 'PvP Wins',
    description: 'Head-to-head match wins.',
    read: (me) => Number(me?.pvpWins) || 0
  },
  {
    key: 'PVP_LOSSES',
    label: 'PvP Losses',
    description: 'Head-to-head match losses.',
    read: (me) => Number(me?.pvpLosses) || 0
  },
  {
    key: 'NET_CHIPS',
    label: 'Net Chips',
    description: 'Real-chip wins minus losses.',
    read: (_me, expanded) => Number(expanded?.netChips) || 0,
    format: (value) => `${value >= 0 ? '+' : ''}${Math.floor(value).toLocaleString()}`
  },
  {
    key: 'TOTAL_CHIPS_WON',
    label: 'Total Chips Won',
    description: 'Real chips won across tracked hands.',
    read: (_me, expanded) => Number(expanded?.totalChipsWon) || 0
  },
  {
    key: 'TOTAL_CHIPS_LOST',
    label: 'Total Chips Lost',
    description: 'Real chips lost across tracked hands.',
    read: (_me, expanded) => Number(expanded?.totalChipsLost) || 0
  },
  {
    key: 'BIGGEST_HAND_WIN',
    label: 'Biggest Hand Win',
    description: 'Largest single-hand chip gain.',
    read: (_me, expanded) => Number(expanded?.biggestHandWin) || 0
  },
  {
    key: 'BIGGEST_HAND_LOSS',
    label: 'Biggest Hand Loss',
    description: 'Largest single-hand chip drop.',
    read: (_me, expanded) => Number(expanded?.biggestHandLoss) || 0
  },
  {
    key: 'AVERAGE_BET',
    label: 'Average Bet',
    description: 'Average real-chip bet size.',
    read: (_me, expanded) => Number(expanded?.averageBet) || 0,
    format: (value) => value.toFixed(1)
  },
  {
    key: 'BOT_PRACTICE_HANDS',
    label: 'Bot Hands (Practice)',
    description: 'Hands played versus bot in practice mode.',
    read: (_me, expanded) => Number(expanded?.handsPlayedBotPractice) || 0
  },
  {
    key: 'BOT_REAL_HANDS',
    label: 'Bot Hands (Real)',
    description: 'Hands played versus bot for real chips.',
    read: (_me, expanded) => Number(expanded?.handsPlayedBotReal) || 0
  },
  {
    key: 'PVP_REAL_HANDS',
    label: 'PvP Hands (Real)',
    description: 'Hands played in real-chip PvP.',
    read: (_me, expanded) => Number(expanded?.handsPlayedPvpReal) || 0
  },
  {
    key: 'PVP_FRIENDLY_HANDS',
    label: 'PvP Hands (Friendly)',
    description: 'Hands played in friendly PvP.',
    read: (_me, expanded) => Number(expanded?.handsPlayedPvpFriendly) || 0
  },
  {
    key: 'DAILY_STREAK',
    label: 'Daily Win Streak',
    description: 'Current consecutive daily wins.',
    read: (me) => Number(me?.dailyWinStreakCount) || 0,
    format: (value) => `${Math.floor(value)} day${Math.floor(value) === 1 ? '' : 's'}`
  }
]);

function initialViewFromPath() {
  const pathname = window.location.pathname.toLowerCase();
  if (pathname === '/profile') return 'profile';
  if (pathname === '/friends') return 'friends';
  if (pathname === '/lobbies' || pathname === '/lobby') return 'lobbies';
  if (pathname === '/ranked') return 'ranked';
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
  let activeEl = null;
  let activeRect = null;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let lastTs = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const smoothstep = (t) => t * t * (3 - 2 * t);

  const paint = (el, x, y) => {
    if (!el || !activeRect) return;
    const w = Math.max(1, activeRect.width);
    const h = Math.max(1, activeRect.height);
    const nx = w > 0 ? x / w : 0.5;
    const ny = h > 0 ? y / h : 0.5;
    const edgeX = Math.min(nx, 1 - nx);
    const edgeY = Math.min(ny, 1 - ny);
    const edge = Math.min(edgeX, edgeY);
    const edgeLinear = Math.max(0, Math.min(1, edge * 2));
    const edgeFactor = smoothstep(edgeLinear);
    el.style.setProperty('--hx', `${x}px`);
    el.style.setProperty('--hy', `${y}px`);
    el.style.setProperty('--nx', String(nx));
    el.style.setProperty('--ny', String(ny));
    el.style.setProperty('--edge', String(edgeFactor));
  };

  const refreshRect = () => {
    if (!activeEl) return;
    activeRect = activeEl.getBoundingClientRect();
  };

  const queueFrame = () => {
    if (raf || reduced || !activeEl) return;
    raf = requestAnimationFrame((ts) => {
      raf = null;
      if (reduced || !activeEl) return;
      if (!activeEl.isConnected) {
        activeEl = null;
        activeRect = null;
        lastTs = 0;
        return;
      }
      if (!activeRect) refreshRect();
      if (!activeRect) return;
      const dt = lastTs ? Math.min(34, Math.max(8, ts - lastTs)) : 16;
      lastTs = ts;
      const lerpFactor = 1 - Math.exp(-dt / 68);
      cx += (tx - cx) * lerpFactor;
      cy += (ty - cy) * lerpFactor;
      paint(activeEl, cx, cy);
      if (Math.abs(tx - cx) > 0.35 || Math.abs(ty - cy) > 0.35) {
        queueFrame();
      }
    });
  };

  const updateTargetPoint = (clientX, clientY, { snap = false } = {}) => {
    if (!activeRect) refreshRect();
    if (!activeRect) return;
    tx = clamp(clientX - activeRect.left, 0, Math.max(1, activeRect.width));
    ty = clamp(clientY - activeRect.top, 0, Math.max(1, activeRect.height));
    if (snap) {
      cx = tx;
      cy = ty;
      paint(activeEl, cx, cy);
    }
    queueFrame();
  };

  const setActiveElement = (el, event) => {
    if (!el || reduced) return;
    const switched = activeEl !== el;
    if (switched && activeEl) activeEl.classList.remove('is-hovering');
    activeEl = el;
    activeRect = null;
    if (activeEl && !activeEl.classList.contains('is-hovering')) {
      activeEl.classList.add('is-hovering');
    }
    updateTargetPoint(event.clientX, event.clientY, { snap: switched });
  };

  const clearActiveElement = (target = activeEl) => {
    if (target) target.classList.remove('is-hovering');
    if (!activeEl || target === activeEl) {
      activeEl = null;
      activeRect = null;
      lastTs = 0;
    }
  };

  const onMove = (e) => {
    if (reduced) return;
    const el = e.target.closest?.('.glow-follow');
    if (!el) return;
    setActiveElement(el, e);
  };

  const onOver = (e) => {
    if (reduced) return;
    const el = e.target.closest?.('.glow-follow');
    if (!el) return;
    setActiveElement(el, e);
  };

  const onOut = (e) => {
    const el = e.target.closest?.('.glow-follow');
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    if (el === activeEl) clearActiveElement(el);
  };

  const onWindowLeave = () => {
    document.querySelectorAll('.glow-follow.is-hovering').forEach((el) => clearActiveElement(el));
  };

  const onPrefChange = () => {
    reduced = media.matches;
    if (reduced) {
      onWindowLeave();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }
  };

  app.addEventListener('pointermove', onMove, { passive: true });
  app.addEventListener('pointerover', onOver, { passive: true });
  app.addEventListener('pointerout', onOut, { passive: true });
  app.addEventListener('pointerleave', onWindowLeave, { passive: true });
  window.addEventListener('resize', () => {
    if (!activeEl) return;
    refreshRect();
    paint(activeEl, cx, cy);
  }, { passive: true });
  window.addEventListener('scroll', () => {
    if (!activeEl) return;
    refreshRect();
    paint(activeEl, cx, cy);
  }, { passive: true });
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onPrefChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(onPrefChange);
  }
}

function initTwinkleLayer() {
  const bg = document.querySelector('.bg');
  if (!bg) return;
  if (bg.querySelector('.twinkle-layer')) return;
  const layer = document.createElement('div');
  layer.className = 'twinkle-layer';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    const count = 44;
    for (let i = 0; i < count; i += 1) {
      const star = document.createElement('span');
      star.className = 'twinkle-dot';
      star.style.setProperty('--tx', `${Math.random() * 100}%`);
      star.style.setProperty('--ty', `${Math.random() * 100}%`);
      star.style.setProperty('--delay', `${(Math.random() * 4).toFixed(2)}s`);
      star.style.setProperty('--dur', `${(3.2 + Math.random() * 3.1).toFixed(2)}s`);
      star.style.setProperty('--size', `${(1.2 + Math.random() * 2.8).toFixed(2)}px`);
      layer.appendChild(star);
    }
  }
  bg.appendChild(layer);
}

function applyGlowFollowClasses() {
  if (state.view === 'match' && state.currentMatch?.phase === 'ROUND_INIT') {
    app
      .querySelectorAll('.betting-header, .bet-control, .bet-confirm-actions button')
      .forEach((el) => el.classList.add('glow-follow'));
    return;
  }
  app
    .querySelectorAll('button.primary, button.gold, button.ghost, .pvp-cta, .tabs .nav-pill, .nav button:not(.warn), .kpi, .leaderboard-row, .friend, .title-row')
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
  presenceByUser: {},
  notificationFriendRequestStatus: {},
  toasts: [],
  challenges: { hourly: [], daily: [], weekly: [], skill: [] },
  challengeClaimPendingById: {},
  challengeMeta: { skillPoolSize: 0, activeSkillCount: 0 },
  serverClockOffsetMs: 0,
  activeEvents: [],
  eventDetailsModalId: null,
  challengeResets: { hourly: null, daily: null, weekly: null, skill: null },
  challengeResetRemainingMs: { hourly: 0, daily: 0, weekly: 0, skill: 0 },
  challengeResetRefreshInFlight: false,
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
  statsMoreOpen: false,
  friendInvite: null,
  friendInviteRemainingMs: 0,
  lastRoundResultKey: '',
  roundResultBanner: null,
  bankrollDisplay: null,
  bankrollTweenRaf: null,
  currentBet: 5,
  betInputDraft: '',
  matchChatDraft: '',
  selectedBotDifficulty: 'normal',
  botStakeType: 'FAKE',
  botMatchLaunch: {
    pending: false,
    showBusy: false,
    mode: ''
  },
  emotePickerOpen: false,
  floatingEmote: null,
  inviteModeModalFriend: null,
  challengeModalFriend: null,
  challengeBet: 25,
  challengeMessage: '',
  showMatchDetails: false,
  leaveMatchModal: false,
  confirmActionModal: null,
  emoteCooldownUntil: 0,
  pendingNavAfterLeave: null,
  cardAnimState: {
    enterUntilById: {},
    revealUntilById: {},
    shiftUntilById: {},
    tiltById: {}
  },
  pressureGlow: {
    key: '',
    expiresAt: 0,
    seen: true
  },
  quickPlay: {
    status: 'idle',
    bucket: null,
    selectedBucket: 250,
    bucketPickerOpen: false,
    queuePosition: null,
    queuedAt: null,
    opponentName: '',
    matchId: null,
    pendingMatch: null
  },
  rankedQueue: {
    status: 'idle',
    searching: false,
    queuedAt: null,
    bet: 100,
    pendingMatch: null,
    opponentName: '',
    connected: false
  },
  rankedOverview: null,
  homeSections: {
    highRoller: false,
    practice: false
  },
  leaderboardExpanded: false,
  betHistoryModalOpen: false,
  favoriteStatModalOpen: false,
  favoriteStatDraftKey: '',
  favoriteStatFilter: '',
  titleInfoModalKey: '',
  profileSections: {
    identity: true,
    progress: true,
    borders: false,
    social: true,
    titles: false,
    security: false
  },
  profileTitlePickerOpen: false,
  profileTitleDraftKey: '',
  profileTitleModalOriginKey: '',
  profileTitleSearch: '',
  profileTitleOwnershipFilter: 'ALL',
  profileTitleCategoryFilter: 'ALL',
  profileSaving: false,
  profileBorderSavingId: '',
  rankTimelineModalOpen: false,
  rankedForfeitModalOpen: false,
  pendingSeriesResult: null,
  rankedSeriesResultModal: null,
  rankedSeriesResultAnimKey: '',
  rankedSeriesResultAnimRaf: null,
  xpUi: {
    progress: 0,
    targetProgress: 0,
    level: 1,
    pulseUntil: 0,
    animRaf: null
  },
  network: {
    offlineMode: !navigator.onLine,
    lastCheckedAt: 0,
    checking: false
  },
  offlineProfile: loadOfflineProfile(),
  challengePopup: null,
  leaderboard: {
    rows: [],
    currentUserRank: null,
    totalUsers: 0,
    loading: false
  },
  turnTimerFreezeKey: '',
  turnTimerFreezeRemainingMs: null,
  roundResultChoicePending: false
};

let freeClaimTicker = null;
let offlineHeartbeatTimer = null;

function offlineModeEnabled() {
  return Boolean(state.network.offlineMode);
}

function isOfflineMatchActive() {
  return Boolean(state.currentMatch?.matchType === 'OFFLINE_BOT');
}

function persistOfflineProfile() {
  saveOfflineProfile(state.offlineProfile);
}

function updateOfflineProfileFromMatch() {
  if (!isOfflineMatchActive() || !state.me?.id) return;
  const meState = state.currentMatch.players?.[state.me.id];
  if (!meState) return;
  state.offlineProfile.bankroll = Math.max(0, Math.floor(Number(meState.bankroll) || 0));
  persistOfflineProfile();
}

function ensureOfflineIdentity() {
  if (state.me) return;
  const fallbackName = state.offlineProfile?.name || 'Offline Player';
  state.me = {
    id: 'offline:guest',
    username: fallbackName,
    avatarStyle: 'adventurer',
    avatarSeed: fallbackName,
    avatar: '',
    bio: 'Offline bot player',
    chips: Math.max(0, Math.floor(Number(state.offlineProfile?.bankroll) || OFFLINE_STARTING_BANKROLL)),
    bankroll: Math.max(0, Math.floor(Number(state.offlineProfile?.bankroll) || OFFLINE_STARTING_BANKROLL)),
    stats: {},
    betHistory: [],
    selectedBet: OFFLINE_BASE_BET,
    xp: 0,
    level: 1,
    levelProgress: 0,
    xpToNextLevel: 100,
    rankTier: 'Bronze',
    rankTierKey: 'BRONZE',
    rankedElo: 1000,
    rankedWins: 0,
    rankedLosses: 0,
    unlockedTitles: [],
    selectedTitle: '',
    selectedTitleKey: '',
    titleCatalog: [],
    selectedBorderId: 'NONE',
    selectedDeckSkin: 'CLASSIC',
    profileBorders: [],
    nextBorderUnlockLevel: 10,
    customStatText: '',
    favoriteStatKey: 'TOTAL_MATCHES',
    pvpWins: 0,
    pvpLosses: 0,
    dailyWinStreakCount: 0
  };
  setXpUiSnapshot(state.me.level, state.me.levelProgress);
}

function syncXpBars() {
  const progressPct = Math.max(0, Math.min(100, Math.round((Number(state.xpUi.progress) || 0) * 100)));
  app.querySelectorAll('[data-xp-fill]').forEach((node) => {
    node.style.width = `${progressPct}%`;
  });
  app.querySelectorAll('[data-xp-level]').forEach((node) => {
    node.textContent = `Level ${Math.max(1, Math.floor(Number(state.xpUi.level) || 1))}`;
  });
}

function setXpUiSnapshot(level, progress, { pulse = false } = {}) {
  state.xpUi.level = Math.max(1, Math.floor(Number(level) || 1));
  state.xpUi.progress = Math.max(0, Math.min(1, Number(progress) || 0));
  state.xpUi.targetProgress = state.xpUi.progress;
  if (pulse) state.xpUi.pulseUntil = Date.now() + 1400;
}

function animateXpProgressTo(targetProgress) {
  const target = Math.max(0, Math.min(1, Number(targetProgress) || 0));
  const start = Math.max(0, Math.min(1, Number(state.xpUi.progress) || 0));
  state.xpUi.targetProgress = target;
  if (Math.abs(target - start) < 0.003) {
    state.xpUi.progress = target;
    syncXpBars();
    return;
  }
  if (Number.isFinite(state.xpUi.animRaf)) {
    cancelAnimationFrame(state.xpUi.animRaf);
    state.xpUi.animRaf = null;
  }
  const durationMs = 860;
  const startedAt = performance.now();
  const step = (now) => {
    const elapsed = Math.max(0, now - startedAt);
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    state.xpUi.progress = start + ((target - start) * eased);
    syncXpBars();
    if (t < 1) {
      state.xpUi.animRaf = requestAnimationFrame(step);
    } else {
      state.xpUi.progress = target;
      syncXpBars();
      state.xpUi.animRaf = null;
    }
  };
  state.xpUi.animRaf = requestAnimationFrame(step);
}

function syncXpUiFromUser(nextUser, previousUser = null) {
  const nextLevel = Math.max(1, Math.floor(Number(nextUser?.level) || 1));
  const nextProgress = Math.max(0, Math.min(1, Number(nextUser?.levelProgress) || 0));
  if (!previousUser) {
    setXpUiSnapshot(nextLevel, nextProgress);
    return;
  }
  const prevLevel = Math.max(1, Math.floor(Number(previousUser?.level) || 1));
  const prevProgress = Math.max(0, Math.min(1, Number(previousUser?.levelProgress) || 0));
  if (nextLevel > prevLevel) {
    setXpUiSnapshot(nextLevel, nextProgress, { pulse: true });
    return;
  }
  setXpUiSnapshot(nextLevel, prevProgress, { pulse: nextProgress > prevProgress });
  animateXpProgressTo(nextProgress);
}

async function checkServerReachable() {
  if (!navigator.onLine) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch('/health', { method: 'GET', signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

async function refreshOfflineMode({ silent = false } = {}) {
  if (state.network.checking) return;
  state.network.checking = true;
  const reachable = await checkServerReachable();
  const nextOffline = !reachable;
  const changed = nextOffline !== state.network.offlineMode;
  state.network.offlineMode = nextOffline;
  state.network.lastCheckedAt = Date.now();
  state.network.checking = false;
  if (changed && !silent) {
    if (nextOffline) pushToast('Offline Mode: bot matches only.');
    else {
      pushToast('Connection restored.');
      if (state.token && !state.socket) {
        loadMe().then(() => {
          if (state.token && !offlineModeEnabled()) connectSocket();
        }).catch(() => {});
      }
    }
    render();
  }
}

function startOfflineBotMatch() {
  ensureOfflineIdentity();
  state.offlineProfile.name = state.me.username || state.offlineProfile.name || 'Offline Player';
  const bankroll = Math.max(0, Math.floor(Number(state.offlineProfile?.bankroll) || OFFLINE_STARTING_BANKROLL));
  const startingBet = Math.max(5, Math.min(bankroll || 5, Math.floor(Number(state.currentBet) || OFFLINE_BASE_BET)));
  const match = createOfflineMatch({
    playerId: state.me.id,
    playerName: state.me.username,
    bankroll,
    difficulty: state.selectedBotDifficulty || 'normal',
    baseBet: startingBet
  });
  state.currentMatch = match;
  state.currentBet = startingBet;
  state.roundResultBanner = null;
  state.roundResultChoicePending = false;
  persistOfflineProfile();
  goToView('match');
  setStatus('Offline bot match started.');
  render();
}

function applyOfflineBetSelection(amount) {
  if (!isOfflineMatchActive()) return { error: 'Offline match not active' };
  const result = offlineSetBaseBet(state.currentMatch, amount);
  if (!result.error) {
    state.currentBet = result.selected;
    updateOfflineProfileFromMatch();
  }
  return result;
}

function applyOfflineMatchAction(action) {
  if (!isOfflineMatchActive()) return { error: 'Offline match not active' };
  const result = offlineApplyAction(state.currentMatch, action);
  if (result?.roundResult) {
    state.roundResultBanner = result.roundResult;
    state.offlineProfile.stats = applyOfflineRoundStats(state.offlineProfile.stats, result.roundResult);
  }
  updateOfflineProfileFromMatch();
  return result;
}

function confirmOfflineBet() {
  if (!isOfflineMatchActive()) return { error: 'Offline match not active' };
  const result = offlineConfirmBet(state.currentMatch);
  if (result.error) return result;
  updateOfflineProfileFromMatch();
  return result;
}

function chooseOfflineRoundResult(choice) {
  if (!isOfflineMatchActive()) return { error: 'Offline match not active' };
  const result = offlineRoundChoice(state.currentMatch, choice);
  if (result.error) return result;
  if (result?.roundResult) {
    state.offlineProfile.stats = applyOfflineRoundStats(state.offlineProfile.stats, result.roundResult);
  }
  state.roundResultBanner = null;
  updateOfflineProfileFromMatch();
  return result;
}

function cancelBankrollTween() {
  if (state.bankrollTweenRaf) {
    cancelAnimationFrame(state.bankrollTweenRaf);
    state.bankrollTweenRaf = null;
  }
}

function tweenBankroll(from, to, duration = 800) {
  cancelBankrollTween();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    state.bankrollDisplay = to;
    return;
  }
  const start = performance.now();
  const delta = to - from;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    state.bankrollDisplay = Math.round(from + delta * easeOut(t));
    render();
    if (t < 1) {
      state.bankrollTweenRaf = requestAnimationFrame(tick);
    } else {
      state.bankrollTweenRaf = null;
      state.bankrollDisplay = to;
    }
  };
  state.bankrollTweenRaf = requestAnimationFrame(tick);
}

function updateFreeClaimCountdown() {
  const next = state.freeClaimNextAt ? new Date(state.freeClaimNextAt).getTime() : 0;
  state.freeClaimRemainingMs = next ? Math.max(0, next - Date.now()) : 0;
  if (state.freeClaimRemainingMs <= 0) {
    state.freeClaimed = false;
  }
}

function serverNowMs() {
  return Date.now() + Math.floor(Number(state.serverClockOffsetMs) || 0);
}

function applyServerClock(serverNow) {
  const nowMs = serverNow ? new Date(serverNow).getTime() : NaN;
  if (!Number.isFinite(nowMs)) return;
  state.serverClockOffsetMs = nowMs - Date.now();
}

function normalizeActiveEvents(events = []) {
  if (!Array.isArray(events)) return [];
  const nowMs = serverNowMs();
  return events
    .map((event) => {
      const endsMs = event?.endsAt ? new Date(event.endsAt).getTime() : NaN;
      if (!Number.isFinite(endsMs) || endsMs <= nowMs) return null;
      return {
        id: String(event.id || ''),
        title: String(event.title || ''),
        description: String(event.description || ''),
        startsAt: event.startsAt || null,
        endsAt: event.endsAt || null,
        remainingMs: Math.max(0, endsMs - nowMs)
      };
    })
    .filter(Boolean);
}

function applyEventsSnapshot(serverNow, activeEvents = []) {
  applyServerClock(serverNow);
  state.activeEvents = normalizeActiveEvents(activeEvents);
  if (state.eventDetailsModalId && !state.activeEvents.some((event) => event.id === state.eventDetailsModalId)) {
    state.eventDetailsModalId = null;
  }
}

function splitTensEventState() {
  const event = (state.activeEvents || []).find((item) => item.id === SPLIT_TENS_EVENT_ID);
  if (!event) return { active: false, remainingMs: 0, event: null };
  const endsMs = event.endsAt ? new Date(event.endsAt).getTime() : NaN;
  if (!Number.isFinite(endsMs)) return { active: false, remainingMs: 0, event: null };
  const remainingMs = Math.max(0, endsMs - serverNowMs());
  if (remainingMs <= 0) return { active: false, remainingMs: 0, event: null };
  return { active: true, remainingMs, event: { ...event, remainingMs } };
}

function isSplitTensEventActiveClient() {
  return splitTensEventState().active;
}

function formatEventEndsAtLocal(endsAt) {
  const ts = endsAt ? new Date(endsAt).getTime() : NaN;
  if (!Number.isFinite(ts)) return 'Unknown';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function syncEventCountdownUI() {
  const splitTens = splitTensEventState();
  const labels = [
    document.getElementById('splitTensCountdownHome'),
    document.getElementById('splitTensCountdownRules'),
    document.getElementById('splitTensCountdownModal')
  ].filter(Boolean);
  if (!labels.length) return;
  const text = splitTens.active ? `Ends in ${formatCooldown(splitTens.remainingMs)}` : 'Event ended';
  for (const label of labels) label.textContent = text;
}

function refreshActiveEventsCountdown() {
  if (!Array.isArray(state.activeEvents) || !state.activeEvents.length) return false;
  const nowMs = serverNowMs();
  const next = state.activeEvents.filter((event) => {
    const endsMs = event?.endsAt ? new Date(event.endsAt).getTime() : NaN;
    return Number.isFinite(endsMs) && endsMs > nowMs;
  });
  const changed = next.length !== state.activeEvents.length;
  state.activeEvents = next;
  if (changed && state.eventDetailsModalId && !state.activeEvents.some((event) => event.id === state.eventDetailsModalId)) {
    state.eventDetailsModalId = null;
  }
  return changed;
}

function formatCooldown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMinutesSeconds(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatWeeklyCountdown(ms) {
  const remaining = Math.max(0, Math.floor(ms));
  const totalHours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (remaining >= 48 * 3_600_000) {
    return `${days}d ${hours}h`;
  }
  if (remaining >= 24 * 3_600_000) {
    return `${days}d ${hours}h`;
  }
  return formatCooldown(remaining);
}

function normalizeQuickPlayBucketValue(rawBucket) {
  const numeric = Math.floor(Number(rawBucket));
  if (!Number.isFinite(numeric)) return null;
  return QUICK_PLAY_BUCKETS.includes(numeric) ? numeric : null;
}

function formatQuickPlayBucket(bucket) {
  const normalized = normalizeQuickPlayBucketValue(bucket);
  return (normalized || 250).toLocaleString();
}

function rankTierKeyFromElo(eloRaw) {
  const elo = Math.floor(Number(eloRaw) || 0);
  for (const key of RANKED_TIER_ORDER) {
    const tier = RANKED_TIER_META[key];
    if (elo >= tier.minElo) return key;
  }
  return 'BRONZE';
}

function rankTierLabelFromUser(user = {}) {
  const key = rankTierKeyFromUser(user);
  if (RANKED_TIER_META[key]) return RANKED_TIER_META[key].label;
  if (user.rankTier) return String(user.rankTier);
  const elo = Math.floor(Number(user.rankedElo) || 0);
  return RANKED_TIER_META[rankTierKeyFromElo(elo)]?.label || 'Bronze';
}

function rankTierKeyFromUser(user = {}) {
  const key = String(user.rankTierKey || '').trim().toUpperCase();
  const explicitKey = key && RANKED_TIER_META[key] ? key : '';
  const rankTier = String(user.rankTier || '').trim().toUpperCase();
  const explicitLabelKey = rankTier && RANKED_TIER_META[rankTier] ? rankTier : '';
  const hasRankedElo = Number.isFinite(Number(user.rankedElo));
  const eloKey = hasRankedElo ? rankTierKeyFromElo(user.rankedElo) : '';
  if (explicitKey && eloKey && explicitKey !== eloKey) return eloKey;
  if (explicitLabelKey && eloKey && explicitLabelKey !== eloKey) return eloKey;
  if (explicitKey) return explicitKey;
  if (explicitLabelKey) return explicitLabelKey;
  if (eloKey) return eloKey;
  return rankTierKeyFromElo(user.rankedElo);
}

function rankTierMetaFromUser(user = {}) {
  const key = rankTierKeyFromUser(user);
  return {
    key,
    label: RANKED_TIER_META[key]?.label || rankTierLabelFromUser(user),
    icon: RANKED_TIER_META[key]?.icon || '◆',
    fixedBet: Math.max(1, Math.floor(Number(RANKED_TIER_META[key]?.fixedBet) || Number(user.rankedFixedBet) || 50))
  };
}

function rankTimelineData(user = {}) {
  const rows = [...RANKED_TIER_ORDER].reverse().map((key, index, list) => {
    const meta = RANKED_TIER_META[key];
    const nextKey = list[index + 1];
    const nextMeta = nextKey ? RANKED_TIER_META[nextKey] : null;
    return {
      key,
      label: meta.label,
      icon: meta.icon,
      minElo: meta.minElo,
      maxElo: nextMeta ? (nextMeta.minElo - 1) : null
    };
  });
  const elo = Math.max(0, Math.floor(Number(user?.rankedElo) || 0));
  const currentKey = rankTierKeyFromUser(user);
  const currentIndex = rows.findIndex((row) => row.key === currentKey);
  const nextTier = currentIndex >= 0 && currentIndex < rows.length - 1 ? rows[currentIndex + 1] : null;
  const eloToNext = nextTier ? Math.max(0, nextTier.minElo - elo) : 0;
  const scaleMax = Math.max(rows[rows.length - 1]?.minElo || 2000, elo, 2000) + 200;
  const progress = Math.max(0, Math.min(1, elo / scaleMax));
  return {
    rows,
    elo,
    currentKey,
    nextTier,
    eloToNext,
    progressPercent: Math.round(progress * 100)
  };
}

function rankKeyMeta(rankKeyOrLabel = '') {
  const normalized = String(rankKeyOrLabel || '').trim().toUpperCase();
  if (normalized && RANKED_TIER_META[normalized]) {
    return { key: normalized, ...RANKED_TIER_META[normalized] };
  }
  const fromLabel = RANKED_TIER_ORDER.find((key) => String(RANKED_TIER_META[key]?.label || '').toUpperCase() === normalized);
  if (fromLabel) {
    return { key: fromLabel, ...RANKED_TIER_META[fromLabel] };
  }
  const fallback = rankTierKeyFromElo(0);
  return { key: fallback, ...RANKED_TIER_META[fallback] };
}

function eloTrackPercent(eloRaw) {
  const elo = Math.max(0, Math.floor(Number(eloRaw) || 0));
  const topMin = Math.floor(Number(RANKED_TIER_META.LEGENDARY?.minElo) || 1850);
  const scaleMax = topMin + 300;
  const progress = scaleMax > 0 ? elo / scaleMax : 0;
  return Math.max(0, Math.min(1, progress));
}

function normalizeSeriesResultPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const outcomeRaw = String(payload.outcome || '').toLowerCase();
  const outcome = outcomeRaw === 'win' || outcomeRaw === 'loss' || outcomeRaw === 'forfeit'
    ? outcomeRaw
    : null;
  if (!outcome) return null;
  const eloBefore = Math.max(0, Math.floor(Number(payload.eloBefore) || 0));
  const eloAfter = Math.max(0, Math.floor(Number(payload.eloAfter) || 0));
  let eloDelta = Number(payload.eloDelta);
  if (!Number.isFinite(eloDelta)) eloDelta = eloAfter - eloBefore;
  eloDelta = Math.floor(eloDelta);
  const rankBeforeMeta = rankKeyMeta(payload.rankBeforeKey || payload.rankBefore || rankTierKeyFromElo(eloBefore));
  const rankAfterMeta = rankKeyMeta(payload.rankAfterKey || payload.rankAfter || rankTierKeyFromElo(eloAfter));
  return {
    seriesId: payload.seriesId || '',
    status: String(payload.status || '').toUpperCase() || null,
    outcome,
    eloDelta,
    eloBefore,
    eloAfter,
    rankBefore: rankBeforeMeta.label,
    rankBeforeKey: rankBeforeMeta.key,
    rankAfter: rankAfterMeta.label,
    rankAfterKey: rankAfterMeta.key,
    finalizedAt: payload.finalizedAt || null
  };
}

function hasHighRollerAccess(user = state.me) {
  const chips = Math.max(0, Math.floor(Number(user?.chips) || 0));
  return chips >= HIGH_ROLLER_UNLOCK_CHIPS;
}

function guardHighRollerAccess() {
  if (hasHighRollerAccess()) return true;
  pushToast(HIGH_ROLLER_UNLOCK_MESSAGE);
  return false;
}

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'Offline';
  const ts = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return 'Offline';
  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Offline • just now';
  if (mins < 60) return `Offline • ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Offline • ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Offline • ${days}d ago`;
}

function resolveFriendPresence(friend) {
  const live = state.presenceByUser?.[friend.id] || null;
  const online = live ? Boolean(live.online) : Boolean(friend.online);
  const inMatch = friend.presence === 'in_match';
  const presenceKey = inMatch ? 'in_match' : online ? 'online' : 'offline';
  const label = inMatch ? 'In match' : online ? 'Online' : formatLastSeen(live?.lastSeenAt || friend.lastSeenAt);
  return { presenceKey, label };
}

function formatNotificationTime(createdAt) {
  const ts = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(ts)) return '';
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const eventDate = new Date(ts);
  const nowDate = new Date(now);
  const sameDay =
    eventDate.getFullYear() === nowDate.getFullYear() &&
    eventDate.getMonth() === nowDate.getMonth() &&
    eventDate.getDate() === nowDate.getDate();
  if (sameDay) {
    return `Today ${eventDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(nowDate.getDate() - 1);
  const isYesterday =
    eventDate.getFullYear() === yesterday.getFullYear() &&
    eventDate.getMonth() === yesterday.getMonth() &&
    eventDate.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `Yesterday ${eventDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return eventDate.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function badgeShortText(badge) {
  if (!badge) return '';
  if (typeof badge === 'string') return badge;
  return badge.short || badge.label || badge.key || '';
}

function renderBadgePill(badge, extraClass = '') {
  const text = badgeShortText(badge);
  if (!text) return '';
  return `<span class="rank-badge ${extraClass}">${text}</span>`;
}

function renderRankTierBadge(userLike = {}, extraClass = '') {
  const hasRankSignal = Boolean(
    userLike &&
    (userLike.rankTierKey || userLike.rankTier || Number.isFinite(Number(userLike.rankedElo)))
  );
  if (!hasRankSignal) return '';
  const meta = rankTierMetaFromUser(userLike);
  const label = meta.label;
  const key = meta.key;
  if (!label) return '';
  return `<span class="rank-tier-badge ${extraClass}" data-rank-tier="${key}"><span class="rank-tier-icon" aria-hidden="true">${meta.icon}</span><span>${label}</span></span>`;
}

function renderPlayerMeta(participant = {}) {
  const title = participant.selectedTitle || '';
  const badge = renderBadgePill(participant.dynamicBadge, 'nameplate-badge');
  const rankBadge = renderRankTierBadge(participant, 'nameplate-rank');
  const level = Number.isFinite(Number(participant.level)) ? Math.max(1, Math.floor(Number(participant.level))) : null;
  const levelText = level ? `<span class="nameplate-level">Lv ${level}</span>` : '';
  const titleText = title ? `<span class="nameplate-title">${title}</span>` : '';
  return `${rankBadge}${levelText}${badge}${titleText}`;
}

function clearQuickPlayConnectTimer() {
  if (quickPlayConnectTimer) {
    clearTimeout(quickPlayConnectTimer);
    quickPlayConnectTimer = null;
  }
}

function quickPlayIsActive() {
  return state.quickPlay.status === 'searching' || state.quickPlay.status === 'connected';
}

function resetQuickPlayState({ clearTimer = true } = {}) {
  if (clearTimer) clearQuickPlayConnectTimer();
  const selectedBucket = normalizeQuickPlayBucketValue(state.quickPlay?.selectedBucket) || 250;
  state.quickPlay = {
    status: 'idle',
    bucket: null,
    selectedBucket,
    bucketPickerOpen: false,
    queuePosition: null,
    queuedAt: null,
    opponentName: '',
    matchId: null,
    pendingMatch: null
  };
}

function quickPlayOpponentNameFromMatch(match) {
  if (!match || !state.me) return '';
  const opponentId = Array.isArray(match.playerIds) ? match.playerIds.find((id) => id !== state.me.id) : null;
  if (!opponentId) return '';
  return match.participants?.[opponentId]?.username || '';
}

function clearBotMatchLaunchState({ renderNow = false } = {}) {
  if (botMatchLaunchTimer) {
    clearTimeout(botMatchLaunchTimer);
    botMatchLaunchTimer = null;
  }
  const wasPending = Boolean(state.botMatchLaunch?.pending || state.botMatchLaunch?.showBusy);
  state.botMatchLaunch = { pending: false, showBusy: false, mode: '' };
  if (renderNow && wasPending) render();
}

function beginBotMatchLaunchState(mode = 'real') {
  if (state.botMatchLaunch?.pending) return false;
  clearBotMatchLaunchState({ renderNow: false });
  state.botMatchLaunch = { pending: true, showBusy: false, mode };
  botMatchLaunchTimer = setTimeout(() => {
    botMatchLaunchTimer = null;
    if (!state.botMatchLaunch?.pending) return;
    state.botMatchLaunch.showBusy = true;
    if (state.view === 'home') render();
  }, 300);
  if (state.view === 'home') render();
  return true;
}

function finalizeQuickPlayConnectedState() {
  const pendingMatch = state.quickPlay.pendingMatch;
  clearQuickPlayConnectTimer();
  resetQuickPlayState({ clearTimer: false });
  if (!pendingMatch) return;
  state.currentMatch = pendingMatch;
  state.leaveMatchModal = false;
  state.emotePickerOpen = false;
  goToView('match');
  render();
}

function beginQuickPlayConnectedState(payload = {}) {
  const incomingMatch = payload.match || null;
  const incomingMatchId = payload.matchId || incomingMatch?.id || state.quickPlay.matchId || null;
  const nextBucket =
    normalizeQuickPlayBucketValue(payload.bucket) ||
    normalizeQuickPlayBucketValue(incomingMatch?.quickPlayBucket) ||
    normalizeQuickPlayBucketValue(state.quickPlay.bucket) ||
    normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) ||
    250;
  const nextOpponentName =
    payload.opponentName ||
    quickPlayOpponentNameFromMatch(incomingMatch) ||
    state.quickPlay.opponentName ||
    'Opponent';

  state.quickPlay.status = 'connected';
  state.quickPlay.bucket = nextBucket;
  state.quickPlay.selectedBucket = nextBucket;
  state.quickPlay.bucketPickerOpen = false;
  state.quickPlay.matchId = incomingMatchId;
  state.quickPlay.opponentName = nextOpponentName;
  state.quickPlay.queuePosition = null;
  if (incomingMatch) state.quickPlay.pendingMatch = incomingMatch;
  if (quickPlayConnectTimer) return;
  quickPlayConnectTimer = setTimeout(() => {
    finalizeQuickPlayConnectedState();
  }, 850);
}

function rankedQueueIsActive() {
  return Boolean(state.rankedQueue.searching || state.rankedQueue.connected);
}

function resetRankedQueueState() {
  const fixedBet = Math.max(1, Math.floor(Number(state.me?.rankedFixedBet || state.me?.rankedBetMin) || 50));
  state.rankedQueue = {
    status: 'idle',
    searching: false,
    queuedAt: null,
    bet: fixedBet,
    pendingMatch: null,
    opponentName: '',
    connected: false
  };
}

function rankedClientLog(event, payload = {}) {
  if (typeof console === 'undefined') return;
  console.info(`[ranked-client] ${event}`, payload);
}

function beginRankedConnectedState(payload = {}) {
  state.rankedQueue.connected = true;
  state.rankedQueue.searching = false;
  state.rankedQueue.status = 'connected';
  state.rankedQueue.pendingMatch = payload.match || null;
  state.rankedQueue.opponentName = payload.opponentName || 'Opponent';
  if (Number.isFinite(Number(payload.fixedBet))) {
    state.rankedQueue.bet = Math.max(1, Math.floor(Number(payload.fixedBet)));
  }
  setTimeout(() => {
    const match = state.rankedQueue.pendingMatch;
    resetRankedQueueState();
    loadRankedOverview({ silent: true });
    if (!match) return;
    state.currentMatch = match;
    goToView('match');
    render();
  }, 850);
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function pruneCardAnimState(now = Date.now()) {
  const anim = state.cardAnimState;
  for (const bucket of [anim.enterUntilById, anim.revealUntilById, anim.shiftUntilById]) {
    for (const [cardId, until] of Object.entries(bucket)) {
      if (until <= now) delete bucket[cardId];
    }
  }
  for (const cardId of Object.keys(anim.tiltById)) {
    if (!anim.enterUntilById[cardId]) delete anim.tiltById[cardId];
  }
}

function cardSnapshot(match) {
  const byId = {};
  if (!match?.players || !Array.isArray(match?.playerIds)) return byId;
  for (const playerId of match.playerIds) {
    const hands = match.players?.[playerId]?.hands || [];
    for (let handIndex = 0; handIndex < hands.length; handIndex += 1) {
      const cards = hands[handIndex]?.cards || [];
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        const card = cards[cardIndex];
        if (!card || typeof card.id !== 'string' || !card.id) continue;
        byId[card.id] = {
          playerId,
          handIndex,
          cardIndex,
          visible: !card.hidden
        };
      }
    }
  }
  return byId;
}

function updateCardAnimationState(previousMatch, nextMatch) {
  const now = Date.now();
  const anim = state.cardAnimState;
  pruneCardAnimState(now);
  if (prefersReducedMotion()) {
    anim.enterUntilById = {};
    anim.revealUntilById = {};
    anim.shiftUntilById = {};
    anim.tiltById = {};
    return;
  }
  const previous = cardSnapshot(previousMatch);
  const next = cardSnapshot(nextMatch);
  for (const [cardId, nextPos] of Object.entries(next)) {
    const prevPos = previous[cardId];
    if (!prevPos) {
      anim.enterUntilById[cardId] = now + 560;
      anim.tiltById[cardId] = ((Math.random() * 2) - 1) * 3.4;
      continue;
    }
    if (prevPos.visible === false && nextPos.visible === true) {
      anim.revealUntilById[cardId] = now + 520;
    }
    if (prevPos.playerId !== nextPos.playerId || prevPos.handIndex !== nextPos.handIndex) {
      anim.shiftUntilById[cardId] = now + 500;
    }
  }
}

function cardAnimationMeta(card) {
  const cardId = typeof card?.id === 'string' ? card.id : '';
  if (!cardId) {
    return {
      cardId: '',
      isEntering: false,
      isRevealing: false,
      isShifting: false,
      tiltDeg: 0
    };
  }
  const now = Date.now();
  const anim = state.cardAnimState;
  return {
    cardId,
    isEntering: (anim.enterUntilById[cardId] || 0) > now,
    isRevealing: (anim.revealUntilById[cardId] || 0) > now,
    isShifting: (anim.shiftUntilById[cardId] || 0) > now,
    tiltDeg: Number(anim.tiltById[cardId] || 0)
  };
}

function pressureGlowKey(match, pressure, viewerId) {
  if (!match || !pressure || !viewerId) return '';
  const indices = Array.isArray(pressure.affectedHandIndices) ? pressure.affectedHandIndices.join(',') : '';
  return `${match.id}:${match.roundNumber}:${viewerId}:${pressure.initiatorId}:${pressure.type}:${pressure.delta}:${indices}`;
}

function toValidIso(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function deriveTierResetAtFromChallenges(challenges, tier) {
  const list = Array.isArray(challenges?.[tier]) ? challenges[tier] : [];
  const withReset = list.find((item) => item?.resetAt || item?.expiresAt);
  return toValidIso(withReset?.resetAt || withReset?.expiresAt);
}

function challengeResetText(tier) {
  const resetAt = state.challengeResets?.[tier];
  if (!resetAt) return '';
  const remaining = state.challengeResetRemainingMs?.[tier] || 0;
  if (remaining <= 0) return 'Resetting...';
  if (tier === 'hourly') return `Resets in ${formatMinutesSeconds(remaining)}`;
  if (tier === 'daily') return `Resets in ${formatCooldown(remaining)}`;
  if (tier === 'weekly') return `Resets in ${formatWeeklyCountdown(remaining)}`;
  if (tier === 'skill') return `Refreshes in ${formatCooldown(remaining)}`;
  return `Resets in ${formatCooldown(remaining)}`;
}

function claimableChallengesCount() {
  const groups = state.challenges || {};
  let count = 0;
  for (const tier of ['hourly', 'daily', 'weekly', 'skill']) {
    const list = Array.isArray(groups[tier]) ? groups[tier] : [];
    for (const challenge of list) {
      const progress = Math.max(0, Math.floor(Number(challenge?.progress) || 0));
      const goal = Math.max(1, Math.floor(Number(challenge?.goal) || 1));
      const claimed = Boolean(challenge?.claimed || challenge?.claimedAt);
      if (!claimed && progress >= goal) count += 1;
    }
  }
  return count;
}

function deriveExpandedStats(me) {
  const stats = me?.stats || {};
  const history = Array.isArray(me?.betHistory) ? me.betHistory : [];
  const historyWon = history.reduce((sum, item) => sum + Math.max(0, Number(item?.net) || 0), 0);
  const historyLost = history.reduce((sum, item) => sum + Math.max(0, -(Number(item?.net) || 0)), 0);
  const historyBiggestWin = history.reduce((max, item) => Math.max(max, Number(item?.net) || 0), 0);
  const historyBiggestLoss = history.reduce((max, item) => Math.max(max, -(Number(item?.net) || 0)), 0);
  const realBetSum = Number(stats.realBetSum) || history.reduce((sum, item) => sum + (Number(item?.bet) || 0), 0);
  const realBetCount = Number(stats.realBetCount) || history.filter((item) => Number.isFinite(Number(item?.bet))).length;
  const averageBet = realBetCount > 0 ? realBetSum / realBetCount : 0;

  return {
    splitsAttempted: Number(stats.splitsAttempted) || 0,
    splitHandsWon: Number(stats.splitHandsWon) || 0,
    splitHandsLost: Number(stats.splitHandsLost) || 0,
    splitHandsPushed: Number(stats.splitHandsPushed) || 0,
    doublesAttempted: Number(stats.doublesAttempted) || 0,
    doubleHandsWon: Number(stats.doubleHandsWon) || 0,
    doubleHandsLost: Number(stats.doubleHandsLost) || 0,
    doubleHandsPushed: Number(stats.doubleHandsPushed) || 0,
    surrenders: Number(stats.surrenders) || 0,
    blackjacks: Number(stats.blackjacks) || 0,
    busts: Number(stats.busts) || 0,
    highestSafeTotal: Number(stats.highestSafeTotal) || 0,
    maxCardsInWinningHand: Number(stats.maxCardsInWinningHand) || 0,
    fourCard21s: Number(stats.fourCard21s) || 0,
    fiveCard21s: Number(stats.fiveCard21s) || 0,
    sixCard21s: Number(stats.sixCard21s) || 0,
    sevenPlusCard21s: Number(stats.sevenPlusCard21s) || 0,
    longestWinStreak: Number(stats.longestWinStreak) || 0,
    longestLossStreak: Number(stats.longestLossStreak) || 0,
    totalChipsWon: Number(stats.totalChipsWon) || historyWon,
    totalChipsLost: Number(stats.totalChipsLost) || historyLost,
    netChips: (Number(stats.totalChipsWon) || historyWon) - (Number(stats.totalChipsLost) || historyLost),
    biggestHandWin: Number(stats.biggestHandWin) || historyBiggestWin,
    biggestHandLoss: Number(stats.biggestHandLoss) || historyBiggestLoss,
    averageBet,
    handsPlayedBotPractice: Number(stats.handsPlayedBotPractice) || 0,
    handsPlayedBotReal: Number(stats.handsPlayedBotReal) || 0,
    handsPlayedPvpReal: Number(stats.handsPlayedPvpReal) || 0,
    handsPlayedPvpFriendly: Number(stats.handsPlayedPvpFriendly) || 0
  };
}

function normalizeProfileBorderIdClient(value) {
  const key = String(value || '').trim().toUpperCase();
  return PROFILE_BORDER_DEF_MAP.has(key) ? key : 'NONE';
}

function profileBordersForUser(me = {}) {
  const level = Math.max(1, Math.floor(Number(me?.level) || 1));
  const serverBorders = Array.isArray(me.profileBorders) ? me.profileBorders : [];
  if (serverBorders.length) {
    return serverBorders.map((border) => {
      const normalizedId = normalizeProfileBorderIdClient(border?.id);
      const fallback = PROFILE_BORDER_DEF_MAP.get(normalizedId);
      const minLevelRequired = Math.max(1, Math.floor(Number(border?.minLevelRequired) || Number(fallback?.minLevelRequired) || 1));
      return {
        id: normalizedId,
        name: String(border?.name || fallback?.name || 'Unknown'),
        tier: String(border?.tier || fallback?.tier || 'Default'),
        minLevelRequired,
        previewToken: String(border?.previewToken || fallback?.previewToken || 'none'),
        unlocked: Boolean(border?.unlocked) || level >= minLevelRequired
      };
    });
  }
  return PROFILE_BORDER_DEFS.map((border) => ({
    ...border,
    unlocked: level >= border.minLevelRequired
  }));
}

function normalizeDeckSkinId(value) {
  const key = String(value || '').trim().toUpperCase();
  return DECK_SKIN_MAP.has(key) ? key : 'CLASSIC';
}

function deckSkinsForUser(me = {}) {
  const level = Math.max(1, Math.floor(Number(me?.level) || 1));
  const serverSkins = Array.isArray(me?.deckSkins) ? me.deckSkins : [];
  const serverById = new Map(
    serverSkins
      .map((entry) => {
        const id = normalizeDeckSkinId(entry?.id);
        return [id, entry];
      })
  );
  return DECK_SKIN_DEFS.map((skin) => ({
    ...skin,
    minLevelRequired: Math.max(1, Math.floor(Number(serverById.get(skin.id)?.minLevelRequired) || skin.minLevelRequired || 1)),
    description: String(serverById.get(skin.id)?.description || skin.description || ''),
    unlockHint: String(serverById.get(skin.id)?.unlockHint || skin.unlockHint || `Reach level ${Math.max(1, Math.floor(Number(skin.minLevelRequired) || 1))}.`),
    unlocked: typeof serverById.get(skin.id)?.unlocked === 'boolean'
      ? Boolean(serverById.get(skin.id).unlocked)
      : level >= Math.max(1, Math.floor(Number(skin.minLevelRequired) || 1))
  }));
}

function deckSkinForUser(me = state.me) {
  const skins = deckSkinsForUser(me);
  const byId = new Map(skins.map((entry) => [entry.id, entry]));
  const normalizedId = normalizeDeckSkinId(me?.selectedDeckSkin || 'CLASSIC');
  const requested = byId.get(normalizedId) || skins[0] || DECK_SKIN_DEFS[0];
  if (!requested?.unlocked) {
    return skins.find((entry) => entry.unlocked) || skins[0] || DECK_SKIN_DEFS[0];
  }
  return requested;
}

function streakBonusPercent(me = state.me) {
  const streak = Math.max(0, Math.floor(Number(me?.currentMatchWinStreak) || 0));
  if (streak >= 10) return 15;
  if (streak >= 6) return 10;
  if (streak >= 3) return 5;
  return 0;
}

function titleCatalogForUserClient(me = {}) {
  const unlockedSet = new Set(
    (Array.isArray(me.unlockedTitles) ? me.unlockedTitles : [])
      .map((key) => String(key || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const serverCatalog = Array.isArray(me.titleCatalog) ? me.titleCatalog : [];
  if (serverCatalog.length) {
    return serverCatalog
      .map((entry) => {
        const key = String(entry?.key || '').trim().toUpperCase();
        if (!key) return null;
        const fallback = TITLE_DEF_MAP.get(key);
        return {
          key,
          label: String(entry?.label || fallback?.label || key),
          category: String(entry?.category || fallback?.category || 'skill').toLowerCase(),
          requirementText: String(entry?.requirementText || fallback?.unlockHint || entry?.description || ''),
          description: String(entry?.description || fallback?.unlockHint || ''),
          unlocked: Boolean(entry?.unlocked) || unlockedSet.has(key)
        };
      })
      .filter(Boolean);
  }
  return TITLE_DEFS
    .filter((entry) => entry.key)
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      category: entry.category || 'skill',
      requirementText: entry.unlockHint || '',
      description: entry.unlockHint || '',
      unlocked: unlockedSet.has(entry.key)
    }));
}

function titleCatalogEntryByKeyClient(me = {}, key = '') {
  const normalizedKey = String(key || '').trim().toUpperCase();
  if (!normalizedKey) return null;
  return titleCatalogForUserClient(me).find((entry) => entry.key === normalizedKey) || null;
}

function normalizeTitleOwnershipFilter(value) {
  const key = String(value || 'ALL').trim().toUpperCase();
  if (['ALL', 'UNLOCKED', 'LOCKED'].includes(key)) return key;
  return 'ALL';
}

function normalizeTitleCategoryFilter(value, categories = []) {
  const allowed = new Set(['ALL', ...categories.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)]);
  const key = String(value || 'ALL').trim().toUpperCase();
  return allowed.has(key) ? key : 'ALL';
}

function normalizeFavoriteStatKey(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return FAVORITE_STAT_DEFS.some((entry) => entry.key === normalized) ? normalized : FAVORITE_STAT_DEFS[0].key;
}

function favoriteStatOptionsForUser(me) {
  const expandedStats = deriveExpandedStats(me || {});
  return FAVORITE_STAT_DEFS.map((entry) => {
    const raw = Number(entry.read(me, expandedStats));
    const value = Number.isFinite(raw) ? Math.floor(raw) : 0;
    return {
      ...entry,
      value,
      valueText: typeof entry.format === 'function' ? entry.format(value) : value.toLocaleString()
    };
  });
}

function renderRankTimelineModal(user = state.me) {
  if (!state.rankTimelineModalOpen) return '';
  const timeline = rankTimelineData(user || {});
  const nextLine = timeline.nextTier
    ? `${timeline.eloToNext.toLocaleString()} Elo to ${timeline.nextTier.label}`
    : 'Top rank reached';
  return `
    <div class="modal" id="rankTimelineModal">
      <div class="modal-panel card rank-timeline-modal" role="dialog" aria-modal="true" aria-label="Rank progression">
        <div class="stats-more-head">
          <h3>Rank Progression</h3>
          <button id="closeRankTimelineBtn" class="ghost" type="button">Close</button>
        </div>
        <div class="muted">Current Elo ${timeline.elo.toLocaleString()} • ${nextLine}</div>
        <div class="rank-timeline-track-wrap">
          <div class="rank-timeline-track">
            <span class="rank-timeline-progress" style="width:${timeline.progressPercent}%"></span>
          </div>
          <div class="rank-timeline-marker" style="left:${timeline.progressPercent}%"></div>
        </div>
        <div class="rank-timeline-list">
          ${timeline.rows
            .map((row) => `<div class="rank-timeline-row ${row.key === timeline.currentKey ? 'is-current' : ''}">
                <div class="rank-timeline-row-left">
                  <span class="rank-tier-icon">${row.icon}</span>
                  <strong>${row.label}</strong>
                  ${renderRankTierBadge({ rankTierKey: row.key, rankedElo: row.minElo })}
                </div>
                <span class="muted">${row.maxElo === null ? `${row.minElo}+` : `${row.minElo}-${row.maxElo}`}</span>
              </div>`)
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function updateChallengeResetCountdowns() {
  const prev = { ...state.challengeResetRemainingMs };
  const next = { hourly: 0, daily: 0, weekly: 0 };
  for (const tier of ['hourly', 'daily', 'weekly', 'skill']) {
    const resetAt = state.challengeResets?.[tier];
    const targetMs = resetAt ? new Date(resetAt).getTime() : 0;
    next[tier] = Number.isFinite(targetMs) && targetMs > 0 ? Math.max(0, targetMs - Date.now()) : 0;
  }
  state.challengeResetRemainingMs = next;
  return ['hourly', 'daily', 'weekly', 'skill'].some((tier) => prev[tier] > 0 && next[tier] <= 0);
}

function syncChallengeCountdownUI() {
  const nodes = document.querySelectorAll('[data-challenge-reset-tier]');
  if (!nodes.length) return;
  nodes.forEach((node) => {
    const tier = node.getAttribute('data-challenge-reset-tier');
    node.textContent = challengeResetText(tier);
  });
}

function applyChallengesPayload(challenges, resets, resetHints = {}) {
  const groups = challenges && typeof challenges === 'object'
    ? challenges
    : { hourly: [], daily: [], weekly: [], skill: [] };
  state.challenges = groups;
  state.challengeResets = {
    hourly:
      toValidIso(resets?.hourly) ||
      toValidIso(resetHints?.hourlyResetAt) ||
      deriveTierResetAtFromChallenges(groups, 'hourly'),
    daily:
      toValidIso(resets?.daily) ||
      toValidIso(resetHints?.dailyResetAt) ||
      toValidIso(resetHints?.nextDailyResetAt) ||
      deriveTierResetAtFromChallenges(groups, 'daily'),
    weekly:
      toValidIso(resets?.weekly) ||
      toValidIso(resetHints?.weeklyResetAt) ||
      toValidIso(resetHints?.nextWeeklyResetAt) ||
      deriveTierResetAtFromChallenges(groups, 'weekly'),
    skill:
      toValidIso(resets?.skill) ||
      toValidIso(resetHints?.skillResetAt) ||
      toValidIso(resetHints?.nextSkillResetAt) ||
      deriveTierResetAtFromChallenges(groups, 'skill')
  };
  state.challengeMeta = {
    skillPoolSize: Math.max(0, Math.floor(Number(resetHints?.skillPoolSize) || 0)),
    activeSkillCount: Math.max(0, Math.floor(Number(resetHints?.activeSkillCount) || 0))
  };
  updateChallengeResetCountdowns();
}

function turnTimerKey(match) {
  if (!match) return '';
  return `${match.id}:${match.roundNumber}:${match.phase}:${match.currentTurn || ''}:${match.turnExpiresAt || ''}`;
}

function shouldPauseTurnTimer(match) {
  if (!match) return true;
  if (state.view !== 'match') return true;
  if (match.phase !== 'ACTION_TURN') return true;
  if (match.pendingPressure) return true;
  if (state.leaveMatchModal || Boolean(state.confirmActionModal)) return true;
  if (state.notificationsOpen || Boolean(state.roundResultBanner)) return true;
  return false;
}

function getTurnTimerState(match = state.currentMatch) {
  const timeoutMs = Number(match?.turnTimeoutMs || 30_000);
  const expiresAtMs = match?.turnExpiresAt ? new Date(match.turnExpiresAt).getTime() : 0;
  const active =
    Boolean(match) &&
    match.phase === 'ACTION_TURN' &&
    !match.pendingPressure &&
    Boolean(match.currentTurn) &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > 0;

  if (!active) {
    state.turnTimerFreezeKey = '';
    state.turnTimerFreezeRemainingMs = null;
    return {
      active: false,
      paused: false,
      urgent: false,
      remainingMs: 0,
      timeoutMs,
      progress: 0,
      key: ''
    };
  }

  const key = turnTimerKey(match);
  const paused = shouldPauseTurnTimer(match);
  let remainingMs = Math.max(0, expiresAtMs - Date.now());
  if (paused) {
    if (state.turnTimerFreezeKey !== key || !Number.isFinite(state.turnTimerFreezeRemainingMs)) {
      state.turnTimerFreezeKey = key;
      state.turnTimerFreezeRemainingMs = remainingMs;
    }
    remainingMs = Math.max(0, Number(state.turnTimerFreezeRemainingMs || 0));
  } else if (state.turnTimerFreezeKey === key) {
    state.turnTimerFreezeKey = '';
    state.turnTimerFreezeRemainingMs = null;
  }

  const progress = timeoutMs > 0 ? Math.max(0, Math.min(1, remainingMs / timeoutMs)) : 0;
  return {
    active: true,
    paused,
    urgent: remainingMs <= 3000,
    remainingMs,
    timeoutMs,
    progress,
    key
  };
}

function formatTurnSeconds(ms) {
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

function renderTurnTimer(ownerId, timerState, variant = 'zone') {
  const visible = Boolean(timerState.active && state.currentMatch?.currentTurn === ownerId);
  const opponentThinking = Boolean(timerState.active && !visible);
  const percent = Math.round((visible ? timerState.progress : 0) * 100);
  const toneClass =
    visible && timerState.urgent
      ? 'is-urgent'
      : visible && timerState.paused
        ? 'is-paused'
        : opponentThinking
          ? 'is-thinking'
          : '';
  const label = visible ? 'Your Turn' : opponentThinking ? 'Opponent thinking' : 'Waiting';
  return `
    <div class="turn-timer turn-timer--${variant} ${toneClass} ${visible ? 'is-active' : 'is-idle'}"
      data-turn-timer
      data-turn-owner="${ownerId}"
      data-turn-variant="${variant}"
      data-turn-visible="${visible ? '1' : '0'}">
      <div class="turn-timer-head">
        <span class="turn-timer-label">${label}</span>
        <span class="turn-timer-seconds">${visible ? formatTurnSeconds(timerState.remainingMs) : opponentThinking ? '' : '--'}</span>
      </div>
      <div class="turn-timer-track"><span class="turn-timer-fill" style="width:${percent}%"></span></div>
    </div>
  `;
}

function syncTurnCountdownUI() {
  const nodes = document.querySelectorAll('[data-turn-timer]');
  if (!nodes.length) return;
  const match = state.currentMatch;
  const timerState = getTurnTimerState(match);
  nodes.forEach((node) => {
    const ownerId = node.getAttribute('data-turn-owner') || '';
    const visible = Boolean(timerState.active && match?.currentTurn === ownerId);
    const opponentThinking = Boolean(timerState.active && !visible);
    const pct = Math.round((visible ? timerState.progress : 0) * 100);
    node.setAttribute('data-turn-visible', visible ? '1' : '0');
    node.classList.toggle('is-active', visible);
    node.classList.toggle('is-idle', !visible);
    node.classList.toggle('is-urgent', visible && timerState.urgent);
    node.classList.toggle('is-paused', visible && timerState.paused);
    node.classList.toggle('is-thinking', opponentThinking);
    const labelEl = node.querySelector('.turn-timer-label');
    const secEl = node.querySelector('.turn-timer-seconds');
    const fillEl = node.querySelector('.turn-timer-fill');
    if (labelEl) labelEl.textContent = visible ? 'Your Turn' : opponentThinking ? 'Opponent thinking' : 'Waiting';
    if (secEl) secEl.textContent = visible ? formatTurnSeconds(timerState.remainingMs) : opponentThinking ? '' : '--';
    if (fillEl) fillEl.style.width = `${pct}%`;
  });
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

async function loadLeaderboard({ silent = true } = {}) {
  if (!state.token) return;
  state.leaderboard.loading = true;
  try {
    const data = await api(`/api/leaderboard/chips?limit=${LEADERBOARD_LIMIT}&offset=0`, { method: 'GET' });
    state.leaderboard.rows = Array.isArray(data?.rows) ? data.rows : [];
    state.leaderboard.currentUserRank = Number.isFinite(Number(data?.currentUserRank))
      ? Math.max(1, Math.floor(Number(data.currentUserRank)))
      : null;
    state.leaderboard.totalUsers = Number.isFinite(Number(data?.totalUsers))
      ? Math.max(0, Math.floor(Number(data.totalUsers)))
      : state.leaderboard.rows.length;
  } catch (error) {
    if (!silent) setError(error.message);
  } finally {
    state.leaderboard.loading = false;
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
  if (!state.token || offlineModeEnabled()) return;
  if (state.socket) state.socket.disconnect();

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    if (state.quickPlay.status === 'searching') {
      const reconnectBucket =
        normalizeQuickPlayBucketValue(state.quickPlay.bucket) ||
        normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) ||
        250;
      api('/api/matchmaking/join', {
        method: 'POST',
        body: JSON.stringify({ bucket: reconnectBucket })
      })
        .then((data) => {
          if (data?.status === 'found') {
            beginQuickPlayConnectedState(data);
          } else {
            state.quickPlay.queuePosition = Number.isFinite(Number(data?.queuePosition)) ? Number(data.queuePosition) : null;
            if (data?.queuedAt) state.quickPlay.queuedAt = data.queuedAt;
            const responseBucket = normalizeQuickPlayBucketValue(data?.bucket) || reconnectBucket;
            state.quickPlay.bucket = responseBucket;
            state.quickPlay.selectedBucket = responseBucket;
          }
          render();
        })
        .catch(() => {
          resetQuickPlayState();
          pushToast('Quick Play stopped after reconnect issue.');
          render();
        });
    }
    if (state.rankedQueue.searching) {
      api('/api/ranked/status', { method: 'GET' })
        .then((data) => {
          if (data?.status === 'found') {
            beginRankedConnectedState(data);
          } else if (data?.status === 'searching') {
            state.rankedQueue.status = 'searching';
            state.rankedQueue.searching = true;
            if (data?.queuedAt) state.rankedQueue.queuedAt = data.queuedAt;
            if (Number.isFinite(Number(data?.fixedBet || data?.requestedBet))) state.rankedQueue.bet = Math.floor(Number(data.fixedBet || data.requestedBet));
          } else {
            resetRankedQueueState();
          }
          render();
        })
        .catch(() => {
          resetRankedQueueState();
          render();
        });
    }
  });

  state.socket.on('connect_error', (e) => {
    state.network.offlineMode = true;
    setError(e?.message || 'Connection error');
  });
  state.socket.on('disconnect', () => {
    if (state.quickPlay.status === 'searching') {
      resetQuickPlayState();
      pushToast('Quick Play cancelled: connection lost.');
      render();
    }
    if (state.rankedQueue.searching) {
      resetRankedQueueState();
      pushToast('Ranked queue cancelled: connection lost.');
      render();
    }
  });
  state.socket.on('matchmaking:searching', (payload = {}) => {
    if (!quickPlayIsActive()) return;
    const bucket =
      normalizeQuickPlayBucketValue(payload.bucket) ||
      normalizeQuickPlayBucketValue(state.quickPlay.bucket) ||
      normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) ||
      250;
    state.quickPlay.status = 'searching';
    state.quickPlay.bucket = bucket;
    state.quickPlay.selectedBucket = bucket;
    state.quickPlay.queuePosition = Number.isFinite(Number(payload.queuePosition)) ? Number(payload.queuePosition) : state.quickPlay.queuePosition;
    if (payload?.queuedAt) state.quickPlay.queuedAt = payload.queuedAt;
    render();
  });
  state.socket.on('matchmaking:found', (payload = {}) => {
    beginQuickPlayConnectedState(payload);
    render();
  });
  state.socket.on('matchmaking:cancelled', () => {
    if (!quickPlayIsActive()) return;
    resetQuickPlayState();
    render();
  });
  state.socket.on('matchmaking:error', ({ error }) => {
    if (!quickPlayIsActive()) return;
    resetQuickPlayState();
    if (error) setError(error);
  });
  state.socket.on('ranked:found', (payload = {}) => {
    beginRankedConnectedState(payload);
    render();
  });
  state.socket.on('presence:snapshot', ({ friends }) => {
    state.presenceByUser = friends || {};
    render();
  });
  state.socket.on('presence:update', (payload = {}) => {
    if (!payload?.userId) return;
    state.presenceByUser[payload.userId] = {
      online: Boolean(payload.online),
      lastSeenAt: payload.lastSeenAt || null
    };
    render();
  });
  state.socket.on('friend:challenge', (payload = {}) => {
    if (!payload?.challengeId) return;
    state.challengePopup = payload;
    pushToast(`Challenge from ${payload.fromUsername || 'Friend'}.`);
    render();
  });
  state.socket.on('notify:list', ({ notifications }) => {
    state.notifications = notifications || [];
    const activeIds = new Set(state.notifications.map((item) => item.id));
    state.notificationFriendRequestStatus = Object.fromEntries(
      Object.entries(state.notificationFriendRequestStatus).filter(([notifId]) => activeIds.has(notifId))
    );
    render();
  });
  state.socket.on('notify:new', (notification) => {
    state.notifications = [notification, ...state.notifications].slice(0, 60);
    const activeIds = new Set(state.notifications.map((item) => item.id));
    state.notificationFriendRequestStatus = Object.fromEntries(
      Object.entries(state.notificationFriendRequestStatus).filter(([notifId]) => activeIds.has(notifId))
    );
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
    }, 4000);
  });
  state.socket.on('lobby:update', (lobby) => {
    if (!lobby || lobby.status === 'closed' || lobby.status === 'cancelled') {
      if (state.currentLobby && (!lobby || state.currentLobby.id === lobby.id)) {
        state.currentLobby = null;
        if (lobby?.status === 'cancelled') setStatus('Lobby cancelled.');
        render();
      }
      return;
    }
    state.currentLobby = lobby;
    render();
  });
  state.socket.on('match:chat', (payload = {}) => {
    if (!state.currentMatch || payload.matchId !== state.currentMatch.id) return;
    state.currentMatch.chat = Array.isArray(payload.chat) ? payload.chat : state.currentMatch.chat || [];
    render();
  });
  state.socket.on('match:state', (match) => {
    const previousMatch = state.currentMatch;
    const previousRound = state.currentMatch?.roundNumber || 0;
    updateCardAnimationState(previousMatch, match);
    if (previousMatch?.id !== match?.id) {
      state.matchChatDraft = '';
    }
    clearBotMatchLaunchState({ renderNow: false });
    state.currentMatch = match;
    applyEventsSnapshot(match?.serverNow, match?.activeEvents || []);
    state.leaveMatchModal = false;
    const myChoice = state.me?.id ? match?.resultChoiceByPlayer?.[state.me.id] : null;
    state.roundResultChoicePending = Boolean(match.phase === 'RESULT' && myChoice);
    if (match.roundNumber > previousRound && match.phase !== 'RESULT') {
      state.roundResultBanner = null;
      state.roundResultChoicePending = false;
    }
    const myBankroll = match.players?.[state.me?.id]?.bankroll;
    if (state.me && Number.isFinite(myBankroll)) {
      const from = Number.isFinite(state.bankrollDisplay) ? state.bankrollDisplay : Number(state.me.chips || myBankroll);
      state.me.chips = myBankroll;
      tweenBankroll(from, myBankroll, match.phase === 'RESULT' ? 950 : 350);
    }
    if (typeof match.selectedBet === 'number') {
      const bounds = getBetBounds(match);
      const clamped = clampBetValue(match.selectedBet, bounds);
      if (!Number.isInteger(clamped)) {
        state.currentBet = bounds.min;
        state.betInputDraft = '';
        persistBetValue(bounds.min);
      } else {
        state.currentBet = clamped;
        state.betInputDraft = '';
        persistBetValue(clamped);
      }
    }
    if (quickPlayIsActive()) {
      beginQuickPlayConnectedState({
        matchId: match.id,
        opponentName: quickPlayOpponentNameFromMatch(match),
        match
      });
      render();
      return;
    }
    goToView('match');
    render();
  });
  state.socket.on('match:error', ({ error }) => setError(error));
  state.socket.on('round:result', ({ matchId, roundNumber, outcome, deltaChips, title, previousBankroll, newBankroll, isPractice, rankedSeries, seriesResult }) => {
    // One-shot inline result banner trigger keyed by match+round.
    const key = `${matchId}:${roundNumber}`;
    if (state.lastRoundResultKey === key) return;
    state.lastRoundResultKey = key;
    state.roundResultChoicePending = false;
    state.roundResultBanner = {
      matchId,
      roundNumber,
      outcome,
      title: title || (outcome === 'win' ? 'You Win' : outcome === 'lose' ? 'You Lose' : 'Push'),
      deltaChips: deltaChips || 0,
      isPractice: Boolean(isPractice),
      rankedSeries: rankedSeries || null,
      seriesResult: seriesResult || null
    };
    if (Number.isFinite(previousBankroll) && Number.isFinite(newBankroll)) {
      tweenBankroll(previousBankroll, newBankroll, 950);
    }
    const normalizedSeriesResult = normalizeSeriesResultPayload(seriesResult);
    if (normalizedSeriesResult) {
      state.pendingSeriesResult = normalizedSeriesResult;
    }
    if (String(state.currentMatch?.matchType || '').toUpperCase() === 'RANKED') {
      if (rankedSeries?.complete && state.rankedOverview?.activeSeries?.seriesId === rankedSeries.seriesId) {
        state.rankedOverview.activeSeries = null;
      }
      loadRankedOverview({ silent: true });
    }
    render();
  });
  state.socket.on('user:update', ({ user }) => {
    if (!user || !state.me || user.id !== state.me.id) return;
    const previousMe = { ...state.me };
    state.me = { ...state.me, ...user };
    syncXpUiFromUser(state.me, previousMe);
    loadLeaderboard({ silent: true });
    if (state.view === 'ranked' || state.view === 'home') {
      loadRankedOverview({ silent: true });
    }
    render();
  });
  state.socket.on('match:ended', ({ reason, seriesResult }) => {
    setStatus(reason);
    const resolvedSeriesResult = normalizeSeriesResultPayload(seriesResult) || state.pendingSeriesResult;
    state.pendingSeriesResult = null;
    if (resolvedSeriesResult) {
      state.rankedSeriesResultModal = resolvedSeriesResult;
      state.rankedSeriesResultAnimKey = '';
    }
    resetQuickPlayState();
    resetRankedQueueState();
    state.matchChatDraft = '';
    state.rankedForfeitModalOpen = false;
    clearBotMatchLaunchState({ renderNow: false });
    state.currentMatch = null;
    state.currentLobby = null;
    state.cardAnimState = { enterUntilById: {}, revealUntilById: {}, shiftUntilById: {}, tiltById: {} };
    state.pressureGlow = { key: '', expiresAt: 0, seen: true };
    state.leaveMatchModal = false;
    const target = state.pendingNavAfterLeave || 'home';
    state.pendingNavAfterLeave = null;
    goToView(target);
    loadMe();
    if (resolvedSeriesResult) loadRankedOverview({ silent: true });
  });
}

async function loadMe() {
  if (!state.token) return;
  try {
    const auth = await api('/api/auth/me', { method: 'POST', body: JSON.stringify({ authToken: state.token }) });
    if (!auth?.ok) throw new Error('Invalid auth');
    const data = await api('/api/me');
    const previousMe = state.me ? { ...state.me } : null;
    state.me = data.user;
    syncXpUiFromUser(state.me, previousMe);
    state.rankedOverview = data.rankedOverview || null;
    applyEventsSnapshot(data.serverNow, data.activeEvents || []);
    if (!rankedQueueIsActive()) {
      state.rankedQueue.bet = Math.max(1, Math.floor(Number(data.user?.rankedFixedBet || data.user?.rankedBetMin || state.rankedQueue.bet || 50)));
    }
    state.bankrollDisplay = data.user?.chips ?? 0;
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
    const activeIds = new Set(state.notifications.map((item) => item.id));
    state.notificationFriendRequestStatus = Object.fromEntries(
      Object.entries(state.notificationFriendRequestStatus).filter(([notifId]) => activeIds.has(notifId))
    );
    applyChallengesPayload(data.challenges, data.challengeResets, {
      hourlyResetAt: data.hourlyResetAt,
      dailyResetAt: data.dailyResetAt,
      weeklyResetAt: data.weeklyResetAt,
      skillResetAt: data.skillResetAt,
      nextDailyResetAt: data.nextDailyResetAt,
      nextWeeklyResetAt: data.nextWeeklyResetAt,
      nextSkillResetAt: data.nextSkillResetAt,
      skillPoolSize: data.skillPoolSize,
      activeSkillCount: data.activeSkillCount
    });
    state.freeClaimed = !Boolean(data.freeClaimAvailable);
    state.freeClaimedAt = null;
    state.freeClaimNextAt = data.freeClaimNextAt || null;
    if (state.me) {
      state.me.streakCount = data.streakCount ?? state.me.streakCount ?? 0;
      state.me.nextStreakReward = data.nextStreakReward ?? state.me.nextStreakReward ?? 50;
    }
    if (data.rankedQueue?.status === 'searching') {
      state.rankedQueue.searching = true;
      state.rankedQueue.status = 'searching';
      state.rankedQueue.queuedAt = data.rankedQueue.queuedAt || null;
      if (Number.isFinite(Number(data.rankedQueue.fixedBet || data.rankedQueue.requestedBet))) {
        state.rankedQueue.bet = Math.floor(Number(data.rankedQueue.fixedBet || data.rankedQueue.requestedBet));
      }
    }
    updateFreeClaimCountdown();
    if (typeof data.user?.selectedBet === 'number') {
      const fallback = Number.isFinite(Number(data.user.selectedBet)) ? Math.max(1, Math.floor(Number(data.user.selectedBet))) : 5;
      const key = getBetStorageKey(data.user.id);
      const local = sanitizeInt(localStorage.getItem(key));
      const validLocal = Number.isInteger(local) && local >= 1 && local <= 10_000_000;
      state.currentBet = validLocal ? local : fallback;
      state.betInputDraft = '';
      localStorage.setItem(key, String(state.currentBet));
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
    await loadLeaderboard({ silent: true });
    await loadRankedOverview({ silent: true });
    render();
  } catch (e) {
    const msg = String(e?.message || '');
    const offlineLike = !navigator.onLine || /failed to fetch|network|timeout|aborted/i.test(msg);
    if (offlineLike) {
      state.network.offlineMode = true;
      if (!state.me) {
        state.authNotice = 'Offline mode available. Play bot matches locally.';
      }
      render();
      return;
    }
    resetQuickPlayState();
    resetRankedQueueState();
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
    state.notificationFriendRequestStatus = {};
    state.incomingFriendChallenges = [];
    state.outgoingFriendChallenges = [];
    state.serverClockOffsetMs = 0;
    state.activeEvents = [];
    state.eventDetailsModalId = null;
    state.challenges = { hourly: [], daily: [], weekly: [], skill: [] };
    state.challengeMeta = { skillPoolSize: 0, activeSkillCount: 0 };
    state.challengeResets = { hourly: null, daily: null, weekly: null, skill: null };
    state.challengeResetRemainingMs = { hourly: 0, daily: 0, weekly: 0, skill: 0 };
    state.challengeResetRefreshInFlight = false;
    state.challengeClaimPendingById = {};
    clearBotMatchLaunchState({ renderNow: false });
    state.freeClaimed = false;
    state.freeClaimedAt = null;
    state.freeClaimNextAt = null;
    state.freeClaimRemainingMs = 0;
    state.patchNotes = FALLBACK_PATCH_NOTES;
    state.patchNotesDeploy = null;
    state.appVersion = 'dev';
    state.homeSections = { highRoller: false, practice: false };
    state.leaderboard = { rows: [], currentUserRank: null, totalUsers: 0, loading: false };
    state.leaderboardExpanded = false;
    state.rankedOverview = null;
    state.favoriteStatModalOpen = false;
    state.favoriteStatDraftKey = '';
    state.favoriteStatFilter = '';
    state.titleInfoModalKey = '';
    state.profileSections = { identity: true, progress: true, borders: false, social: true, titles: false, security: false };
    state.profileTitlePickerOpen = false;
    state.profileTitleDraftKey = '';
    state.profileTitleModalOriginKey = '';
    state.profileTitleSearch = '';
    state.profileTitleOwnershipFilter = 'ALL';
    state.profileTitleCategoryFilter = 'ALL';
    state.profileSaving = false;
    state.profileBorderSavingId = '';
    state.rankTimelineModalOpen = false;
    state.rankedForfeitModalOpen = false;
    state.pendingSeriesResult = null;
    state.rankedSeriesResultModal = null;
    state.rankedSeriesResultAnimKey = '';
    if (Number.isFinite(state.rankedSeriesResultAnimRaf)) cancelAnimationFrame(state.rankedSeriesResultAnimRaf);
    state.rankedSeriesResultAnimRaf = null;
    if (Number.isFinite(state.xpUi.animRaf)) cancelAnimationFrame(state.xpUi.animRaf);
    state.xpUi.animRaf = null;
    render();
  }
}

function clearQuery() {
  history.replaceState({}, '', window.location.pathname);
}

function goToView(view) {
  if (state.view !== view) {
    state.rankTimelineModalOpen = false;
    state.rankedForfeitModalOpen = false;
    if (view !== 'profile') {
      state.favoriteStatModalOpen = false;
      state.favoriteStatDraftKey = '';
      state.favoriteStatFilter = '';
      state.titleInfoModalKey = '';
      state.profileTitlePickerOpen = false;
      state.profileTitleDraftKey = '';
      state.profileTitleModalOriginKey = '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
    }
  }
  state.view = view;
  state.error = '';
  if (view === 'notifications') {
    markNotificationsSeen();
  }
  const routes = {
    home: '/',
    profile: '/profile',
    friends: '/friends',
    lobbies: '/lobbies',
    ranked: '/ranked',
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

function isBotMatchActive() {
  if (!state.currentMatch || !state.me) return false;
  const oppId = state.currentMatch.playerIds?.find((id) => id !== state.me.id);
  return Boolean(oppId && state.currentMatch.participants?.[oppId]?.isBot);
}

function canUseDoubleOrNothingInMatch(match = state.currentMatch) {
  if (!match) return false;
  const matchType = String(match.matchType || '').trim().toUpperCase();
  const opponentId = match.playerIds?.find((id) => id !== state.me?.id);
  const botOpponent = Boolean(opponentId && match.participants?.[opponentId]?.isBot);
  if (botOpponent) return false;
  if (matchType === 'RANKED') return false;
  return matchType === 'QUICKPLAY' || matchType === 'FRIEND_CHALLENGE';
}

async function forfeitBotMatch({ showToast = false, refreshOnError = true } = {}) {
  if (!state.currentMatch || !isBotMatchActive()) return false;
  const matchId = state.currentMatch.id;
  try {
    const data = await api(`/api/matches/${encodeURIComponent(matchId)}/forfeit`, { method: 'POST' });
    if (showToast) {
      pushToast(data?.forfeited ? 'You forfeited the match.' : 'Returned to lobby.');
    }
    return true;
  } catch (e) {
    console.error('Bot forfeit request failed:', e);
    pushToast('Could not confirm forfeit. Refreshing balance.');
    if (refreshOnError) {
      loadMe().catch((err) => console.warn('Balance refresh failed after forfeit error:', err));
    }
    return false;
  }
}

function leaveCurrentMatch(options = {}) {
  if (!state.currentMatch) return;
  if (isOfflineMatchActive()) {
    updateOfflineProfileFromMatch();
    state.currentMatch = null;
    state.currentLobby = null;
    state.leaveMatchModal = false;
    goToView('home');
    if (options.showToast) pushToast('Left offline bot match.');
    render();
    return;
  }
  if (isBotMatchActive()) {
    forfeitBotMatch(options);
    return;
  }
  emitLeaveMatch();
}

function navigateWithMatchSafety(view) {
  if (!state.currentMatch || !state.me || view === 'match') {
    goToView(view);
    if (view === 'friends') loadFriendsData();
    if (view === 'ranked') loadRankedOverview({ silent: true });
    render();
    return;
  }
  if (!isBotMatchActive()) {
    goToView(view);
    if (view === 'friends') loadFriendsData();
    if (view === 'ranked') loadRankedOverview({ silent: true });
    render();
    return;
  }
  if (isOfflineMatchActive()) {
    state.currentMatch = null;
    state.currentLobby = null;
    state.leaveMatchModal = false;
    goToView(view);
    if (view === 'friends') loadFriendsData();
    if (view === 'ranked') loadRankedOverview({ silent: true });
    render();
    return;
  }
  state.pendingNavAfterLeave = view;
  leaveCurrentMatch({ showToast: true, refreshOnError: true });
  setTimeout(() => {
    if (!state.pendingNavAfterLeave) return;
    const target = state.pendingNavAfterLeave;
    state.pendingNavAfterLeave = null;
    state.currentMatch = null;
    state.currentLobby = null;
    state.leaveMatchModal = false;
    goToView(target);
    if (target === 'friends') loadFriendsData();
    if (target === 'ranked') loadRankedOverview({ silent: true });
    render();
  }, 800);
}

function openActionConfirm(action, hand) {
  if (action === 'double') {
    state.confirmActionModal = {
      action,
      title: 'Confirm Double?',
      body: `Bet ${hand.bet} -> ${hand.bet * 2}. This adds pressure to the opponent.`
    };
  } else if (action === 'split') {
    state.confirmActionModal = {
      action,
      title: 'Confirm Split?',
      body: `This creates a second hand and adds +${hand.bet} pressure to the opponent.`
    };
  }
  render();
}

function canTriggerAction(action) {
  const match = state.currentMatch;
  const me = state.me;
  if (!match || !me || state.view !== 'match') return false;
  if (match.phase !== 'ACTION_TURN') return false;
  if (match.currentTurn !== me.id) return false;
  if (match.pendingPressure) return false;
  const myState = match.players?.[me.id];
  const hand = myState?.hands?.[myState.activeHandIndex || 0];
  if (!hand || hand.locked || hand.bust || hand.surrendered || hand.stood) return false;
  if (action === 'hit' && (hand.doubleCount || 0) >= 1) return false;
  if (action === 'split' && !handCanSplit(hand, myState?.hands?.length || 0, match.maxHandsPerPlayer || 4)) return false;
  if (action === 'double' && (hand.doubleCount || 0) >= (match.maxDoublesPerHand || 1)) return false;
  if (action === 'surrender' && (hand.actionCount || 0) > 0) return false;
  return true;
}

function triggerAction(action) {
  if (!canTriggerAction(action)) return;
  const myState = state.currentMatch.players[state.me.id];
  const hand = myState.hands[myState.activeHandIndex || 0];
  if (action === 'double' || action === 'split') {
    openActionConfirm(action, hand);
    return;
  }
  emitAction(action);
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function isTenTenPair(hand) {
  return Boolean(hand?.cards?.length === 2 && hand.cards[0]?.rank === '10' && hand.cards[1]?.rank === '10');
}

function handCanSplit(hand, handCount = 0, maxHands = 4, splitTensEventActive = isSplitTensEventActiveClient()) {
  if (!hand) return false;
  if (hand.cards.length !== 2) return false;
  if ((hand.splitDepth || 0) >= 3) return false;
  if (handCount >= maxHands) return false;
  if (!hand.cards[0].rank || !hand.cards[1].rank || hand.cards[0].rank !== hand.cards[1].rank) return false;
  if (isTenTenPair(hand) && !splitTensEventActive) return false;
  return true;
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

function userLikeById(id) {
  if (!id) return null;
  if (state.me?.id === id) return state.me;
  const friend = (state.friends || []).find((entry) => entry.id === id);
  if (friend) return friend;
  const leaderboardRow = (state.leaderboard?.rows || []).find((row) => row.userId === id);
  if (leaderboardRow) return leaderboardRow;
  return null;
}

function emitAction(action) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!normalizedAction) return;
  if (isOfflineMatchActive()) {
    const result = applyOfflineMatchAction(normalizedAction);
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:action', { matchId: state.currentMatch.id, action: normalizedAction });
}

function emitPressureDecision(decision) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:pressureDecision', { matchId: state.currentMatch.id, decision });
}

function emitSetBaseBet(amount) {
  if (isOfflineMatchActive()) {
    const result = applyOfflineBetSelection(amount);
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:setBaseBet', { matchId: state.currentMatch.id, amount });
}

function emitConfirmBet() {
  if (isOfflineMatchActive()) {
    const result = confirmOfflineBet();
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:confirmBet', { matchId: state.currentMatch.id });
}

function emitBetResponse(action, amount = null) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:respondBet', { matchId: state.currentMatch.id, action, amount });
}

function emitResetBetNegotiation() {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:resetBetNegotiation', { matchId: state.currentMatch.id });
}

function emitNextRoundChoice() {
  if (isOfflineMatchActive()) {
    const result = chooseOfflineRoundResult('next');
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:nextRound', { matchId: state.currentMatch.id });
}

function emitChangeBetChoice() {
  if (isOfflineMatchActive()) {
    const result = chooseOfflineRoundResult('betting');
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:changeBet', { matchId: state.currentMatch.id });
}

function emitDoubleOrNothing() {
  if (isOfflineMatchActive()) {
    const result = chooseOfflineRoundResult('double');
    if (result?.error) setError(result.error);
    render();
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:doubleOrNothing', { matchId: state.currentMatch.id });
}

function emitLeaveMatch() {
  if (isOfflineMatchActive()) {
    leaveCurrentMatch({ showToast: true });
    return;
  }
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:leave', { matchId: state.currentMatch.id });
}

function emitEmote(type, value) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('game:emote', { matchId: state.currentMatch.id, type, value });
}

function emitMatchChat(text) {
  if (!state.currentMatch || !state.socket) return;
  state.socket.emit('match:chat', { matchId: state.currentMatch.id, text });
}

function getBetStorageKey(userId = state.me?.id) {
  return userId ? `bb_last_bet_${userId}` : '';
}

function sanitizeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function getBetBounds(match = state.currentMatch) {
  const min = Math.max(1, sanitizeInt(match?.minBet) || 5);
  const maxCap = Math.max(min, sanitizeInt(match?.maxBetCap) || 500);
  const bankroll = sanitizeInt(match?.players?.[state.me?.id]?.bankroll ?? state.me?.chips);
  if (!Number.isFinite(bankroll) || bankroll === null) {
    return { min, max: maxCap };
  }
  return { min, max: Math.max(min, Math.min(maxCap, bankroll)) };
}

function clampBetValue(value, bounds = getBetBounds()) {
  const parsed = sanitizeInt(value);
  if (!Number.isFinite(parsed) || parsed === null) return null;
  return Math.max(bounds.min, Math.min(bounds.max, parsed));
}

function isValidBetValue(value, bounds = getBetBounds()) {
  const parsed = sanitizeInt(value);
  if (!Number.isInteger(parsed)) return false;
  return parsed >= bounds.min && parsed <= bounds.max;
}

function persistBetValue(value) {
  const key = getBetStorageKey();
  if (!key) return;
  localStorage.setItem(key, String(value));
}

function applyBetValue(nextValue, { emit = true, renderNow = true, showResetToast = false } = {}) {
  const match = state.currentMatch;
  if (!match) return false;
  const bounds = getBetBounds(match);
  const clamped = clampBetValue(nextValue, bounds);
  if (!Number.isInteger(clamped)) {
    state.currentBet = bounds.min;
    state.betInputDraft = '';
    persistBetValue(bounds.min);
    if (showResetToast) pushToast('Bet reset');
    if (emit && match.canEditBet) emitSetBaseBet(bounds.min);
    if (renderNow) render();
    return false;
  }
  const changed = state.currentBet !== clamped;
  state.currentBet = clamped;
  state.betInputDraft = '';
  persistBetValue(clamped);
  if (changed && emit && match.canEditBet) emitSetBaseBet(clamped);
  if (renderNow) render();
  return true;
}

function commitBetDraft({ renderNow = true } = {}) {
  if (!state.currentMatch) return;
  const draft = String(state.betInputDraft || '').trim();
  if (draft === '') {
    state.betInputDraft = '';
    if (renderNow) {
      render();
    } else {
      const confirmBtn = document.getElementById('confirmBetBtn');
      if (confirmBtn) {
        const bounds = getBetBounds(state.currentMatch);
        confirmBtn.disabled = !state.currentMatch.canConfirmBet || !isValidBetValue(state.currentBet, bounds);
      }
    }
    return;
  }
  applyBetValue(draft, { emit: true, renderNow, showResetToast: true });
  if (!renderNow) {
    const confirmBtn = document.getElementById('confirmBetBtn');
    if (confirmBtn) {
      const bounds = getBetBounds(state.currentMatch);
      confirmBtn.disabled = !state.currentMatch.canConfirmBet || !isValidBetValue(state.currentBet, bounds);
    }
  }
}

function resetBetStateToLobby() {
  const key = getBetStorageKey();
  if (key) localStorage.removeItem(key);
  const staleBetKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith('bb_last_bet_')) staleBetKeys.push(k);
  }
  staleBetKeys.forEach((k) => localStorage.removeItem(k));
  state.betInputDraft = '';
  state.currentBet = 5;
  if (state.currentMatch) leaveCurrentMatch({ showToast: false, refreshOnError: true });
  state.currentMatch = null;
  state.currentLobby = null;
  state.leaveMatchModal = false;
  goToView('lobbies');
  pushToast('Bet state reset');
  render();
}

function adjustBet(delta) {
  if (!state.currentMatch) return;
  if (!state.currentMatch.canEditBet) return;
  const bounds = getBetBounds(state.currentMatch);
  const base = isValidBetValue(state.currentBet, bounds) ? sanitizeInt(state.currentBet) : bounds.min;
  if (!isValidBetValue(state.currentBet, bounds)) {
    pushToast('Bet reset');
  }
  applyBetValue(base + Number(delta || 0), { emit: true, renderNow: true });
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
  if (state.profileSaving) return;
  const avatarStyle = form.querySelector('[name="avatar_style"]').value.trim();
  const avatarSeed = form.querySelector('[name="avatar_seed"]').value.trim();
  const selectedDeckSkin = normalizeDeckSkinId(form.querySelector('[name="selected_deck_skin"]')?.value || 'CLASSIC');
  const customStatText = String(form.querySelector('[name="custom_stat_text"]')?.value || '').slice(0, 120);
  const selectedTitle = String(form.querySelector('[name="selected_title"]')?.value || '').trim();
  const saveBtn = form.querySelector('#saveProfileBtn');
  const saveBtnText = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>Saving...';
  }
  state.profileSaving = true;
  try {
    const profileData = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ avatarStyle, avatarSeed })
    });
    const customStatData = await api('/api/profile/custom-stat', {
      method: 'PATCH',
      body: JSON.stringify({ customStatText })
    });
    const deckSkinData = await api('/api/profile/deck-skin', {
      method: 'PATCH',
      body: JSON.stringify({ selectedDeckSkin })
    });
    const titleData = await api('/api/profile/title', {
      method: 'PATCH',
      body: JSON.stringify({ selectedTitle })
    });
    const updatedUser = titleData?.user || deckSkinData?.user || customStatData?.user || profileData?.user || null;
    if (updatedUser) {
      state.me = { ...state.me, ...updatedUser };
    }
    state.favoriteStatModalOpen = false;
    state.favoriteStatDraftKey = '';
    state.favoriteStatFilter = '';
    pushToast('Profile saved.');
    loadLeaderboard({ silent: true });
  } catch (e) {
    setError(e.message);
  } finally {
    state.profileSaving = false;
    if (state.view === 'profile') {
      render();
    } else if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = saveBtnText;
    }
  }
}

async function saveFavoriteStatPreference(nextKey) {
  if (!state.me) return;
  const favoriteStatKey = normalizeFavoriteStatKey(nextKey);
  try {
    const data = await api('/api/profile/favorite-stat', {
      method: 'PATCH',
      body: JSON.stringify({ favoriteStatKey })
    });
    state.me = data?.user || { ...state.me, favoriteStatKey };
    state.favoriteStatModalOpen = false;
    state.favoriteStatDraftKey = '';
    state.favoriteStatFilter = '';
    setStatus('Favorite stat updated.');
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function equipProfileBorder(borderId) {
  if (!state.me || state.profileBorderSavingId) return;
  const requested = normalizeProfileBorderIdClient(borderId);
  if (!requested) return;
  const previous = state.me.selectedBorderId || 'NONE';
  state.profileBorderSavingId = requested;
  state.me = { ...state.me, selectedBorderId: requested };
  render();
  try {
    const data = await api('/api/profile/border', {
      method: 'PATCH',
      body: JSON.stringify({ selectedBorderId: requested })
    });
    if (data?.user) {
      state.me = { ...state.me, ...data.user };
    } else {
      state.me = { ...state.me, selectedBorderId: requested };
    }
    pushToast('Profile border equipped.');
  } catch (e) {
    state.me = { ...state.me, selectedBorderId: previous };
    setError(e.message);
  } finally {
    state.profileBorderSavingId = '';
    if (state.view === 'profile') render();
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

async function createHighRollerLobby() {
  if (!guardHighRollerAccess()) return;
  try {
    const data = await api('/api/lobbies/create', {
      method: 'POST',
      body: JSON.stringify({ stakeType: 'REAL', matchType: 'HIGH_ROLLER' })
    });
    state.currentLobby = data.lobby;
    goToView('lobbies');
    setStatus(`High Roller lobby ready: ${data.lobby.id}`);
    state.socket?.emit('lobby:watch', data.lobby.id);
    render();
  } catch (e) {
    if (/high roller unlocks at/i.test(String(e?.message || ''))) {
      pushToast(HIGH_ROLLER_UNLOCK_MESSAGE);
    }
    setError(e.message);
  }
}

async function cancelLobby(lobbyId) {
  try {
    await api('/api/lobbies/cancel', {
      method: 'POST',
      body: JSON.stringify({ lobbyId })
    });
    state.currentLobby = null;
    state.lobbyJoinInput = '';
    goToView('lobbies');
    setStatus('Lobby cancelled.');
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

function applyFriendsPayload(data = {}) {
  state.friends = data.friends || [];
  state.incomingRequests = data.incoming || [];
  state.outgoingRequests = data.outgoing || [];
  state.incomingFriendChallenges = data.incomingChallenges || [];
  state.outgoingFriendChallenges = data.outgoingChallenges || [];
}

async function loadFriendsData() {
  if (!state.token) {
    state.friends = [];
    state.incomingRequests = [];
    state.outgoingRequests = [];
    state.incomingFriendChallenges = [];
    state.outgoingFriendChallenges = [];
    render();
    return;
  }
  try {
    const data = await api('/api/friends/list');
    applyFriendsPayload(data);
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
    applyFriendsPayload(data);
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
    applyFriendsPayload(data);
    pushToast('Friend request declined.');
  } catch (e) {
    setError(e.message);
  }
}

async function inviteFriendToLobby(username, stakeType = 'FAKE') {
  try {
    const data = await api('/api/lobbies/invite', {
      method: 'POST',
      body: JSON.stringify({ username, stakeType })
    });
    state.currentLobby = data.lobby;
    goToView('lobbies');
    state.socket?.emit('lobby:watch', data.lobby.id);
    pushToast(`${stakeType === 'REAL' ? 'Challenge' : 'Friendly'} invite sent to ${username}.`);
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
    state.notificationFriendRequestStatus = {};
    render();
  } catch (e) {
    setError(e.message);
  }
}

async function refreshNotifications() {
  if (!state.token) return;
  try {
    const data = await api('/api/notifications');
    state.notifications = data.notifications || [];
    const activeIds = new Set(state.notifications.map((item) => item.id));
    state.notificationFriendRequestStatus = Object.fromEntries(
      Object.entries(state.notificationFriendRequestStatus).filter(([notifId]) => activeIds.has(notifId))
    );
  } catch (e) {
    console.warn('Failed to refresh notifications:', e);
  }
}

async function markNotificationsSeen(ids = null) {
  if (!state.token) return;
  try {
    const payload = Array.isArray(ids) && ids.length ? { ids } : {};
    const data = await api('/api/notifications/seen', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.notifications = data.notifications || [];
    const activeIds = new Set(state.notifications.map((item) => item.id));
    state.notificationFriendRequestStatus = Object.fromEntries(
      Object.entries(state.notificationFriendRequestStatus).filter(([notifId]) => activeIds.has(notifId))
    );
  } catch (e) {
    console.warn('Failed to mark notifications seen:', e);
  }
}

function getNotificationRequestId(notification) {
  if (!notification || notification.type !== 'friend_request') return '';
  if (notification.requestId) return String(notification.requestId);
  if (notification.action?.data?.requestId) return String(notification.action.data.requestId);
  const fromUserId = notification.fromUserId || notification.action?.data?.fromUserId;
  if (fromUserId) {
    const match = (state.incomingRequests || []).find((request) => request.fromUserId === fromUserId);
    if (match?.id) return match.id;
  }
  const senderFromMessage = String(notification.message || '').match(/^(.+?) sent you a friend request/i)?.[1]?.trim();
  if (senderFromMessage) {
    const usernameMatch = (state.incomingRequests || []).find((request) => request.username === senderFromMessage);
    if (usernameMatch?.id) return usernameMatch.id;
  }
  return '';
}

function resolveFriendRequestStatusLabel(status) {
  if (status === 'accepted') return 'Accepted';
  if (status === 'declined') return 'Declined';
  if (status === 'resolved') return 'Resolved';
  return '';
}

function renderFriendRequestNotificationActions(notification) {
  if (!notification || notification.type !== 'friend_request') return '';
  const notifId = notification.id;
  const status = state.notificationFriendRequestStatus[notifId] || '';
  const requestId = getNotificationRequestId(notification);
  const disabled = status === 'accepting' || status === 'declining' || !requestId;
  const resolvedLabel = resolveFriendRequestStatusLabel(status);
  if (resolvedLabel) {
    return `<div class="row"><button class="ghost" type="button" disabled>${resolvedLabel}</button></div>`;
  }
  return `<div class="row">
      <button class="primary" type="button" data-notif-fr-accept="${notifId}" ${disabled ? 'disabled' : ''}>
        ${status === 'accepting' ? 'Accepting…' : 'Accept'}
      </button>
      <button class="warn" type="button" data-notif-fr-decline="${notifId}" ${disabled ? 'disabled' : ''}>
        ${status === 'declining' ? 'Declining…' : 'Decline'}
      </button>
    </div>`;
}

function renderNotificationActions(notification) {
  if (!notification) return '';
  if (notification.type === 'friend_challenge') {
    return `<div class="row">
      <button class="primary" data-notif-ch-accept="${notification.action?.data?.challengeId || ''}">Accept</button>
      <button class="warn" data-notif-ch-decline="${notification.action?.data?.challengeId || ''}">Decline</button>
    </div>`;
  }
  if (notification.type === 'friend_request') {
    return renderFriendRequestNotificationActions(notification);
  }
  if (notification.action) {
    return `<button data-notif-action="${notification.id}" class="primary">${notification.action.label || 'Open'}</button>`;
  }
  return '';
}

async function acceptRequestFromNotification(notificationId) {
  const notification = (state.notifications || []).find((entry) => entry.id === notificationId);
  if (!notification || notification.type !== 'friend_request') return;
  const requestId = getNotificationRequestId(notification);
  if (!requestId) {
    pushToast('Friend request data is missing. Refreshing...');
    await Promise.all([loadFriendsData(), refreshNotifications()]);
    render();
    return;
  }
  const existing = state.notificationFriendRequestStatus[notificationId];
  if (existing === 'accepting' || existing === 'accepted' || existing === 'resolved') return;
  state.notificationFriendRequestStatus[notificationId] = 'accepting';
  render();
  try {
    const data = await api(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST'
    });
    state.notificationFriendRequestStatus[notificationId] = 'accepted';
    applyFriendsPayload(data);
    pushToast(data.message || 'Friend request accepted.');
    await refreshNotifications();
    render();
  } catch (e) {
    const message = String(e.message || '');
    if (/already|not found/i.test(message)) {
      state.notificationFriendRequestStatus[notificationId] = 'resolved';
      pushToast('Friend request already handled.');
      await Promise.all([loadFriendsData(), refreshNotifications()]);
      render();
      return;
    }
    delete state.notificationFriendRequestStatus[notificationId];
    setError(e.message);
    render();
  }
}

async function declineRequestFromNotification(notificationId) {
  const notification = (state.notifications || []).find((entry) => entry.id === notificationId);
  if (!notification || notification.type !== 'friend_request') return;
  const requestId = getNotificationRequestId(notification);
  if (!requestId) {
    pushToast('Friend request data is missing. Refreshing...');
    await Promise.all([loadFriendsData(), refreshNotifications()]);
    render();
    return;
  }
  const existing = state.notificationFriendRequestStatus[notificationId];
  if (existing === 'declining' || existing === 'declined' || existing === 'resolved') return;
  state.notificationFriendRequestStatus[notificationId] = 'declining';
  render();
  try {
    const data = await api(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, {
      method: 'POST'
    });
    state.notificationFriendRequestStatus[notificationId] = 'declined';
    applyFriendsPayload(data);
    pushToast(data.message || 'Friend request declined.');
    await refreshNotifications();
    render();
  } catch (e) {
    const message = String(e.message || '');
    if (/already|not found/i.test(message)) {
      state.notificationFriendRequestStatus[notificationId] = 'resolved';
      pushToast('Friend request already handled.');
      await Promise.all([loadFriendsData(), refreshNotifications()]);
      render();
      return;
    }
    delete state.notificationFriendRequestStatus[notificationId];
    setError(e.message);
    render();
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

async function joinQuickPlayQueue({ bucket = null, silent = false } = {}) {
  if (!state.token || !state.me) return;
  if (offlineModeEnabled()) return setError('Quick Play requires an online connection.');
  if (state.currentMatch) {
    setError('Leave your current match before joining Quick Play.');
    return;
  }
  if (rankedQueueIsActive()) {
    setError('Cancel ranked matchmaking first.');
    return;
  }
  if (quickPlayIsActive()) return;
  const selectedBucket =
    normalizeQuickPlayBucketValue(bucket) ||
    normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) ||
    250;
  clearQuickPlayConnectTimer();
  state.quickPlay = {
    status: 'searching',
    bucket: selectedBucket,
    selectedBucket,
    bucketPickerOpen: false,
    queuePosition: null,
    queuedAt: new Date().toISOString(),
    opponentName: '',
    matchId: null,
    pendingMatch: null
  };
  goToView('home');
  render();
  try {
    const data = await api('/api/matchmaking/join', {
      method: 'POST',
      body: JSON.stringify({ bucket: selectedBucket })
    });
    if (data?.status === 'found') {
      beginQuickPlayConnectedState(data);
      render();
      return;
    }
    const responseBucket = normalizeQuickPlayBucketValue(data?.bucket) || selectedBucket;
    state.quickPlay.status = 'searching';
    state.quickPlay.bucket = responseBucket;
    state.quickPlay.selectedBucket = responseBucket;
    state.quickPlay.queuePosition = Number.isFinite(Number(data?.queuePosition)) ? Number(data.queuePosition) : null;
    state.quickPlay.queuedAt = data?.queuedAt || state.quickPlay.queuedAt;
    if (!silent) setStatus(`Searching Quick Play $${formatQuickPlayBucket(responseBucket)} queue...`);
    render();
  } catch (e) {
    resetQuickPlayState();
    setError(e.message);
  }
}

async function cancelQuickPlayQueue({ silent = false } = {}) {
  if (!quickPlayIsActive()) return;
  const wasConnected = state.quickPlay.status === 'connected';
  const bucket = state.quickPlay.bucket;
  try {
    await api('/api/matchmaking/cancel', { method: 'POST' });
  } catch {
    // queue is best-effort for client cancellation
  }
  resetQuickPlayState();
  if (!silent) {
    const bucketText = normalizeQuickPlayBucketValue(bucket) ? ` $${formatQuickPlayBucket(bucket)}` : '';
    setStatus(wasConnected ? `Matchmaking${bucketText} cancelled.` : `Stopped searching${bucketText}.`);
  } else {
    render();
  }
}

async function joinRankedQueue({ continueSeries = false } = {}) {
  if (!state.token || !state.me) return;
  if (offlineModeEnabled()) {
    return setError('Ranked requires an online connection.');
  }
  if (state.currentMatch) {
    return setError('Leave your current match before joining ranked.');
  }
  if (quickPlayIsActive()) {
    return setError('Cancel Quick Play first.');
  }
  if (rankedQueueIsActive()) return;
  rankedClientLog('QUEUE_CLICK', { continueSeries, view: state.view });
  const selected = Math.max(
    1,
    Math.floor(Number(state.rankedOverview?.fixedBet || state.me.rankedFixedBet || state.me.rankedBetMin || 50))
  );
  if (Math.floor(Number(state.me?.chips) || 0) < selected) {
    return setError(`Need at least ${selected.toLocaleString()} chips to queue ranked.`);
  }
  state.rankedQueue.searching = true;
  state.rankedQueue.connected = false;
  state.rankedQueue.status = 'searching';
  state.rankedQueue.bet = selected;
  state.rankedQueue.queuedAt = new Date().toISOString();
  rankedClientLog('QUEUE_REQUEST_START', { selectedBet: selected, continueSeries });
  render();
  try {
    const data = await api('/api/ranked/join', {
      method: 'POST',
      body: JSON.stringify({ bet: selected, continueSeries: Boolean(continueSeries) })
    });
    rankedClientLog('QUEUE_REQUEST_RESPONSE', { status: data?.status || null, queuedAt: data?.queuedAt || null });
    if (data?.status === 'found') {
      beginRankedConnectedState(data);
      render();
      return;
    }
    state.rankedQueue.searching = true;
    state.rankedQueue.status = 'searching';
    state.rankedQueue.queuedAt = data?.queuedAt || state.rankedQueue.queuedAt;
    state.rankedQueue.bet = Number.isFinite(Number(data?.fixedBet || data?.bet)) ? Math.floor(Number(data.fixedBet || data.bet)) : selected;
    await loadRankedOverview({ silent: true });
    setStatus('Searching for ranked opponent...');
    render();
  } catch (e) {
    rankedClientLog('QUEUE_REQUEST_ERROR', { message: e.message });
    resetRankedQueueState();
    loadRankedOverview({ silent: true });
    pushToast(`Could not queue ranked: ${e.message}`);
    setError(e.message);
  }
}

async function cancelRankedQueue({ silent = false } = {}) {
  if (!rankedQueueIsActive()) return;
  rankedClientLog('QUEUE_CANCEL_REQUEST', { silent });
  try {
    await api('/api/ranked/cancel', { method: 'POST' });
  } catch {
    // best effort
  }
  rankedClientLog('QUEUE_CANCELLED', {});
  resetRankedQueueState();
  loadRankedOverview({ silent: true });
  if (!silent) setStatus('Stopped ranked matchmaking.');
  else render();
}

async function startBotMatch(options = {}) {
  const allowOfflineFallback = Boolean(options.allowOfflineFallback);
  if (offlineModeEnabled()) {
    if (!allowOfflineFallback) {
      return setError('Bot matchmaking requires an online connection.');
    }
    startOfflineBotMatch();
    return;
  }
  const highRoller = Boolean(options.highRoller);
  const matchMode = String(options.matchMode || '').trim().toLowerCase();
  const economyMode = String(options.economyMode || '').trim().toLowerCase();
  const forcePractice = matchMode === 'practice' || economyMode === 'no_delta';
  const stakeType = forcePractice ? 'FAKE' : (options.stakeType || (highRoller ? 'REAL' : state.botStakeType));
  if (highRoller && !guardHighRollerAccess()) return;
  const launchMode = forcePractice ? 'practice' : (highRoller ? 'high-roller' : 'real');
  if (!beginBotMatchLaunchState(launchMode)) return;
  try {
    const data = await api('/api/lobbies/bot', {
      method: 'POST',
      body: JSON.stringify({
        difficulty: state.selectedBotDifficulty,
        stakeType,
        matchMode: forcePractice ? 'practice' : undefined,
        economyMode: forcePractice ? 'no_delta' : undefined,
        highRoller,
        matchType: highRoller ? 'HIGH_ROLLER' : undefined
      })
    });
    clearBotMatchLaunchState({ renderNow: false });
    state.currentLobby = null;
    state.currentMatch = data.match;
    goToView('match');
    setStatus(`${forcePractice || stakeType !== 'REAL' ? 'Practice' : 'Real-chip'} bot match started (${state.selectedBotDifficulty})${highRoller ? ' • High Roller' : ''}.`);
    render();
  } catch (e) {
    clearBotMatchLaunchState({ renderNow: state.view === 'home' });
    if (/high roller unlocks at/i.test(String(e?.message || ''))) {
      pushToast(HIGH_ROLLER_UNLOCK_MESSAGE);
    }
    setError(e.message);
  }
}

async function startPracticeBotMatch() {
  await startBotMatch({
    stakeType: 'FAKE',
    matchMode: 'practice',
    economyMode: 'no_delta'
  });
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
    applyEventsSnapshot(data.serverNow, data.activeEvents || state.activeEvents);
    applyChallengesPayload(data.challenges, data.challengeResets, {
      hourlyResetAt: data.hourlyResetAt,
      dailyResetAt: data.dailyResetAt,
      weeklyResetAt: data.weeklyResetAt,
      skillResetAt: data.skillResetAt,
      nextDailyResetAt: data.nextDailyResetAt,
      nextWeeklyResetAt: data.nextWeeklyResetAt,
      nextSkillResetAt: data.nextSkillResetAt,
      skillPoolSize: data.skillPoolSize,
      activeSkillCount: data.activeSkillCount
    });
    render();
  } catch (e) {
    setError(e.message);
  }
}

function getChallengeEntryById(challengeId) {
  const groups = state.challenges || {};
  for (const tier of Object.keys(groups)) {
    const list = Array.isArray(groups[tier]) ? groups[tier] : [];
    const index = list.findIndex((item) => String(item?.id || '') === String(challengeId || ''));
    if (index >= 0) {
      return { tier, index, challenge: list[index] };
    }
  }
  return null;
}

function setChallengeEntryById(challengeId, nextChallenge) {
  const entry = getChallengeEntryById(challengeId);
  if (!entry) return false;
  state.challenges[entry.tier][entry.index] = nextChallenge;
  return true;
}

async function claimChallenge(id) {
  const challengeId = String(id || '').trim();
  if (!challengeId) return;
  if (state.challengeClaimPendingById[challengeId]) return;
  const entry = getChallengeEntryById(challengeId);
  const original = entry?.challenge ? { ...entry.challenge } : null;
  state.challengeClaimPendingById[challengeId] = true;
  if (entry?.challenge) {
    setChallengeEntryById(challengeId, {
      ...entry.challenge,
      claimed: true,
      claimedAt: entry.challenge.claimedAt || new Date().toISOString(),
      completedAt: entry.challenge.completedAt || new Date().toISOString()
    });
  }
  render();
  try {
    const data = await api('/api/challenges/claim', {
      method: 'POST',
      body: JSON.stringify({ id: challengeId })
    });
    if (entry?.challenge) {
      setChallengeEntryById(challengeId, {
        ...state.challenges[entry.tier][entry.index],
        claimed: true,
        claimedAt: data?.claimedAt || state.challenges[entry.tier][entry.index]?.claimedAt || new Date().toISOString(),
        completedAt: state.challenges[entry.tier][entry.index]?.completedAt || new Date().toISOString()
      });
    }
    const previousMe = state.me ? { ...state.me } : null;
    state.me.chips = Math.max(0, Math.floor(Number(data?.chips) || Number(state.me?.chips) || 0));
    state.bankrollDisplay = Math.max(0, Math.floor(Number(data?.bankroll ?? data?.chips ?? state.bankrollDisplay ?? state.me.chips) || 0));
    if (Number.isFinite(Number(data?.xp))) state.me.xp = Math.max(0, Math.floor(Number(data.xp)));
    if (Number.isFinite(Number(data?.level))) state.me.level = Math.max(1, Math.floor(Number(data.level)));
    syncXpUiFromUser(state.me, previousMe);
    setStatus(`Challenge claimed: +${Math.max(0, Math.floor(Number(data?.reward) || 0))} chips`);
    delete state.challengeClaimPendingById[challengeId];
    render();
    loadChallenges();
  } catch (e) {
    delete state.challengeClaimPendingById[challengeId];
    const message = String(e.message || '');
    if (/already claimed/i.test(message)) {
      if (entry?.challenge) {
        setChallengeEntryById(challengeId, {
          ...(state.challenges[entry.tier][entry.index] || entry.challenge),
          claimed: true,
          claimedAt: (state.challenges[entry.tier][entry.index] || entry.challenge).claimedAt || new Date().toISOString()
        });
      }
      pushToast('Already claimed.');
      loadChallenges();
      render();
      return;
    }
    if (original && entry) {
      setChallengeEntryById(challengeId, original);
    }
    pushToast(`Challenge claim failed: ${message || 'Please try again.'}`);
    setError(message);
    render();
  }
}

async function loadRankedOverview({ silent = false } = {}) {
  if (!state.token) return null;
  try {
    const data = await api('/api/ranked/overview');
    state.rankedOverview = data?.overview || null;
    const queue = state.rankedOverview?.queueStatus;
    if (queue?.status === 'searching') {
      state.rankedQueue.searching = true;
      state.rankedQueue.connected = false;
      state.rankedQueue.status = 'searching';
      state.rankedQueue.queuedAt = queue.queuedAt || state.rankedQueue.queuedAt;
      state.rankedQueue.bet = Math.max(1, Math.floor(Number(queue.fixedBet || queue.requestedBet || state.rankedQueue.bet || 50)));
    } else if (!rankedQueueIsActive()) {
      state.rankedQueue.bet = Math.max(1, Math.floor(Number(state.rankedOverview?.fixedBet || state.rankedQueue.bet || 50)));
    }
    return state.rankedOverview;
  } catch (e) {
    if (!silent) setError(e.message);
    return null;
  }
}

function logout() {
  resetQuickPlayState();
  resetRankedQueueState();
  clearBotMatchLaunchState({ renderNow: false });
  state.matchChatDraft = '';
  state.inviteModeModalFriend = null;
  state.challengeModalFriend = null;
  state.challengePopup = null;
  if (state.socket) state.socket.disconnect();
  state.socket = null;
  state.token = null;
  state.me = null;
  state.currentMatch = null;
  state.currentLobby = null;
  state.challenges = { hourly: [], daily: [], weekly: [], skill: [] };
  state.challengeClaimPendingById = {};
  state.challengeMeta = { skillPoolSize: 0, activeSkillCount: 0 };
  state.challengeResets = { hourly: null, daily: null, weekly: null, skill: null };
  state.challengeResetRemainingMs = { hourly: 0, daily: 0, weekly: 0, skill: 0 };
  state.challengeResetRefreshInFlight = false;
  state.homeSections = { highRoller: false, practice: false };
  state.leaderboard = { rows: [], currentUserRank: null, totalUsers: 0, loading: false };
  state.leaderboardExpanded = false;
  state.rankedOverview = null;
  state.betHistoryModalOpen = false;
  state.favoriteStatModalOpen = false;
  state.favoriteStatDraftKey = '';
  state.favoriteStatFilter = '';
  state.titleInfoModalKey = '';
  state.rankTimelineModalOpen = false;
  state.rankedForfeitModalOpen = false;
  state.pendingSeriesResult = null;
  state.rankedSeriesResultModal = null;
  state.rankedSeriesResultAnimKey = '';
  if (Number.isFinite(state.rankedSeriesResultAnimRaf)) cancelAnimationFrame(state.rankedSeriesResultAnimRaf);
  state.rankedSeriesResultAnimRaf = null;
  if (Number.isFinite(state.xpUi.animRaf)) cancelAnimationFrame(state.xpUi.animRaf);
  state.xpUi = { progress: 0, targetProgress: 0, level: 1, pulseUntil: 0, animRaf: null };
  state.presenceByUser = {};
  state.statsMoreOpen = false;
  state.cardAnimState = { enterUntilById: {}, revealUntilById: {}, shiftUntilById: {}, tiltById: {} };
  state.pressureGlow = { key: '', expiresAt: 0, seen: true };
  state.revealPin = false;
  state.newPin = '';
  localStorage.removeItem('bb_token');
  localStorage.removeItem('bb_auth_token');
  localStorage.removeItem('bb_auth_username');
  render();
}

function renderNotificationBell() {
  if (!state.token) return '';
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
    bell.onclick = async () => {
      state.notificationsOpen = !state.notificationsOpen;
      if (state.notificationsOpen) {
        await markNotificationsSeen();
      }
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
              <div class="muted notif-time">${formatNotificationTime(n.createdAt)}</div>
              ${renderNotificationActions(n)}
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
  mount.querySelectorAll('[data-notif-fr-accept]').forEach((btn) => {
    btn.onclick = () => {
      acceptRequestFromNotification(btn.dataset.notifFrAccept);
    };
  });
  mount.querySelectorAll('[data-notif-fr-decline]').forEach((btn) => {
    btn.onclick = () => {
      declineRequestFromNotification(btn.dataset.notifFrDecline);
    };
  });
}

function syncChallengePromptOverlay() {
  let mount = document.getElementById('challengePromptMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'challengePromptMount';
    document.body.appendChild(mount);
  }
  if (!state.challengePopup) {
    mount.innerHTML = '';
    return;
  }
  const prompt = state.challengePopup;
  mount.innerHTML = `
    <div class="notif-overlay-backdrop"></div>
    <div class="notif-overlay-panel card challenge-popup-panel">
      <div class="notif-head">
        <strong>Incoming Challenge</strong>
      </div>
      <div><strong>${prompt.fromUsername || 'Friend'}</strong> challenged you for ${Number(prompt.bet || 0).toLocaleString()} chips.</div>
      ${prompt.message ? `<div class="muted">"${prompt.message}"</div>` : ''}
      <div class="row" style="margin-top:10px">
        <button id="challengePromptAcceptBtn" class="primary">Accept</button>
        <button id="challengePromptDeclineBtn" class="warn">Decline</button>
      </div>
    </div>
  `;
  const acceptBtn = document.getElementById('challengePromptAcceptBtn');
  if (acceptBtn) {
    acceptBtn.onclick = () => {
      const challengeId = state.challengePopup?.challengeId;
      state.challengePopup = null;
      if (challengeId) respondFriendChallenge(challengeId, 'accept');
      render();
    };
  }
  const declineBtn = document.getElementById('challengePromptDeclineBtn');
  if (declineBtn) {
    declineBtn.onclick = () => {
      const challengeId = state.challengePopup?.challengeId;
      state.challengePopup = null;
      if (challengeId) respondFriendChallenge(challengeId, 'decline');
      render();
    };
  }
}

function syncRoundResultModal() {
  let mount = document.getElementById('roundResultMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'roundResultMount';
    document.body.appendChild(mount);
  }
  const match = state.currentMatch;
  const phaseResult = match?.phase === 'RESULT' ? match?.roundResult : null;
  const result = phaseResult || state.roundResultBanner;
  if (!result || state.view !== 'match') {
    mount.innerHTML = '';
    return;
  }
  const meId = state.me?.id;
  const delta = result.deltaChips || 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const bankroll = isOfflineMatchActive()
    ? Math.max(0, Math.floor(Number(match?.players?.[meId]?.bankroll) || 0))
    : (Number.isFinite(state.bankrollDisplay) ? Math.round(state.bankrollDisplay) : state.me?.chips || 0);
  const headline = result.outcome === 'win' ? 'WIN' : result.outcome === 'lose' ? 'LOSE' : 'PUSH';
  const subtitle = result.title || (result.outcome === 'win' ? 'You Win' : result.outcome === 'lose' ? 'You Lose' : 'Push');
  const alreadySelected = Boolean(meId && match?.resultChoiceByPlayer?.[meId]);
  const seriesComplete = Boolean(result?.rankedSeries?.complete);
  const opponentId = match?.playerIds?.find((id) => id !== meId);
  const botRound = Boolean(opponentId && match?.participants?.[opponentId]?.isBot);
  const rankedRound = String(match?.matchType || '').toUpperCase() === 'RANKED';
  const rankedSeriesActive = Boolean(rankedRound && !seriesComplete);
  const busy = state.roundResultChoicePending || alreadySelected;
  const nextDisabled = seriesComplete ? false : busy;
  const nextLabel = seriesComplete
    ? (rankedRound ? 'Return to Ranked' : 'Series Complete')
    : (rankedRound ? 'Continue Series' : 'Next Round');
  const pvpRound = Boolean(opponentId && !botRound);
  const allowDoubleOrNothingMode = canUseDoubleOrNothingInMatch(match);
  const doubledBet = Math.max(1, Math.floor(Number(match?.baseBet) || 0) * 2);
  const opponentBankroll = Math.max(0, Math.floor(Number(match?.players?.[opponentId]?.bankroll) || 0));
  const maxBetCap = Math.max(1, Math.floor(Number(match?.maxBetCap) || doubledBet));
  const minBet = Math.max(1, Math.floor(Number(match?.minBet) || 1));
  const canDoubleOrNothing = allowDoubleOrNothingMode &&
    doubledBet >= minBet &&
    doubledBet <= maxBetCap &&
    (result.isPractice || (bankroll >= doubledBet && opponentBankroll >= doubledBet));
  const showRankedContinueRow = Boolean(rankedSeriesActive && !seriesComplete);
  const leaveLabel = rankedRound
    ? (rankedSeriesActive ? 'Forfeit Series' : 'Return to Ranked')
    : 'Leave to Home';
  mount.innerHTML = `
    <div class="round-result-wrap">
      <div class="round-result-popup result-modal card">
        <h3 class="result-title">${headline}</h3>
        <div class="muted">${subtitle}</div>
        <div class="result-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${sign}${Math.abs(delta)}</div>
        <div class="muted">${result.isPractice ? 'Practice round • No chips won/lost' : `Bankroll ${Number(bankroll).toLocaleString()}`}</div>
        <div class="result-actions">
          ${
            showRankedContinueRow
              ? `<div class="result-actions-top">
                   <button id="roundResultNextBtn" class="primary" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button>
                   <button id="roundResultLeaveBtn" class="warn">${leaveLabel}</button>
                 </div>`
              : rankedRound
                ? ''
                : `<div class="result-actions-top">
                     <button id="roundResultNextBtn" class="primary" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button>
                     <button id="roundResultChangeBetBtn" class="ghost" ${busy ? 'disabled' : ''}>Change Bet</button>
                   </div>
                   ${
                     allowDoubleOrNothingMode
                       ? `<div class="result-actions-mid">
                            <button id="roundResultDoubleBtn" class="gold result-double-btn" ${busy || !canDoubleOrNothing ? 'disabled' : ''}>
                              Double or Nothing (${doubledBet.toLocaleString()})${pvpRound ? ' • both must accept' : ''}
                            </button>
                          </div>`
                       : ''
                   }
                   <div class="result-actions-bottom"><button id="roundResultLeaveBtn" class="warn result-leave-btn">${leaveLabel}</button></div>`
          }
        </div>
        ${
          rankedSeriesActive && state.rankedForfeitModalOpen
            ? `<div class="round-result-forfeit-confirm">
                 <strong>Forfeit Ranked Series?</strong>
                 <p class="muted">This counts as an automatic loss and ends the series now.</p>
                 <div class="row">
                   <button id="confirmRoundResultForfeitBtn" class="warn" type="button">Forfeit Series</button>
                   <button id="cancelRoundResultForfeitBtn" class="ghost" type="button">Cancel</button>
                 </div>
               </div>`
            : ''
        }
        ${
          seriesComplete
            ? '<div class="muted" style="margin-top:8px">Series complete. Opening series results…</div>'
            : (busy ? '<div class="muted" style="margin-top:8px">Waiting for round choice…</div>' : '')
        }
      </div>
    </div>
  `;
  const nextBtn = document.getElementById('roundResultNextBtn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (seriesComplete && rankedRound) {
        state.pendingNavAfterLeave = 'ranked';
        goToView('ranked');
        loadRankedOverview({ silent: true });
        render();
        return;
      }
      state.roundResultChoicePending = true;
      emitNextRoundChoice();
      render();
    };
  }
  const changeBetBtn = document.getElementById('roundResultChangeBetBtn');
  if (changeBetBtn) {
    changeBetBtn.onclick = () => {
      state.roundResultChoicePending = true;
      emitChangeBetChoice();
      render();
    };
  }
  const leaveBtn = document.getElementById('roundResultLeaveBtn');
  if (leaveBtn) {
    leaveBtn.onclick = () => {
      if (rankedRound) {
        if (rankedSeriesActive) {
          state.rankedForfeitModalOpen = true;
        } else {
          state.pendingNavAfterLeave = 'ranked';
          goToView('ranked');
          loadRankedOverview({ silent: true });
        }
        render();
        return;
      }
      if (botRound || isOfflineMatchActive()) {
        state.pendingNavAfterLeave = null;
        state.leaveMatchModal = false;
        state.roundResultChoicePending = false;
        state.roundResultBanner = null;
        state.currentMatch = null;
        state.currentLobby = null;
        state.matchChatDraft = '';
        goToView('home');
        render();
        return;
      }
      state.pendingNavAfterLeave = 'home';
      leaveCurrentMatch({ showToast: true, refreshOnError: true });
    };
  }
  const cancelRoundResultForfeitBtn = document.getElementById('cancelRoundResultForfeitBtn');
  if (cancelRoundResultForfeitBtn) {
    cancelRoundResultForfeitBtn.onclick = () => {
      state.rankedForfeitModalOpen = false;
      render();
    };
  }
  const confirmRoundResultForfeitBtn = document.getElementById('confirmRoundResultForfeitBtn');
  if (confirmRoundResultForfeitBtn) {
    confirmRoundResultForfeitBtn.onclick = () => {
      state.rankedForfeitModalOpen = false;
      state.pendingNavAfterLeave = 'ranked';
      leaveCurrentMatch({ showToast: true, refreshOnError: true });
    };
  }
  const doubleBtn = document.getElementById('roundResultDoubleBtn');
  if (doubleBtn) {
    doubleBtn.onclick = () => {
      state.roundResultChoicePending = true;
      emitDoubleOrNothing();
      render();
    };
  }
}

function closeRankedSeriesResultModal(nextView = null) {
  if (Number.isFinite(state.rankedSeriesResultAnimRaf)) {
    cancelAnimationFrame(state.rankedSeriesResultAnimRaf);
  }
  state.rankedSeriesResultAnimRaf = null;
  state.rankedSeriesResultAnimKey = '';
  state.rankedSeriesResultModal = null;
  if (nextView) {
    goToView(nextView);
    if (nextView === 'ranked') loadRankedOverview({ silent: true });
  }
  render();
}

function syncRankedSeriesResultModal() {
  let mount = document.getElementById('rankedSeriesResultMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'rankedSeriesResultMount';
    document.body.appendChild(mount);
  }
  const result = state.rankedSeriesResultModal;
  if (!result) {
    if (Number.isFinite(state.rankedSeriesResultAnimRaf)) {
      cancelAnimationFrame(state.rankedSeriesResultAnimRaf);
      state.rankedSeriesResultAnimRaf = null;
    }
    state.rankedSeriesResultAnimKey = '';
    mount.innerHTML = '';
    return;
  }
  const outcome = String(result.outcome || '').toLowerCase();
  const title = outcome === 'win'
    ? 'SERIES WON'
    : outcome === 'forfeit'
      ? 'FORFEIT'
      : 'SERIES LOST';
  const delta = Math.floor(Number(result.eloDelta) || 0);
  const deltaSign = delta >= 0 ? '+' : '';
  const before = Math.max(0, Math.floor(Number(result.eloBefore) || 0));
  const after = Math.max(0, Math.floor(Number(result.eloAfter) || 0));
  const beforeMeta = rankKeyMeta(result.rankBeforeKey || result.rankBefore);
  const afterMeta = rankKeyMeta(result.rankAfterKey || result.rankAfter);
  const startPct = Math.round(eloTrackPercent(before) * 1000) / 10;
  const endPct = Math.round(eloTrackPercent(after) * 1000) / 10;
  const tierIndex = RANKED_TIER_ORDER.indexOf(afterMeta.key);
  const nextTierKey = tierIndex > 0 ? RANKED_TIER_ORDER[tierIndex - 1] : null;
  const nextTierMeta = nextTierKey ? RANKED_TIER_META[nextTierKey] : null;
  const eloToNext = nextTierMeta ? Math.max(0, Math.floor(Number(nextTierMeta.minElo) - after)) : 0;
  const rankChange = beforeMeta.key === afterMeta.key
    ? `${beforeMeta.icon} ${beforeMeta.label}`
    : `${beforeMeta.icon} ${beforeMeta.label} → ${afterMeta.icon} ${afterMeta.label}`;
  mount.innerHTML = `
    <div class="round-result-wrap ranked-series-result-wrap">
      <div class="round-result-popup result-modal ranked-series-result-modal card">
        <h3 class="result-title">${title}</h3>
        <div class="muted">${rankChange}</div>
        <div class="result-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${deltaSign}${Math.abs(delta)} Elo</div>
        <div class="muted"><span id="rankedSeriesResultEloText">${before.toLocaleString()}</span> → ${after.toLocaleString()}</div>
        <div class="ranked-series-elo-track">
          <div class="ranked-series-elo-fill" id="rankedSeriesEloFill" style="width:${startPct}%"></div>
        </div>
        <div class="ranked-series-elo-meta">
          <span>${beforeMeta.label}</span>
          <span>${afterMeta.label}</span>
        </div>
        <div class="muted ranked-series-next-line">${nextTierMeta ? `${eloToNext.toLocaleString()} Elo to ${nextTierMeta.label}` : 'Top rank reached'}</div>
        <div class="result-actions">
          <div class="result-actions-top">
            <button id="rankedSeriesBackBtn" class="primary">Back to Ranked</button>
            <button id="rankedSeriesHomeBtn" class="ghost">Home</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const animKey = `${result.seriesId || 'series'}:${before}:${after}:${delta}`;
  if (state.rankedSeriesResultAnimKey !== animKey) {
    state.rankedSeriesResultAnimKey = animKey;
    const fill = document.getElementById('rankedSeriesEloFill');
    const eloText = document.getElementById('rankedSeriesResultEloText');
    if (fill) {
      requestAnimationFrame(() => {
        fill.style.width = `${endPct}%`;
      });
    }
    const startMs = performance.now();
    const durationMs = 1100;
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - startMs) / durationMs));
      const eased = 1 - ((1 - t) ** 3);
      const current = Math.round(before + ((after - before) * eased));
      if (eloText) eloText.textContent = current.toLocaleString();
      if (t < 1) {
        state.rankedSeriesResultAnimRaf = requestAnimationFrame(tick);
      } else {
        state.rankedSeriesResultAnimRaf = null;
      }
    };
    if (Number.isFinite(state.rankedSeriesResultAnimRaf)) {
      cancelAnimationFrame(state.rankedSeriesResultAnimRaf);
    }
    state.rankedSeriesResultAnimRaf = requestAnimationFrame(tick);
  }

  const rankedSeriesBackBtn = document.getElementById('rankedSeriesBackBtn');
  if (rankedSeriesBackBtn) {
    rankedSeriesBackBtn.onclick = () => closeRankedSeriesResultModal('ranked');
  }
  const rankedSeriesHomeBtn = document.getElementById('rankedSeriesHomeBtn');
  if (rankedSeriesHomeBtn) {
    rankedSeriesHomeBtn.onclick = () => closeRankedSeriesResultModal('home');
  }
}

function renderTopbar(title = 'Blackjack Battle') {
  const onlineBankroll = Number.isFinite(state.bankrollDisplay) ? state.bankrollDisplay : state.me?.chips;
  const offlineBankroll = Math.max(0, Math.floor(Number(state.offlineProfile?.bankroll) || OFFLINE_STARTING_BANKROLL));
  const usingOfflineEconomy = offlineModeEnabled() || isOfflineMatchActive();
  const bankroll = usingOfflineEconomy ? offlineBankroll : onlineBankroll;
  const chipText = Number.isFinite(bankroll) ? Number(bankroll).toLocaleString() : '0';
  const claimableCount = claimableChallengesCount();
  const challengeBadge = claimableCount > 0
    ? `<span class="nav-pill-badge" aria-label="${claimableCount} claimable challenges">${claimableCount > 9 ? '9+' : claimableCount}</span>`
    : '';
  return `
    <div class="card topbar">
      <div class="topbar-left">
        <div class="logo" id="topLogo" tabindex="0"><span>${title}</span></div>
        <div class="chip-balance"><span class="chip-icon">◎</span>${chipText}${usingOfflineEconomy ? ' <span class="muted">(Offline Bankroll)</span>' : ''}</div>
      </div>
      <div class="topbar-center tabs">
        <button data-go="home" class="nav-pill ${state.view === 'home' ? 'nav-active' : ''}">Home</button>
        <button data-go="profile" class="nav-pill ${state.view === 'profile' ? 'nav-active' : ''}">Profile</button>
        <button data-go="friends" class="nav-pill ${state.view === 'friends' ? 'nav-active' : ''}">Friends</button>
        <button data-go="lobbies" class="nav-pill ${state.view === 'lobbies' ? 'nav-active' : ''}">Lobbies</button>
        <button data-go="ranked" class="nav-pill ${state.view === 'ranked' ? 'nav-active' : ''}">Ranked</button>
        <button data-go="challenges" class="nav-pill nav-pill-challenges ${state.view === 'challenges' ? 'nav-active' : ''}">
          <span>Challenges</span>${challengeBadge}
        </button>
        <button data-go="rules" class="nav-pill ${state.view === 'rules' ? 'nav-active' : ''}">Rules</button>
      </div>
      <div class="topbar-right nav">
        ${renderNotificationBell()}
        ${state.token ? '<button class="warn" id="logoutBtn">Logout</button>' : ''}
      </div>
    </div>
    ${offlineModeEnabled() ? '<div class="offline-banner">Offline Mode: bot matches only.</div>' : ''}
  `;
}

function bindShellNav() {
  app.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => {
      navigateWithMatchSafety(btn.dataset.go);
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
      ${offlineModeEnabled() ? '<p class="offline-auth-note">Offline Mode detected. You can still play bot matches locally.</p>' : ''}
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
      ${offlineModeEnabled() ? '<button id="offlinePlayBtn" class="gold" type="button">Play Bot (Offline)</button>' : ''}
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
  const offlinePlayBtn = document.getElementById('offlinePlayBtn');
  if (offlinePlayBtn) {
    offlinePlayBtn.onclick = () => {
      ensureOfflineIdentity();
      state.bankrollDisplay = state.offlineProfile.bankroll;
      goToView('home');
      render();
    };
  }
}

function renderHome() {
  const me = state.me;
  const notes = state.patchNotes?.length ? state.patchNotes : FALLBACK_PATCH_NOTES;
  const quickPlaySearching = state.quickPlay.status === 'searching';
  const quickPlayConnected = state.quickPlay.status === 'connected';
  const quickPlayLabel = quickPlayConnected ? 'Connecting...' : quickPlaySearching ? 'Searching...' : 'Quick Play';
  const expandedStats = deriveExpandedStats(me);
  const leaderboardRows = Array.isArray(state.leaderboard?.rows) ? state.leaderboard.rows : [];
  const leaderboardExpanded = Boolean(state.leaderboardExpanded);
  const leaderboardVisibleRows = leaderboardExpanded ? leaderboardRows : leaderboardRows.slice(0, 5);
  const dailyWinStreak = Math.max(0, Math.floor(Number(me.dailyWinStreakCount) || 0));
  const pvpWins = Math.max(0, Math.floor(Number(me.pvpWins) || 0));
  const pvpLosses = Math.max(0, Math.floor(Number(me.pvpLosses) || 0));
  const rankedTier = rankTierMetaFromUser(me);
  const rankedElo = Math.max(0, Math.floor(Number(me.rankedElo) || 0));
  const rankedSearching = rankedQueueIsActive();
  const rankedOverview = state.rankedOverview || null;
  const rankedSeries = rankedOverview?.activeSeries || null;
  const rankedFixedBet = Math.max(1, Math.floor(Number(rankedOverview?.fixedBet || me.rankedFixedBet || me.rankedBetMin) || rankedTier.fixedBet));
  const rankedCanQueue = Math.floor(Number(me.chips) || 0) >= rankedFixedBet;
  const rankedDisabledReason = rankedCanQueue
    ? ''
    : (rankedOverview?.disabledReason || `Need ${rankedFixedBet.toLocaleString()} chips for ranked.`);
  const handsWon = Math.max(0, Math.floor(Number(me.stats.handsWon) || 0));
  const handsLost = Math.max(0, Math.floor(Number(me.stats.handsLost) || 0));
  const handsPushed = Math.max(0, Math.floor(Number(me.stats.pushes ?? me.stats.handsPush) || 0));
  const totalResolvedHands = Math.max(1, handsWon + handsLost + handsPushed);
  const handWinPct = Math.round((handsWon / totalResolvedHands) * 100);
  const handLossPct = Math.round((handsLost / totalResolvedHands) * 100);
  const handPushPct = Math.max(0, 100 - handWinPct - handLossPct);
  const sixSevenDealt = Math.max(0, Math.floor(Number(me.stats.sixSevenDealt) || 0));
  const betHistoryPreview = (me.betHistory || []).slice(0, 6);
  const betHistoryAll = (me.betHistory || []).slice(0, 15);
  const homeSections = state.homeSections || { highRoller: false, practice: false };
  const latest = notes[0];
  const rankWins = Math.max(0, Math.floor(Number(me.rankedWins) || 0));
  const rankLosses = Math.max(0, Math.floor(Number(me.rankedLosses) || 0));
  const highRollerUnlocked = hasHighRollerAccess(me);
  const splitTensEvent = splitTensEventState();
  const level = Math.max(1, Math.floor(Number(me.level) || 1));
  const xpToNext = Math.max(0, Math.floor(Number(me.xpToNextLevel) || 0));
  const xpProgress = state.xpUi.level === level
    ? Math.max(0, Math.min(1, Number(state.xpUi.progress) || 0))
    : Math.max(0, Math.min(1, Number(me.levelProgress) || 0));
  const levelPercent = Math.round(xpProgress * 100);
  const streakBonusPct = streakBonusPercent(me);
  const botLaunchPending = Boolean(state.botMatchLaunch?.pending);
  const botLaunchShowBusy = botLaunchPending && Boolean(state.botMatchLaunch?.showBusy);
  const botLaunchMode = String(state.botMatchLaunch?.mode || '');
  const realBotLaunching = botLaunchPending && (botLaunchMode === 'real' || botLaunchMode === 'high-roller');
  const practiceBotLaunching = botLaunchPending && botLaunchMode === 'practice';

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}
    <main class="view-stack dashboard">
      <p class="muted view-subtitle">${me.username}</p>
      ${
        splitTensEvent.active
          ? `<section class="card section split-tens-event-banner">
              <div class="split-tens-event-copy">
                <strong>LIMITED EVENT: Split Tens</strong>
                <div class="muted">10/10 can be split for 24 hours.</div>
              </div>
              <div class="split-tens-event-meta">
                <div class="split-tens-event-countdown" id="splitTensCountdownHome">Ends in ${formatCooldown(splitTensEvent.remainingMs)}</div>
                <button class="ghost" id="openSplitTensDetailsBtn" type="button">Details</button>
              </div>
            </section>`
          : ''
      }
      <div class="dashboard-grid home-grid">
        <section class="col card section reveal-panel glow-follow glow-follow--panel play-panel home-play-col">
          <h2>Play</h2>
          <p class="muted play-intro">Quick Play and Lobbies are the fastest path to a table.</p>
          <div class="pvp-hero-grid" role="group" aria-label="PvP actions">
            <button
              class="pvp-cta pvp-cta-primary"
              id="quickPlayBtn"
              ${quickPlaySearching || quickPlayConnected || rankedSearching || offlineModeEnabled() ? 'disabled' : ''}
              ${!quickPlaySearching && !quickPlayConnected ? 'autofocus' : ''}
            >
              <span class="pvp-cta-label">${quickPlayLabel}</span>
              <span class="pvp-cta-sub">${quickPlaySearching || quickPlayConnected ? 'Matchmaking in progress...' : 'Instant matchmaking vs real players'}</span>
            </button>
            <button class="pvp-cta pvp-cta-secondary" id="openLobbiesBtn">
              <span class="pvp-cta-label">Lobbies</span>
              <span class="pvp-cta-sub">Create or join private matches</span>
            </button>
          </div>
          <div class="ranked-summary-card card">
            <div class="ranked-summary-head">
              <div class="ranked-summary-title">
                <strong>Ranked Summary</strong>
                ${renderRankTierBadge(me)}
              </div>
              <div class="ranked-summary-actions">
                <button id="viewRankHomeBtn" class="ghost" type="button">View Rank</button>
                <button id="goRankedHomeBtn" class="gold" ${!rankedCanQueue && !rankedSearching ? 'disabled' : ''}>Go to Ranked</button>
              </div>
            </div>
            <div class="muted">Elo ${rankedElo} • W-L ${rankWins}-${rankLosses} • Fixed bet ${rankedFixedBet.toLocaleString()}</div>
            ${
              rankedSeries
                ? `<div class="muted">Series: ${rankedSeries.completedMainGames}/${rankedSeries.targetGames} games • Chips ${rankedSeries.yourChipDelta >= 0 ? '+' : ''}${rankedSeries.yourChipDelta.toLocaleString()}${rankedSeries.inTiebreaker ? ` • Tiebreaker Round #${rankedSeries.nextTiebreakerRound}` : ''}</div>`
                : '<div class="muted">No active ranked series.</div>'
            }
            ${!rankedCanQueue && !rankedSearching ? `<div class="muted ranked-disabled-note">${rankedDisabledReason}</div>` : ''}
          </div>

          <section class="home-accordion card">
            <button class="home-accordion-toggle" data-home-toggle="highRoller" type="button">
              <span>High Roller</span>
              <span class="muted">${homeSections.highRoller ? 'Hide' : 'Show'}</span>
            </button>
            ${
              homeSections.highRoller
                ? `<div class="home-accordion-body">
                    <div class="high-roller-premium">
                      <div class="high-roller-badge" aria-hidden="true">♕</div>
                      <div class="high-roller-copy">
                        <strong>High Roller</strong>
                        <div class="muted">Min bet 2,500 • no max (bankroll limited)</div>
                        ${!highRollerUnlocked ? `<div class="muted high-roller-lock-note">Requires ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips</div>` : ''}
                      </div>
                      <div class="high-roller-actions">
                        <button
                          class="gold ${highRollerUnlocked ? '' : 'is-locked'}"
                          id="highRollerPvpBtn"
                          type="button"
                          ${highRollerUnlocked ? '' : `aria-disabled="true" title="Requires ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips"`}
                        >High Roller PvP</button>
                        <button
                          class="ghost ${highRollerUnlocked ? '' : 'is-locked'}"
                          id="highRollerBotBtn"
                          type="button"
                          ${highRollerUnlocked ? '' : `aria-disabled="true" title="Requires ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips"`} ${botLaunchPending ? 'disabled' : ''}
                        >High Roller Bot</button>
                      </div>
                    </div>
                  </div>`
                : ''
            }
          </section>

          <section class="home-accordion card">
            <button class="home-accordion-toggle" data-home-toggle="practice" type="button">
              <span>Practice vs Bot</span>
              <span class="muted">${homeSections.practice ? 'Hide' : 'Show'}</span>
            </button>
            ${
              homeSections.practice
                ? `<div class="home-accordion-body">
                    <section class="practice-panel" aria-label="Practice vs bot">
                      <div class="practice-head">
                        <h3>Practice vs Bot <span class="practice-parenthetical muted">(No real chips won or lost)</span></h3>
                        <p class="muted">Starts a live bot match with full gameplay and zero bankroll impact.</p>
                        <p class="muted practice-helper">Use this to learn lines, test doubles/splits, and warm up risk-free.</p>
                      </div>
                      <div class="practice-controls">
                        <div class="bot-difficulty-grid" id="botDifficultyGrid" role="radiogroup" aria-label="Bot difficulty">
                          <button type="button" role="radio" aria-checked="${state.selectedBotDifficulty === 'easy'}" data-bot="easy" class="bot-diff-btn ${state.selectedBotDifficulty === 'easy' ? 'is-selected' : ''}" ${botLaunchPending ? 'disabled' : ''}>
                            <span class="bot-diff-label">Easy</span>
                            <span class="bot-diff-range">Bets: ${BOT_BET_RANGES.easy.min}-${BOT_BET_RANGES.easy.max}</span>
                          </button>
                          <button type="button" role="radio" aria-checked="${state.selectedBotDifficulty === 'medium'}" data-bot="medium" class="bot-diff-btn ${state.selectedBotDifficulty === 'medium' ? 'is-selected' : ''}" ${botLaunchPending ? 'disabled' : ''}>
                            <span class="bot-diff-label">Medium</span>
                            <span class="bot-diff-range">Bets: ${BOT_BET_RANGES.medium.min}-${BOT_BET_RANGES.medium.max}</span>
                          </button>
                          <button type="button" role="radio" aria-checked="${state.selectedBotDifficulty === 'normal'}" data-bot="normal" class="bot-diff-btn ${state.selectedBotDifficulty === 'normal' ? 'is-selected' : ''}" ${botLaunchPending ? 'disabled' : ''}>
                            <span class="bot-diff-label">Normal</span>
                            <span class="bot-diff-range">Bets: ${BOT_BET_RANGES.normal.min}-${BOT_BET_RANGES.normal.max}</span>
                          </button>
                        </div>
                        <div class="muted practice-note">Practice mode: no chips won/lost, no ranked/streak/challenge impact.</div>
                        ${botLaunchShowBusy ? '<div class="muted practice-queue-note"><span class="btn-spinner" aria-hidden="true"></span>Finding bot table...</div>' : ''}
                        <div class="home-inline-actions">
                          <button class="gold bot-play-btn" id="playRealBotBtn" ${botLaunchPending ? 'disabled' : ''}>${realBotLaunching && botLaunchShowBusy ? '<span class="btn-spinner" aria-hidden="true"></span>Finding bot table...' : 'Play Real Bot'}</button>
                          <button class="ghost bot-play-btn" id="playPracticeBotBtn" ${botLaunchPending ? 'disabled' : ''}>${practiceBotLaunching && botLaunchShowBusy ? '<span class="btn-spinner" aria-hidden="true"></span>Finding bot table...' : 'Start Practice Bot'}</button>
                        </div>
                      </div>
                    </section>
                  </div>`
                : ''
            }
          </section>

          <section class="leaderboard-card compact home-leaderboard-card" aria-label="Global leaderboard">
            <div class="leaderboard-head">
              <h3>Leaderboard Snapshot</h3>
              <button class="ghost leaderboard-expand-btn" id="toggleLeaderboardBtn" type="button">${leaderboardExpanded ? 'Collapse' : 'Expand'}</button>
            </div>
            <div class="muted leaderboard-subhead">${leaderboardExpanded ? `Showing top ${leaderboardVisibleRows.length}` : 'Top 5'}</div>
            <div class="leaderboard-list compact ${leaderboardExpanded ? 'is-expanded' : ''}">
              ${
                leaderboardVisibleRows.length
                  ? leaderboardVisibleRows.map((row) => `
                    <div class="leaderboard-row ${row.userId === me.id ? 'is-me' : ''}">
                      <span class="leaderboard-rank">#${row.rank}</span>
                      <span class="leaderboard-name">${row.username}</span>
                      ${renderRankTierBadge(row)}
                      <span class="leaderboard-chips">${Number(row.chips || 0).toLocaleString()}</span>
                    </div>
                  `).join('')
                  : state.leaderboard.loading
                    ? new Array(5).fill('<div class="leaderboard-row leaderboard-row-skeleton"><span></span><span></span><span></span><span></span></div>').join('')
                    : '<div class="muted">No leaderboard data yet.</div>'
              }
            </div>
          </section>
        </section>

        <section class="col card section reveal-panel glow-follow glow-follow--panel home-stats-col">
          <section class="card home-xp-card">
            <div class="home-xp-head">
              <strong data-xp-level>Level ${level}</strong>
              <span class="muted">${xpToNext.toLocaleString()} XP to next level</span>
            </div>
            <div class="xp-track home-xp-track ${Date.now() < state.xpUi.pulseUntil ? 'is-pulsing' : ''}">
              <span class="xp-fill" data-xp-fill style="width:${levelPercent}%"></span>
            </div>
            <div class="home-xp-meta">
              <span class="muted">Progress ${levelPercent}%</span>
              ${streakBonusPct > 0 ? `<span class="streak-bonus-pill">Streak Bonus Active +${streakBonusPct}% XP</span>` : '<span class="muted">No streak bonus active</span>'}
            </div>
          </section>
          <div class="stats-head">
            <h2>Stats</h2>
            <button id="openStatsMoreBtn" class="ghost stats-more-btn" type="button">View more</button>
          </div>
          <div class="kpis compact-kpis">
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">♟</span>Matches Played</div><strong>${me.stats.matchesPlayed || 0}</strong></div>
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">▲</span>Hands Won</div><strong>${handsWon}</strong></div>
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">▼</span>Hands Lost</div><strong>${handsLost}</strong></div>
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">⟷</span>Hands Pushed</div><strong>${handsPushed}</strong></div>
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">♠</span>Blackjacks Dealt</div><strong>${me.stats.blackjacks || 0}</strong></div>
            <div class="kpi"><div class="muted"><span class="kpi-icon" aria-hidden="true">7</span>6-7&apos;s Dealt</div><strong>${sixSevenDealt}</strong></div>
          </div>
          <div class="free-claim-card">
            <div>
              <strong>Daily Streak</strong>
              <div class="muted">Daily wins: ${dailyWinStreak} day${dailyWinStreak === 1 ? '' : 's'} • PvP ${pvpWins}-${pvpLosses}</div>
              <div class="muted">Claim streak: ${me.streakCount || 0} • Next reward +${me.nextStreakReward || 50}</div>
              <div class="muted" id="freeClaimCountdown">${state.freeClaimRemainingMs > 0 ? `Next claim in ${formatCooldown(state.freeClaimRemainingMs)}` : 'Available now'}</div>
            </div>
            <button class="gold" id="claimFreeBtn" ${state.freeClaimRemainingMs > 0 ? 'disabled' : ''}>${state.freeClaimRemainingMs > 0 ? 'On cooldown' : 'Claim +100'}</button>
          </div>

          <section class="recent-activity-card card">
            <div class="recent-activity-head">
              <h3>Recent Activity</h3>
            </div>
            <div class="bet-history-preview">
              ${
                betHistoryPreview.length
                  ? betHistoryPreview
                    .map(
                      (h) => `<div class="history-row compact">
                            <span>${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span>${h.mode}</span>
                            <span class="${h.net >= 0 ? 'gain' : 'loss'}">${h.net >= 0 ? '+' : ''}${h.net}</span>
                          </div>`
                    )
                    .join('')
                  : '<div class="muted">No real-chip hand history yet.</div>'
              }
              <div class="recent-activity-more"><button class="ghost" id="openBetHistoryModalBtn" ${betHistoryAll.length ? '' : 'disabled'}>View more</button></div>
            </div>
          </section>
        </section>
        <section class="card section patch-card home-patch-card">
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
        <section class="card section patch-card rules-strip home-rules-strip">
          <div>
            <strong>Rules:</strong> Blackjack 3:2 • 1 deck • reshuffle each round • surrender available
          </div>
          <div class="muted">Version: ${state.appVersion || 'dev'}</div>
          <button id="openRulesBtn" class="ghost">Rules</button>
        </section>
      </div>
    </main>
    ${
      state.statsMoreOpen
        ? `<div class="modal" id="statsMoreModal">
            <div class="modal-panel card stats-more-panel" role="dialog" aria-modal="true" aria-label="Expanded stats">
              <div class="stats-more-head">
                <h3>Detailed Stats</h3>
                <button id="closeStatsMoreBtn" class="ghost" type="button">Close</button>
              </div>
              <div class="stats-more-scroll">
                <section class="stats-more-group">
                  <h4>Hand Outcome Mix</h4>
                  <div class="stats-winrate-bar" aria-label="Win loss push ratio">
                    <span class="stats-winrate-seg win" style="width:${handWinPct}%"></span>
                    <span class="stats-winrate-seg loss" style="width:${handLossPct}%"></span>
                    <span class="stats-winrate-seg push" style="width:${handPushPct}%"></span>
                  </div>
                  <div class="stats-winrate-legend muted">
                    <span>Win ${handWinPct}% (${handsWon})</span>
                    <span>Loss ${handLossPct}% (${handsLost})</span>
                    <span>Push ${handPushPct}% (${handsPushed})</span>
                  </div>
                </section>
                <section class="stats-more-group">
                  <h4>Split + Double</h4>
                  <div class="stats-more-list">
                    <div><span>Splits attempted</span><strong>${expandedStats.splitsAttempted}</strong></div>
                    <div><span>Split hands won / lost / pushed</span><strong>${expandedStats.splitHandsWon} / ${expandedStats.splitHandsLost} / ${expandedStats.splitHandsPushed}</strong></div>
                    <div><span>Doubles attempted</span><strong>${expandedStats.doublesAttempted}</strong></div>
                    <div><span>Double hands won / lost / pushed</span><strong>${expandedStats.doubleHandsWon} / ${expandedStats.doubleHandsLost} / ${expandedStats.doubleHandsPushed}</strong></div>
                    <div><span>Surrenders</span><strong>${expandedStats.surrenders}</strong></div>
                  </div>
                </section>
                <section class="stats-more-group">
                  <h4>Card Outcomes</h4>
                  <div class="stats-more-list">
                    <div><span>Blackjacks (natural 21)</span><strong>${expandedStats.blackjacks}</strong></div>
                    <div><span>Busts</span><strong>${expandedStats.busts}</strong></div>
                    <div><span>Highest total without bust</span><strong>${expandedStats.highestSafeTotal}</strong></div>
                    <div><span>Max cards in a winning hand</span><strong>${expandedStats.maxCardsInWinningHand}</strong></div>
                    <div><span>4-card 21s</span><strong>${expandedStats.fourCard21s}</strong></div>
                    <div><span>5-card 21s</span><strong>${expandedStats.fiveCard21s}</strong></div>
                    <div><span>6-card 21s</span><strong>${expandedStats.sixCard21s}</strong></div>
                    <div><span>7+ card 21s</span><strong>${expandedStats.sevenPlusCard21s}</strong></div>
                    <div><span>Longest win streak</span><strong>${expandedStats.longestWinStreak}</strong></div>
                    <div><span>Longest loss streak</span><strong>${expandedStats.longestLossStreak}</strong></div>
                  </div>
                </section>
                <section class="stats-more-group">
                  <h4>Chips + Betting (real-chip only)</h4>
                  <div class="stats-more-list">
                    <div><span>Total chips won</span><strong>${Number(expandedStats.totalChipsWon).toLocaleString()}</strong></div>
                    <div><span>Total chips lost</span><strong>${Number(expandedStats.totalChipsLost).toLocaleString()}</strong></div>
                    <div><span>Net chips</span><strong>${expandedStats.netChips >= 0 ? '+' : ''}${Number(expandedStats.netChips).toLocaleString()}</strong></div>
                    <div><span>Biggest single-hand win</span><strong>${Number(expandedStats.biggestHandWin).toLocaleString()}</strong></div>
                    <div><span>Biggest single-hand loss</span><strong>${Number(expandedStats.biggestHandLoss).toLocaleString()}</strong></div>
                    <div><span>Average bet</span><strong>${expandedStats.averageBet > 0 ? expandedStats.averageBet.toFixed(1) : '0'}</strong></div>
                  </div>
                </section>
                <section class="stats-more-group">
                  <h4>Hands By Mode</h4>
                  <div class="stats-more-list">
                    <div><span>Hands played vs bots (practice)</span><strong>${expandedStats.handsPlayedBotPractice}</strong></div>
                    <div><span>Hands played vs bots (real)</span><strong>${expandedStats.handsPlayedBotReal}</strong></div>
                    <div><span>Hands played PvP (real)</span><strong>${expandedStats.handsPlayedPvpReal}</strong></div>
                    <div><span>Hands played PvP (friendly)</span><strong>${expandedStats.handsPlayedPvpFriendly}</strong></div>
                  </div>
                </section>
              </div>
            </div>
          </div>`
        : ''
    }
    ${
      state.betHistoryModalOpen
        ? `<div class="modal" id="betHistoryModal">
            <div class="modal-panel card bet-history-modal-panel" role="dialog" aria-modal="true" aria-label="Bet history">
              <div class="stats-more-head">
                <h3>Bet History (Last 15)</h3>
                <button id="closeBetHistoryModalBtn" class="ghost" type="button">Close</button>
              </div>
              <div class="history-list history-list-full">
                ${
                  betHistoryAll.length
                    ? betHistoryAll.map((h) => `<div class="history-row">
                        <span>${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>${h.mode}</span>
                        <span>Bet ${h.bet}</span>
                        <span>${h.result}</span>
                        <span class="${h.net >= 0 ? 'gain' : 'loss'}">${h.net >= 0 ? '+' : ''}${h.net}</span>
                      </div>`).join('')
                    : '<div class="muted">No bet history yet.</div>'
                }
              </div>
            </div>
          </div>`
        : ''
    }
    ${
      state.eventDetailsModalId === SPLIT_TENS_EVENT_ID && splitTensEvent.active
        ? `<div class="modal" id="splitTensEventModal">
            <div class="modal-panel card split-tens-event-modal" role="dialog" aria-modal="true" aria-label="Split tens event details">
              <div class="split-tens-event-modal-head">
                <h3>Split Tens Event</h3>
                <button id="closeSplitTensDetailsBtn" class="ghost" type="button">Close</button>
              </div>
              <p class="muted">For the next 24 hours, splitting 10s is allowed.</p>
              <ul class="rules-list split-tens-event-list">
                <li><strong>Rule change:</strong> 10/10 can be split.</li>
                <li><strong>Ends at:</strong> ${formatEventEndsAtLocal(splitTensEvent.event?.endsAt)}</li>
                <li><strong id="splitTensCountdownModal">Ends in ${formatCooldown(splitTensEvent.remainingMs)}</strong></li>
              </ul>
            </div>
          </div>`
        : ''
    }
    ${renderRankTimelineModal(me)}
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
  const goRankedHomeBtn = document.getElementById('goRankedHomeBtn');
  if (goRankedHomeBtn) {
    goRankedHomeBtn.onclick = () => {
      goToView('ranked');
      loadRankedOverview({ silent: true });
      render();
    };
  }
  const openSplitTensDetailsBtn = document.getElementById('openSplitTensDetailsBtn');
  if (openSplitTensDetailsBtn) {
    openSplitTensDetailsBtn.onclick = () => {
      state.eventDetailsModalId = SPLIT_TENS_EVENT_ID;
      render();
    };
  }
  const viewRankHomeBtn = document.getElementById('viewRankHomeBtn');
  if (viewRankHomeBtn) {
    viewRankHomeBtn.onclick = () => {
      state.rankTimelineModalOpen = true;
      render();
    };
  }
  const toggleLeaderboardBtn = document.getElementById('toggleLeaderboardBtn');
  if (toggleLeaderboardBtn) {
    toggleLeaderboardBtn.onclick = () => {
      state.leaderboardExpanded = !state.leaderboardExpanded;
      render();
    };
  }
  app.querySelectorAll('[data-home-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.homeToggle;
      if (!key) return;
      state.homeSections[key] = !state.homeSections[key];
      render();
    };
  });
  const highRollerPvpBtn = document.getElementById('highRollerPvpBtn');
  if (highRollerPvpBtn) {
    highRollerPvpBtn.onclick = () => {
      if (!guardHighRollerAccess()) return;
      createHighRollerLobby();
    };
  }
  const highRollerBotBtn = document.getElementById('highRollerBotBtn');
  if (highRollerBotBtn) {
    highRollerBotBtn.onclick = () => {
      if (state.botMatchLaunch?.pending) return;
      if (!guardHighRollerAccess()) return;
      startBotMatch({ highRoller: true, stakeType: 'REAL' });
    };
  }
  const quickPlayBtn = document.getElementById('quickPlayBtn');
  quickPlayBtn.onclick = () => {
    if (offlineModeEnabled()) {
      pushToast('Quick Play unavailable offline.');
      return;
    }
    if (rankedQueueIsActive()) {
      pushToast('Cancel ranked queue first.');
      return;
    }
    if (quickPlayIsActive()) return;
    state.quickPlay.bucketPickerOpen = true;
    render();
  };
  if (!quickPlaySearching && !quickPlayConnected && document.activeElement === document.body) {
    quickPlayBtn.focus({ preventScroll: true });
  }
  const botGrid = document.getElementById('botDifficultyGrid');
  if (botGrid) {
    const selectBot = (difficulty) => {
      if (state.botMatchLaunch?.pending) return;
      if (!difficulty || !BOT_BET_RANGES[difficulty]) return;
      if (state.selectedBotDifficulty === difficulty) return;
      state.selectedBotDifficulty = difficulty;
      render();
    };
    botGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-bot]');
      if (!button) return;
      event.preventDefault();
      selectBot(button.dataset.bot);
    });
    botGrid.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const button = event.target.closest('[data-bot]');
      if (!button) return;
      event.preventDefault();
      selectBot(button.dataset.bot);
    });
  }
  const playPracticeBotBtn = document.getElementById('playPracticeBotBtn');
  if (playPracticeBotBtn) {
    playPracticeBotBtn.onclick = () => {
      if (state.botMatchLaunch?.pending) return;
      startPracticeBotMatch();
    };
  }
  const playRealBotBtn = document.getElementById('playRealBotBtn');
  if (playRealBotBtn) {
    playRealBotBtn.onclick = () => {
      if (state.botMatchLaunch?.pending) return;
      startBotMatch({ stakeType: 'REAL' });
    };
  }
  const openStatsMoreBtn = document.getElementById('openStatsMoreBtn');
  if (openStatsMoreBtn) {
    openStatsMoreBtn.onclick = () => {
      state.statsMoreOpen = true;
      render();
    };
  }
  const statsMoreModal = document.getElementById('statsMoreModal');
  if (statsMoreModal) {
    statsMoreModal.onclick = () => {
      state.statsMoreOpen = false;
      render();
    };
  }
  const closeStatsMoreBtn = document.getElementById('closeStatsMoreBtn');
  if (closeStatsMoreBtn) {
    closeStatsMoreBtn.onclick = () => {
      state.statsMoreOpen = false;
      render();
    };
  }
  const statsMorePanel = app.querySelector('.stats-more-panel');
  if (statsMorePanel) {
    statsMorePanel.onclick = (event) => event.stopPropagation();
  }

  const claimBtn = document.getElementById('claimFreeBtn');
  if (claimBtn) claimBtn.onclick = claimFree100;
  const openBetHistoryModalBtn = document.getElementById('openBetHistoryModalBtn');
  if (openBetHistoryModalBtn) {
    openBetHistoryModalBtn.onclick = () => {
      state.betHistoryModalOpen = true;
      render();
    };
  }
  const betHistoryModal = document.getElementById('betHistoryModal');
  if (betHistoryModal) {
    betHistoryModal.onclick = () => {
      state.betHistoryModalOpen = false;
      render();
    };
  }
  const closeBetHistoryModalBtn = document.getElementById('closeBetHistoryModalBtn');
  if (closeBetHistoryModalBtn) {
    closeBetHistoryModalBtn.onclick = () => {
      state.betHistoryModalOpen = false;
      render();
    };
  }
  const betHistoryModalPanel = app.querySelector('.bet-history-modal-panel');
  if (betHistoryModalPanel) {
    betHistoryModalPanel.onclick = (event) => event.stopPropagation();
  }
  const openRulesBtn = document.getElementById('openRulesBtn');
  if (openRulesBtn) {
    openRulesBtn.onclick = () => {
      goToView('rules');
      render();
    };
  }
  const splitTensEventModal = document.getElementById('splitTensEventModal');
  if (splitTensEventModal) {
    splitTensEventModal.onclick = () => {
      state.eventDetailsModalId = null;
      render();
    };
  }
  const closeSplitTensDetailsBtn = document.getElementById('closeSplitTensDetailsBtn');
  if (closeSplitTensDetailsBtn) {
    closeSplitTensDetailsBtn.onclick = () => {
      state.eventDetailsModalId = null;
      render();
    };
  }
  const splitTensEventModalPanel = app.querySelector('.split-tens-event-modal');
  if (splitTensEventModalPanel) {
    splitTensEventModalPanel.onclick = (event) => event.stopPropagation();
  }
  const rankTimelineModal = document.getElementById('rankTimelineModal');
  if (rankTimelineModal) {
    rankTimelineModal.onclick = () => {
      state.rankTimelineModalOpen = false;
      render();
    };
  }
  const closeRankTimelineBtn = document.getElementById('closeRankTimelineBtn');
  if (closeRankTimelineBtn) {
    closeRankTimelineBtn.onclick = () => {
      state.rankTimelineModalOpen = false;
      render();
    };
  }
  const rankTimelinePanel = app.querySelector('.rank-timeline-modal');
  if (rankTimelinePanel) {
    rankTimelinePanel.onclick = (event) => event.stopPropagation();
  }
  syncFreeClaimUI();
  syncEventCountdownUI();
}

function renderProfile() {
  const me = state.me;
  const preview = `https://api.dicebear.com/9.x/${encodeURIComponent(me.avatarStyle || 'adventurer')}/svg?seed=${encodeURIComponent(
    me.avatarSeed || me.username
  )}`;
  const titleCatalog = titleCatalogForUserClient(me);
  const level = Math.max(1, Math.floor(Number(me.level) || 1));
  const levelProgress = state.xpUi.level === level
    ? Math.max(0, Math.min(1, Number(state.xpUi.progress) || 0))
    : Math.max(0, Math.min(1, Number(me.levelProgress) || 0));
  const levelPercent = Math.round(levelProgress * 100);
  const rankTier = rankTierLabelFromUser(me);
  const rankElo = Math.max(0, Math.floor(Number(me.rankedElo) || 0));
  const rankWins = Math.max(0, Math.floor(Number(me.rankedWins) || 0));
  const rankLosses = Math.max(0, Math.floor(Number(me.rankedLosses) || 0));
  const selectedBorderId = normalizeProfileBorderIdClient(me.selectedBorderId);
  const profileBorders = profileBordersForUser(me);
  const selectedBorder = profileBorders.find((border) => border.id === selectedBorderId) || profileBorders[0] || PROFILE_BORDER_DEFS[0];
  const deckSkins = deckSkinsForUser(me);
  const selectedDeckSkin = deckSkinForUser(me);
  const titleCategories = ['ALL', ...new Set(titleCatalog.map((entry) => String(entry.category || 'skill').trim().toUpperCase()).filter(Boolean))];
  const titleOwnershipFilter = normalizeTitleOwnershipFilter(state.profileTitleOwnershipFilter);
  const titleCategoryFilter = normalizeTitleCategoryFilter(state.profileTitleCategoryFilter, titleCategories);
  const titleSearch = String(state.profileTitleSearch || '').trim().toLowerCase();
  state.profileTitleOwnershipFilter = titleOwnershipFilter;
  state.profileTitleCategoryFilter = titleCategoryFilter;
  const equippedTitleKey = String(me.selectedTitleKey || '').trim().toUpperCase();
  const titleDraftKey = String(state.profileTitleDraftKey || equippedTitleKey || '').trim().toUpperCase();
  const titlePickerRows = titleCatalog.filter((entry) => {
    if (titleOwnershipFilter === 'UNLOCKED' && !entry.unlocked) return false;
    if (titleOwnershipFilter === 'LOCKED' && entry.unlocked) return false;
    if (titleCategoryFilter !== 'ALL' && String(entry.category || '').trim().toUpperCase() !== titleCategoryFilter) return false;
    if (!titleSearch) return true;
    const haystack = `${entry.label} ${entry.requirementText} ${entry.description} ${entry.category}`.toLowerCase();
    return haystack.includes(titleSearch);
  });
  const selectedTitleDraftEntry = titleCatalog.find((entry) => entry.key === titleDraftKey) || null;
  const nextBorderUnlockLevel = Number.isFinite(Number(me.nextBorderUnlockLevel))
    ? Math.max(1, Math.floor(Number(me.nextBorderUnlockLevel)))
    : ((profileBorders.find((border) => level < border.minLevelRequired)?.minLevelRequired) || null);
  const favoriteStats = favoriteStatOptionsForUser(me);
  const selectedFavoriteKey = normalizeFavoriteStatKey(me.favoriteStatKey);
  const selectedFavorite = favoriteStats.find((entry) => entry.key === selectedFavoriteKey) || favoriteStats[0];
  const favoriteDraftKey = normalizeFavoriteStatKey(state.favoriteStatDraftKey || selectedFavorite.key);
  const favoriteStatFilter = String(state.favoriteStatFilter || '').trim().toLowerCase();
  const filteredFavoriteStats = favoriteStatFilter
    ? favoriteStats.filter((entry) => {
        const haystack = `${entry.label} ${entry.description} ${entry.key}`.toLowerCase();
        return haystack.includes(favoriteStatFilter);
      })
    : favoriteStats;
  const coreFavoriteStats = filteredFavoriteStats.filter((entry) => CORE_FAVORITE_STAT_KEYS.has(entry.key));
  const otherFavoriteStats = filteredFavoriteStats.filter((entry) => !CORE_FAVORITE_STAT_KEYS.has(entry.key));
  const titleInfoEntry = titleCatalogEntryByKeyClient(me, state.titleInfoModalKey);
  const defaultProfileSections = {
    identity: true,
    progress: true,
    borders: false,
    social: true,
    titles: false,
    security: false
  };
  if (!state.profileSections || typeof state.profileSections !== 'object') {
    state.profileSections = { ...defaultProfileSections };
  } else {
    for (const [key, isOpen] of Object.entries(defaultProfileSections)) {
      if (typeof state.profileSections[key] !== 'boolean') state.profileSections[key] = isOpen;
    }
  }
  const sectionOpen = state.profileSections;
  const renderFavoriteStatRows = (entries = []) => entries.map((entry) => `
    <button class="favorite-stat-option ${entry.key === favoriteDraftKey ? 'is-selected' : ''}" type="button" data-favorite-stat-select="${entry.key}">
      <div class="favorite-stat-option-head">
        <strong>${entry.label}</strong>
        <span class="favorite-stat-option-value">${entry.valueText}</span>
      </div>
      <div class="muted">${entry.description}</div>
    </button>
  `).join('');
  const renderProfileSection = (key, title, body) => {
    const open = Boolean(sectionOpen[key]);
    return `
      <section class="profile-accordion-section profile-group">
        <button class="profile-accordion-toggle" data-profile-toggle="${key}" type="button" aria-expanded="${open}">
          <span>${title}</span>
          <span class="muted">${open ? 'Hide' : 'Show'}</span>
        </button>
        ${open ? `<div class="profile-accordion-body">${body}</div>` : ''}
      </section>
    `;
  };
  const identityBody = `
    <div class="profile-two-col">
      <div class="profile-form-grid">
        <label>Username</label>
        <input value="${me.username}" disabled />
        <label>Avatar Style</label>
        <select name="avatar_style">
          ${['adventurer', 'pixel-art', 'bottts', 'fun-emoji']
            .map((s) => `<option value="${s}" ${me.avatarStyle === s ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
        <label>Avatar Seed</label>
        <input name="avatar_seed" value="${me.avatarSeed || me.username}" />
        <label>Deck Skin</label>
        <select name="selected_deck_skin">
          ${deckSkins.map((skin) => `<option value="${skin.id}" ${normalizeDeckSkinId(me.selectedDeckSkin) === skin.id ? 'selected' : ''} ${skin.unlocked ? '' : 'disabled'}>${skin.name}${skin.unlocked ? '' : ` (${skin.unlockHint || `Unlocks Lv ${skin.minLevelRequired}`})`}</option>`).join('')}
        </select>
        <label>Skin Library</label>
        <div class="profile-deck-skin-library">
          ${deckSkins.map((skin) => {
            const active = selectedDeckSkin.id === skin.id;
            const statusText = skin.unlocked ? 'Owned' : (skin.unlockHint || `Unlocks Lv ${skin.minLevelRequired}`);
            return `<button
              class="profile-deck-skin-chip ${active ? 'is-active' : ''} ${skin.unlocked ? 'is-unlocked' : 'is-locked'}"
              type="button"
              data-deck-skin-preview="${skin.id}"
              data-deck-skin-select="${skin.id}"
              data-deck-skin-unlocked="${skin.unlocked ? '1' : '0'}"
              data-deck-skin-name="${skin.name}"
              data-deck-skin-description="${skin.description || ''}"
              data-deck-skin-token="${skin.token || 'classic'}"
              data-deck-skin-status="${statusText}"
              title="${statusText}"
            >
              <span>${skin.name}</span>
              <small>${statusText}</small>
            </button>`;
          }).join('')}
        </div>
      </div>
      <div class="profile-preview-card">
        <label>Preview</label>
        <div class="profile-preview-row">
          <img src="${preview}" alt="avatar preview" class="profile-avatar-preview" />
          <span class="muted">Generated automatically</span>
        </div>
        <div class="profile-deck-skin-preview deck-skin-${selectedDeckSkin.token}" id="profileDeckSkinPreview" data-selected-skin-id="${selectedDeckSkin.id}">
          <div class="profile-deck-skin-preview-head">
            <strong id="profileDeckSkinPreviewName">${selectedDeckSkin.name}</strong>
            <span class="muted" id="profileDeckSkinPreviewStatus">${selectedDeckSkin.unlocked ? 'Owned' : (selectedDeckSkin.unlockHint || `Unlocks Lv ${selectedDeckSkin.minLevelRequired}`)}</span>
          </div>
          <span class="muted" id="profileDeckSkinPreviewDesc">${selectedDeckSkin.description}</span>
          <div class="profile-deck-skin-cards" aria-hidden="true">
            <article class="profile-sample-card black"><span class="profile-sample-card-corner">A♠</span><span class="profile-sample-card-center">♠</span></article>
            <article class="profile-sample-card red"><span class="profile-sample-card-corner">10♦</span><span class="profile-sample-card-center">♦</span></article>
            <article class="profile-sample-card red"><span class="profile-sample-card-corner">K♥</span><span class="profile-sample-card-center">♥</span></article>
          </div>
        </div>
      </div>
    </div>
  `;
  const progressBody = `
    <div class="profile-progress">
      <div class="profile-progress-head">
        <strong>Level ${level}</strong>
        <span class="muted">${Math.max(0, Math.floor(Number(me.xpToNextLevel) || 0)).toLocaleString()} XP to next level</span>
      </div>
      <div class="xp-track ${Date.now() < state.xpUi.pulseUntil ? 'is-pulsing' : ''}"><span class="xp-fill" data-xp-fill style="width:${levelPercent}%"></span></div>
    </div>
    <div class="profile-summary-grid">
      <div class="profile-summary-item"><span class="muted">Rank</span><strong>${rankTier}</strong></div>
      <div class="profile-summary-item"><span class="muted">Elo</span><strong>${rankElo.toLocaleString()}</strong></div>
      <div class="profile-summary-item"><span class="muted">Ranked W-L</span><strong>${rankWins}-${rankLosses}</strong></div>
      <div class="profile-summary-item"><span class="muted">Leaderboard</span><strong>${me.leaderboardRank ? `#${me.leaderboardRank}` : 'Unranked'}</strong></div>
    </div>
  `;
  const socialBody = `
    <div class="profile-form-grid">
      <label>Custom Stat (public)</label>
      <input name="custom_stat_text" maxlength="60" value="${me.customStatText || ''}" placeholder="Favorite Bet: 250" />
    </div>
    <div class="profile-favorite-row">
      <label>Favorite Stat</label>
      <div class="profile-favorite-selected">
        <div>
          <strong>${selectedFavorite.label}</strong>
          <div class="muted">${selectedFavorite.description}</div>
        </div>
        <div class="profile-favorite-value">${selectedFavorite.valueText}</div>
      </div>
      <button id="openFavoriteStatModalBtn" class="primary profile-favorite-open-btn" type="button">Choose Favorite Stat</button>
    </div>
  `;
  const bordersBody = `
    <div class="profile-border-head">
      <div>
        <label>Profile Border</label>
        <div class="muted">Cosmetic frame unlocked every 10 levels.</div>
      </div>
      <div class="profile-border-current muted">Equipped: <strong>${selectedBorder?.name || 'None'}</strong></div>
    </div>
    <div class="profile-borders-grid">
      ${profileBorders.map((border) => {
        const unlocked = Boolean(border.unlocked);
        const equipped = selectedBorderId === border.id;
        const pending = state.profileBorderSavingId === border.id;
        return `<article class="profile-border-option ${unlocked ? 'unlocked' : 'locked'} ${equipped ? 'equipped' : ''}">
          <div class="profile-border-preview profile-border-frame profile-border-token-${border.previewToken}" aria-hidden="true"></div>
          <div class="profile-border-option-info">
            <strong>${border.name}</strong>
            <span class="muted">${border.tier} • ${unlocked ? 'Unlocked' : `Unlocks at level ${border.minLevelRequired}`}</span>
          </div>
          <div class="profile-border-option-actions">
            ${
              unlocked
                ? `<button class="${equipped ? 'ghost' : 'primary'}" type="button" data-profile-border-equip="${border.id}" ${equipped || pending || state.profileBorderSavingId ? 'disabled' : ''}>
                    ${pending ? 'Equipping...' : equipped ? 'Equipped' : 'Equip'}
                  </button>`
                : `<span class="muted">Locked</span>`
            }
          </div>
        </article>`;
      }).join('')}
    </div>
    <div class="muted profile-border-next">${nextBorderUnlockLevel ? `Next border at Level ${nextBorderUnlockLevel}` : 'All profile borders unlocked.'}</div>
  `;
  const titlesBody = `
    <div class="titles-equip">
      <label>Displayed Title</label>
      <input type="hidden" name="selected_title" value="${selectedTitleDraftEntry?.key || ''}" />
      <div class="title-current-card">
        <div>
          <strong>${selectedTitleDraftEntry?.label || 'None'}</strong>
          <div class="muted">${selectedTitleDraftEntry ? (selectedTitleDraftEntry.description || selectedTitleDraftEntry.requirementText || 'Unlocked title') : 'No title equipped.'}</div>
        </div>
        <span class="title-current-status ${selectedTitleDraftEntry ? 'is-owned' : ''}">${selectedTitleDraftEntry ? 'Owned' : 'Default'}</span>
      </div>
      <div class="row title-picker-actions">
        <button id="openTitlePickerBtn" class="primary" type="button">Choose Title</button>
        <button id="clearTitlePickerBtn" class="ghost" type="button" ${selectedTitleDraftEntry ? '' : 'disabled'}>Clear</button>
        <button id="openSelectedTitleInfoBtn" class="ghost" type="button" ${selectedTitleDraftEntry ? '' : 'disabled'}>View Unlock Details</button>
      </div>
      <div class="muted">Equipped title updates when you save profile.</div>
    </div>
  `;
  const securityBody = `
    <div class="profile-security-row">
      <strong>Login PIN:</strong>
      <span>${state.revealPin ? me.pin || '****' : me.pinMasked || '****'}</span>
      <button id="togglePinBtn" class="ghost" type="button">${state.revealPin ? 'Hide PIN' : 'Show PIN'}</button>
      <button id="copyPinBtnProfile" class="ghost" type="button">Copy PIN</button>
    </div>
  `;
  app.innerHTML = `
    ${renderTopbar('Profile')}
    <main class="view-stack">
      <div class="card section profile-shell">
        <div class="profile-header-card profile-border-frame profile-border-token-${selectedBorder?.previewToken || 'none'}">
          <div class="row profile-name-row" style="align-items:center;gap:8px;margin-bottom:0">
            <strong>${me.username}</strong>
            ${renderRankTierBadge(me)}
            ${renderBadgePill(me.dynamicBadge)}
            ${me.selectedTitle ? `<span class="nameplate-title">${me.selectedTitle}</span>` : ''}
          </div>
        </div>
        <form id="profileForm" class="profile-form">
          ${renderProfileSection('identity', 'Identity', identityBody)}
          ${renderProfileSection('progress', 'Progress & Rank', progressBody)}
          ${renderProfileSection('borders', 'Profile Border', bordersBody)}
          ${renderProfileSection('social', 'Social', socialBody)}
          ${renderProfileSection('titles', 'Titles', titlesBody)}
          ${renderProfileSection('security', 'Security', securityBody)}
          <div class="profile-save-row">
            <button class="primary" id="saveProfileBtn" type="submit" ${state.profileSaving ? 'disabled' : ''}>
              ${state.profileSaving ? '<span class="btn-spinner" aria-hidden="true"></span>Saving...' : 'Save Profile'}
            </button>
            <p class="muted profile-save-meta">Chip balance: ${me.chips} • Rank ${me.leaderboardRank ? `#${me.leaderboardRank}` : 'Unranked'} • PvP ${me.pvpWins || 0}-${me.pvpLosses || 0}</p>
          </div>
        </form>
      </div>
    </main>
    ${
      state.favoriteStatModalOpen
        ? `<div class="modal" id="favoriteStatModal">
            <div class="modal-panel card favorite-stat-modal" role="dialog" aria-modal="true" aria-label="Choose favorite stat">
              <div class="favorite-stat-modal-head stats-more-head">
                <div>
                  <h3>Choose Favorite Stat</h3>
                  <p class="muted">Pick one stat to display publicly on your profile.</p>
                </div>
                <button id="closeFavoriteStatModalBtn" class="ghost" type="button">Cancel</button>
              </div>
              <label class="favorite-stat-search">
                <span class="muted">Search stats</span>
                <input id="favoriteStatSearchInput" type="text" placeholder="Search stats..." value="${state.favoriteStatFilter || ''}" />
              </label>
              <div class="favorite-stat-list">
                ${
                  !filteredFavoriteStats.length
                    ? '<div class="muted favorite-stat-empty">No stats match your search.</div>'
                    : `
                      ${coreFavoriteStats.length ? `<section class="favorite-stat-group"><div class="favorite-stat-group-title">Core Stats</div>${renderFavoriteStatRows(coreFavoriteStats)}</section>` : ''}
                      ${otherFavoriteStats.length ? `<section class="favorite-stat-group"><div class="favorite-stat-group-title">Other Stats</div>${renderFavoriteStatRows(otherFavoriteStats)}</section>` : ''}
                    `
                }
              </div>
              <div class="row profile-favorite-modal-actions favorite-stat-modal-foot">
                <button id="cancelFavoriteStatModalBtn" class="ghost" type="button">Cancel</button>
                <button id="saveFavoriteStatModalBtn" class="primary" type="button">Save</button>
              </div>
            </div>
          </div>`
        : ''
    }
    ${
      state.profileTitlePickerOpen
        ? `<div class="modal" id="titlePickerModal">
            <div class="modal-panel card title-picker-modal" role="dialog" aria-modal="true" aria-label="Choose displayed title">
              <div class="title-picker-head stats-more-head">
                <div>
                  <h3>Choose Displayed Title</h3>
                  <p class="muted">Search and select a title to show on your profile.</p>
                </div>
                <button id="closeTitlePickerBtn" class="ghost" type="button">Cancel</button>
              </div>
              <div class="title-picker-controls">
                <label>
                  <span class="muted">Search</span>
                  <input id="titlePickerSearchInput" type="text" placeholder="Search titles..." value="${state.profileTitleSearch || ''}" />
                </label>
                <label>
                  <span class="muted">Status</span>
                  <select id="titlePickerOwnershipFilter">
                    <option value="ALL" ${titleOwnershipFilter === 'ALL' ? 'selected' : ''}>All</option>
                    <option value="UNLOCKED" ${titleOwnershipFilter === 'UNLOCKED' ? 'selected' : ''}>Owned</option>
                    <option value="LOCKED" ${titleOwnershipFilter === 'LOCKED' ? 'selected' : ''}>Locked</option>
                  </select>
                </label>
                <label>
                  <span class="muted">Category</span>
                  <select id="titlePickerCategoryFilter">
                    ${titleCategories.map((category) => `<option value="${category}" ${titleCategoryFilter === category ? 'selected' : ''}>${category === 'ALL' ? 'All' : category.charAt(0) + category.slice(1).toLowerCase()}</option>`).join('')}
                  </select>
                </label>
              </div>
              <div class="title-picker-list">
                <button class="title-picker-row ${titleDraftKey ? '' : 'is-selected'} is-owned" type="button" data-title-picker-select="">
                  <div class="title-picker-row-left">
                    <strong>None</strong>
                    <span class="muted">No title equipped.</span>
                  </div>
                  <div class="title-picker-row-right">
                    <span class="title-picker-status">Default</span>
                  </div>
                </button>
                ${
                  titlePickerRows.length
                    ? titlePickerRows.map((entry) => {
                        const unlocked = Boolean(entry.unlocked);
                        const selected = titleDraftKey === entry.key;
                        return `<button class="title-picker-row ${selected ? 'is-selected' : ''} ${unlocked ? 'is-owned' : 'is-locked'}" type="button" data-title-picker-select="${entry.key}">
                          <div class="title-picker-row-left">
                            <strong>${entry.label}</strong>
                            <span class="muted">${entry.description || entry.requirementText || 'Title unlock details'}</span>
                          </div>
                          <div class="title-picker-row-right">
                            <span class="title-picker-status">${unlocked ? 'Owned' : 'Locked'}</span>
                            <span class="muted">${unlocked ? 'Ready to equip' : entry.requirementText}</span>
                          </div>
                        </button>`;
                      }).join('')
                    : '<div class="title-picker-empty muted">No titles match this filter.</div>'
                }
              </div>
              <div class="title-picker-foot row">
                <button id="cancelTitlePickerBtn" class="ghost" type="button">Cancel</button>
                <button id="saveTitlePickerBtn" class="primary" type="button">Use Selected Title</button>
              </div>
            </div>
          </div>`
        : ''
    }
    ${
      titleInfoEntry
        ? `<div class="modal" id="titleInfoModal">
            <div class="modal-panel card title-info-modal" role="dialog" aria-modal="true" aria-label="Title details">
              <div class="stats-more-head">
                <h3>${titleInfoEntry.label}</h3>
                <button id="closeTitleInfoModalBtn" class="ghost" type="button">Close</button>
              </div>
              <div class="muted">Category: ${titleInfoEntry.category || 'skill'}</div>
              <p class="title-info-description">${titleInfoEntry.description || titleInfoEntry.requirementText}</p>
              <div class="title-info-rule card">
                <strong>Unlock requirement</strong>
                <div class="muted">${titleInfoEntry.requirementText || 'No requirement'}</div>
              </div>
            </div>
          </div>`
        : ''
    }
  `;
  bindShellNav();
  app.querySelectorAll('[data-profile-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const key = String(btn.dataset.profileToggle || '').trim();
      if (!key) return;
      state.profileSections[key] = !Boolean(state.profileSections[key]);
      render();
    };
  });
  const deckSkinSelect = app.querySelector('[name="selected_deck_skin"]');
  const deckSkinPreviewPanel = document.getElementById('profileDeckSkinPreview');
  const deckSkinPreviewName = document.getElementById('profileDeckSkinPreviewName');
  const deckSkinPreviewDesc = document.getElementById('profileDeckSkinPreviewDesc');
  const deckSkinPreviewStatus = document.getElementById('profileDeckSkinPreviewStatus');
  const paintDeckSkinPreview = (skinId) => {
    if (!deckSkinPreviewPanel) return;
    const normalized = normalizeDeckSkinId(skinId);
    const source = app.querySelector(`[data-deck-skin-preview="${normalized}"]`);
    if (!source) return;
    const token = String(source.dataset.deckSkinToken || 'classic').trim() || 'classic';
    deckSkinPreviewPanel.className = `profile-deck-skin-preview deck-skin-${token}`;
    if (deckSkinPreviewName) deckSkinPreviewName.textContent = source.dataset.deckSkinName || 'Deck Skin';
    if (deckSkinPreviewDesc) deckSkinPreviewDesc.textContent = source.dataset.deckSkinDescription || '';
    if (deckSkinPreviewStatus) deckSkinPreviewStatus.textContent = source.dataset.deckSkinStatus || '';
  };
  const syncDeckSkinSelectionState = () => {
    const selectedId = normalizeDeckSkinId(deckSkinSelect?.value || selectedDeckSkin.id || 'CLASSIC');
    app.querySelectorAll('[data-deck-skin-select]').forEach((btn) => {
      btn.classList.toggle('is-active', normalizeDeckSkinId(btn.dataset.deckSkinSelect) === selectedId);
    });
    paintDeckSkinPreview(selectedId);
  };
  if (deckSkinSelect) {
    deckSkinSelect.addEventListener('change', syncDeckSkinSelectionState);
  }
  app.querySelectorAll('[data-deck-skin-preview]').forEach((btn) => {
    btn.onmouseenter = () => paintDeckSkinPreview(btn.dataset.deckSkinPreview);
    btn.onfocus = () => paintDeckSkinPreview(btn.dataset.deckSkinPreview);
    btn.onmouseleave = () => syncDeckSkinSelectionState();
    btn.onblur = () => syncDeckSkinSelectionState();
    btn.onclick = () => {
      const skinId = normalizeDeckSkinId(btn.dataset.deckSkinSelect);
      const unlocked = btn.dataset.deckSkinUnlocked === '1';
      if (!unlocked) {
        pushToast(btn.dataset.deckSkinStatus || 'Deck skin is locked.');
        return;
      }
      if (deckSkinSelect) {
        deckSkinSelect.value = skinId;
      }
      syncDeckSkinSelectionState();
    };
  });
  syncDeckSkinSelectionState();
  app.querySelectorAll('[data-profile-border-equip]').forEach((btn) => {
    btn.onclick = () => {
      const borderId = String(btn.dataset.profileBorderEquip || '').trim().toUpperCase();
      if (!borderId) return;
      equipProfileBorder(borderId);
    };
  });
  const openTitlePickerBtn = document.getElementById('openTitlePickerBtn');
  if (openTitlePickerBtn) {
    openTitlePickerBtn.onclick = () => {
      state.profileTitleDraftKey = selectedTitleDraftEntry?.key || '';
      state.profileTitleModalOriginKey = selectedTitleDraftEntry?.key || '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
      state.profileTitlePickerOpen = true;
      render();
    };
  }
  const clearTitlePickerBtn = document.getElementById('clearTitlePickerBtn');
  if (clearTitlePickerBtn) {
    clearTitlePickerBtn.onclick = () => {
      state.profileTitleDraftKey = '';
      render();
    };
  }
  const openSelectedTitleInfoBtn = document.getElementById('openSelectedTitleInfoBtn');
  if (openSelectedTitleInfoBtn) {
    openSelectedTitleInfoBtn.onclick = () => {
      if (!selectedTitleDraftEntry?.key) return;
      state.titleInfoModalKey = selectedTitleDraftEntry.key;
      render();
    };
  }
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
  const openFavoriteStatModalBtn = document.getElementById('openFavoriteStatModalBtn');
  if (openFavoriteStatModalBtn) {
    openFavoriteStatModalBtn.onclick = () => {
      state.favoriteStatDraftKey = selectedFavorite.key;
      state.favoriteStatFilter = '';
      state.favoriteStatModalOpen = true;
      render();
    };
  }
  const favoriteStatModal = document.getElementById('favoriteStatModal');
  if (favoriteStatModal) {
    favoriteStatModal.onclick = () => {
      state.favoriteStatModalOpen = false;
      state.favoriteStatDraftKey = '';
      state.favoriteStatFilter = '';
      render();
    };
  }
  const favoriteStatPanel = app.querySelector('.favorite-stat-modal');
  if (favoriteStatPanel) {
    favoriteStatPanel.onclick = (event) => event.stopPropagation();
  }
  const closeFavoriteStatModalBtn = document.getElementById('closeFavoriteStatModalBtn');
  if (closeFavoriteStatModalBtn) {
    closeFavoriteStatModalBtn.onclick = () => {
      state.favoriteStatModalOpen = false;
      state.favoriteStatDraftKey = '';
      state.favoriteStatFilter = '';
      render();
    };
  }
  const cancelFavoriteStatModalBtn = document.getElementById('cancelFavoriteStatModalBtn');
  if (cancelFavoriteStatModalBtn) {
    cancelFavoriteStatModalBtn.onclick = () => {
      state.favoriteStatModalOpen = false;
      state.favoriteStatDraftKey = '';
      state.favoriteStatFilter = '';
      render();
    };
  }
  const favoriteStatSearchInput = document.getElementById('favoriteStatSearchInput');
  if (favoriteStatSearchInput) {
    favoriteStatSearchInput.addEventListener('input', (event) => {
      state.favoriteStatFilter = String(event.target.value || '');
      render();
    });
  }
  const saveFavoriteStatModalBtn = document.getElementById('saveFavoriteStatModalBtn');
  if (saveFavoriteStatModalBtn) {
    saveFavoriteStatModalBtn.onclick = () => {
      saveFavoriteStatPreference(state.favoriteStatDraftKey || selectedFavorite.key);
    };
  }
  app.querySelectorAll('[data-favorite-stat-select]').forEach((btn) => {
    btn.onclick = () => {
      const nextKey = normalizeFavoriteStatKey(btn.dataset.favoriteStatSelect);
      state.favoriteStatDraftKey = nextKey;
      render();
    };
  });
  const titlePickerModal = document.getElementById('titlePickerModal');
  if (titlePickerModal) {
    titlePickerModal.onclick = () => {
      state.profileTitlePickerOpen = false;
      state.profileTitleDraftKey = state.profileTitleModalOriginKey || state.profileTitleDraftKey || '';
      state.profileTitleModalOriginKey = '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
      render();
    };
  }
  const titlePickerPanel = app.querySelector('.title-picker-modal');
  if (titlePickerPanel) {
    titlePickerPanel.onclick = (event) => event.stopPropagation();
  }
  const closeTitlePickerBtn = document.getElementById('closeTitlePickerBtn');
  if (closeTitlePickerBtn) {
    closeTitlePickerBtn.onclick = () => {
      state.profileTitlePickerOpen = false;
      state.profileTitleDraftKey = state.profileTitleModalOriginKey || state.profileTitleDraftKey || '';
      state.profileTitleModalOriginKey = '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
      render();
    };
  }
  const cancelTitlePickerBtn = document.getElementById('cancelTitlePickerBtn');
  if (cancelTitlePickerBtn) {
    cancelTitlePickerBtn.onclick = () => {
      state.profileTitlePickerOpen = false;
      state.profileTitleDraftKey = state.profileTitleModalOriginKey || state.profileTitleDraftKey || '';
      state.profileTitleModalOriginKey = '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
      render();
    };
  }
  const saveTitlePickerBtn = document.getElementById('saveTitlePickerBtn');
  if (saveTitlePickerBtn) {
    saveTitlePickerBtn.onclick = () => {
      state.profileTitlePickerOpen = false;
      state.profileTitleModalOriginKey = '';
      state.profileTitleSearch = '';
      state.profileTitleOwnershipFilter = 'ALL';
      state.profileTitleCategoryFilter = 'ALL';
      render();
    };
  }
  app.querySelectorAll('[data-title-picker-select]').forEach((btn) => {
    btn.onclick = () => {
      const key = String(btn.dataset.titlePickerSelect || '').trim().toUpperCase();
      if (!key) {
        state.profileTitleDraftKey = '';
        render();
        return;
      }
      const entry = titleCatalog.find((title) => title.key === key);
      if (!entry) return;
      if (!entry.unlocked) {
        state.titleInfoModalKey = entry.key;
        pushToast(entry.requirementText || 'Title is locked.');
        render();
        return;
      }
      state.profileTitleDraftKey = key;
      render();
    };
  });
  const titlePickerSearchInput = document.getElementById('titlePickerSearchInput');
  if (titlePickerSearchInput) {
    titlePickerSearchInput.addEventListener('input', (event) => {
      state.profileTitleSearch = String(event.target.value || '');
      render();
    });
  }
  const titlePickerOwnershipFilter = document.getElementById('titlePickerOwnershipFilter');
  if (titlePickerOwnershipFilter) {
    titlePickerOwnershipFilter.onchange = (event) => {
      state.profileTitleOwnershipFilter = normalizeTitleOwnershipFilter(event.target.value);
      render();
    };
  }
  const titlePickerCategoryFilter = document.getElementById('titlePickerCategoryFilter');
  if (titlePickerCategoryFilter) {
    titlePickerCategoryFilter.onchange = (event) => {
      state.profileTitleCategoryFilter = normalizeTitleCategoryFilter(event.target.value, titleCategories);
      render();
    };
  }
  const titleInfoModal = document.getElementById('titleInfoModal');
  if (titleInfoModal) {
    titleInfoModal.onclick = () => {
      state.titleInfoModalKey = '';
      render();
    };
  }
  const closeTitleInfoModalBtn = document.getElementById('closeTitleInfoModalBtn');
  if (closeTitleInfoModalBtn) {
    closeTitleInfoModalBtn.onclick = () => {
      state.titleInfoModalKey = '';
      render();
    };
  }
  const titleInfoPanel = app.querySelector('.title-info-modal');
  if (titleInfoPanel) {
    titleInfoPanel.onclick = (event) => event.stopPropagation();
  }
}

function renderFriends() {
  const inviteRemaining = state.friendInvite ? inviteRemainingMs() : 0;
  const inviteExpired = inviteRemaining <= 0;
  app.innerHTML = `
    ${renderTopbar('Friends')}
    <main class="view-stack friends-view">
      <div class="friends-layout">
      <section class="col card section friends-panel friends-panel-left">
        <div class="friends-panel-head">
          <h3>Send Friend Request</h3>
          <form id="friendForm" class="row friend-request-form">
            <input name="friend_username" placeholder="Friend username" />
            <button class="primary" type="submit">Request</button>
          </form>
        </div>
        <div class="friends-panel-scroll friends-left-scroll">
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
          <h3 class="friends-subhead">Incoming Friend Challenges</h3>
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
          <h3 class="friends-subhead">Incoming Requests</h3>
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
      </section>
      <section class="col card section friends-panel friends-panel-right">
        <div class="friends-panel-head">
          <h3>Friend List</h3>
          <p class="muted">Overall PvP: ${Math.max(0, Math.floor(Number(state.me?.pvpWins) || 0))}-${Math.max(0, Math.floor(Number(state.me?.pvpLosses) || 0))}</p>
        </div>
        <div class="friends-list-scroll">
          ${(state.friends || []).length === 0 ? '<p class="muted">No friends yet.</p>' : ''}
          ${(state.friends || [])
            .map(
              (f) => {
                const presence = resolveFriendPresence(f);
                return `
            <div class="friend">
              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${
                    f.avatarUrl || f.avatar
                      ? `<img src="${f.avatarUrl || f.avatar}" alt="${f.username} avatar" style="width:26px;height:26px;border-radius:999px;border:1px solid rgba(255,255,255,0.16)" />`
                      : `<span style="width:26px;height:26px;border-radius:999px;display:inline-grid;place-items:center;background:rgba(255,255,255,0.12)">${(f.username || '?').slice(0, 1).toUpperCase()}</span>`
                  }
                  <span class="status-dot status-${presence.presenceKey}"></span>
                  <strong>${f.username}</strong>
                  ${renderRankTierBadge(f)}
                  ${renderBadgePill(f.dynamicBadge)}
                  <span class="muted">Lv ${Math.max(1, Math.floor(Number(f.level) || 1))}</span>
                </div>
                <div class="muted">${presence.label} • ${f.chips} chips</div>
                <div class="muted">You: ${Math.max(0, Number(f.headToHead?.wins) || 0)}-${Math.max(0, Number(f.headToHead?.losses) || 0)} vs ${f.username}${f.selectedTitle ? ` • ${f.selectedTitle}` : ''}</div>
                ${f.customStatText ? `<div class="muted">Stat: ${f.customStatText}</div>` : ''}
              </div>
              <div class="row">
                <button data-invite-open="${f.username}">Invite</button>
              </div>
            </div>
          `;
              }
            )
            .join('')}
        </div>
        <h3 class="friends-subhead">Outgoing Pending</h3>
        ${
          state.outgoingRequests.length
            ? state.outgoingRequests
                .map((r) => `<div class="friend"><div><strong>${r.username}</strong></div><span class="muted">Pending…</span></div>`)
                .join('')
            : '<p class="muted">No pending requests.</p>'
        }
      </section>
      </div>

    </main>
    ${
      state.inviteModeModalFriend
        ? `<div class="modal">
            <div class="modal-panel card">
              <h3>Invite ${state.inviteModeModalFriend}</h3>
              <p class="muted">Choose how you want to play.</p>
              <div class="invite-mode-list">
                <button type="button" class="invite-mode-option" id="inviteModeFriendlyBtn">
                  <strong>Friendly Battle</strong>
                  <span class="muted">No chips won/lost. Stats may track, but no balance changes.</span>
                </button>
                <button type="button" class="invite-mode-option invite-mode-option-real" id="inviteModeChallengeBtn">
                  <strong>Challenge</strong>
                  <span class="muted">Real chips. Winnings/losses affect balance.</span>
                </button>
              </div>
              <div class="row" style="margin-top:0.7rem">
                <button id="cancelInviteModeBtn" class="ghost">Cancel</button>
              </div>
            </div>
          </div>`
        : ''
    }
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
  app.querySelectorAll('[data-invite-open]').forEach((btn) => {
    btn.onclick = () => {
      state.inviteModeModalFriend = btn.dataset.inviteOpen;
      render();
    };
  });
  const inviteFriendlyBtn = document.getElementById('inviteModeFriendlyBtn');
  if (inviteFriendlyBtn) {
    inviteFriendlyBtn.onclick = () => {
      const username = state.inviteModeModalFriend;
      state.inviteModeModalFriend = null;
      if (username) inviteFriendToLobby(username, 'FAKE');
      else render();
    };
  }
  const inviteChallengeBtn = document.getElementById('inviteModeChallengeBtn');
  if (inviteChallengeBtn) {
    inviteChallengeBtn.onclick = () => {
      const username = state.inviteModeModalFriend;
      state.inviteModeModalFriend = null;
      state.challengeModalFriend = username;
      state.challengeBet = Math.max(5, Math.min(50, state.me?.chips || 50));
      state.challengeMessage = '';
      render();
    };
  }
  const cancelInviteModeBtn = document.getElementById('cancelInviteModeBtn');
  if (cancelInviteModeBtn) {
    cancelInviteModeBtn.onclick = () => {
      state.inviteModeModalFriend = null;
      render();
    };
  }
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
  const canCancelLobby = Boolean(lobby && state.me && lobby.ownerId === state.me.id && lobby.status === 'waiting');
  const hasPrefilledCode = Boolean((state.lobbyJoinInput || '').trim());
  const highRollerUnlocked = hasHighRollerAccess(state.me);
  app.innerHTML = `
    ${renderTopbar('Lobbies')}
    <main class="view-stack">
      <div class="row lobby-grid">
        <section class="col card section">
      <h3>Create Lobby</h3>
      <p class="muted">Create only when you want to host a private 1v1 room.</p>
      <div class="row lobby-create-actions">
        <div class="lobby-create-action">
          <button class="primary" id="createLobbyBtn">Create Lobby</button>
        </div>
        <div class="lobby-create-action high-roller-action">
          <button
            class="gold ${highRollerUnlocked ? '' : 'is-locked'}"
            id="createHighRollerLobbyBtn"
            ${highRollerUnlocked ? '' : `aria-disabled="true" title="Requires ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips"`}
          >High Roller</button>
          <div class="muted high-roller-lock-note">Requires ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips</div>
        </div>
      </div>
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
            <div class="muted">Owner: ${playerName(lobby.ownerId)} ${renderRankTierBadge(userLikeById(lobby.ownerId) || {})}</div>
            <div class="muted">Opponent: ${lobby.opponentId ? `${playerName(lobby.opponentId)} ${renderRankTierBadge(userLikeById(lobby.opponentId) || {})}` : 'Waiting...'}</div>
            <div class="muted">Mode: ${String(lobby.matchType || '').toUpperCase() === 'HIGH_ROLLER' ? 'High Roller' : (lobby.stakeType === 'REAL' ? 'Challenge' : 'Friendly')}</div>
          </div>
          <div class="row">
            <button id="copyLobbyCode">Copy Join Code</button>
            ${canCancelLobby ? '<button id="cancelLobbyBtn" class="warn" type="button">Cancel Lobby</button>' : ''}
          </div>
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
  const highRollerCreateBtn = document.getElementById('createHighRollerLobbyBtn');
  if (highRollerCreateBtn) {
    highRollerCreateBtn.onclick = () => {
      if (!guardHighRollerAccess()) return;
      createHighRollerLobby();
    };
  }

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
  const cancelBtn = document.getElementById('cancelLobbyBtn');
  if (cancelBtn && lobby) {
    cancelBtn.onclick = () => cancelLobby(lobby.id);
  }
}

function renderRanked() {
  const me = state.me;
  if (!state.rankedOverview) {
    loadRankedOverview({ silent: true });
  }
  const overview = state.rankedOverview || {};
  const tier = rankTierMetaFromUser({
    rankTierKey: overview.rankTierKey || me.rankTierKey,
    rankTier: overview.rankTier || me.rankTier,
    rankedElo: overview.elo || me.rankedElo
  });
  const fixedBet = Math.max(1, Math.floor(Number(overview.fixedBet || me.rankedFixedBet || me.rankedBetMin || tier.fixedBet) || 50));
  const rankedElo = Math.max(0, Math.floor(Number(overview.elo || me.rankedElo) || 0));
  const rankedWins = Math.max(0, Math.floor(Number(overview.rankedWins || me.rankedWins) || 0));
  const rankedLosses = Math.max(0, Math.floor(Number(overview.rankedLosses || me.rankedLosses) || 0));
  const canQueue = Boolean(overview.canQueue ?? (Math.floor(Number(me.chips) || 0) >= fixedBet));
  const queueDisabledReason = overview.disabledReason || `Need at least ${fixedBet.toLocaleString()} chips for this rank.`;
  const activeSeries = overview.activeSeries || null;
  const activeSeriesLive = Boolean(
    activeSeries &&
    (activeSeries.inProgress === true || String(activeSeries.status || '').toUpperCase() === 'IN_PROGRESS' || String(activeSeries.status || '').toLowerCase() === 'active') &&
    activeSeries.canContinue !== false &&
    (
      Number(activeSeries.nextGameIndex || 1) <= Number(activeSeries.targetGames || 9) ||
      Boolean(activeSeries.inTiebreaker)
    )
  );
  const markers = Array.isArray(activeSeries?.markers) ? activeSeries.markers : [];
  const mainMarkers = Array.from({ length: 9 }, (_, idx) => {
    const entry = markers.find((marker) => marker.gameIndex === idx + 1) || null;
    return {
      result: entry?.result || '',
      runningChipDelta: Number.isFinite(Number(entry?.runningChipDelta)) ? Number(entry.runningChipDelta) : null
    };
  });
  const tiebreakerMarkers = markers.filter((marker) => Number(marker.tiebreakerRound) > 0);
  const currentRankedMatch = Boolean(state.currentMatch && String(state.currentMatch?.matchType || '').toUpperCase() === 'RANKED');
  const searching = rankedQueueIsActive();
  const canContinue = currentRankedMatch || activeSeriesLive;
  const actionLabel = canContinue ? 'Continue Series' : 'Start Ranked Series';
  const actionDisabled = (!canQueue && !canContinue) || offlineModeEnabled();
  const forfeitDisabled = !currentRankedMatch || offlineModeEnabled();

  app.innerHTML = `
    ${renderTopbar('Ranked')}
    <main class="view-stack ranked-view">
      <section class="card section ranked-hero-card">
        <div class="ranked-hero-head">
          <div class="ranked-hero-badge">${renderRankTierBadge({ rankTierKey: tier.key, rankTier: tier.label, rankedElo })}</div>
          <div>
            <h2>${tier.label} Tier</h2>
            <div class="muted">Elo ${rankedElo} • Ranked W-L ${rankedWins}-${rankedLosses}</div>
            <div class="muted">Fixed rank bet: ${fixedBet.toLocaleString()} chips</div>
          </div>
        </div>
        <div class="ranked-hero-actions">
          <button id="rankedSeriesActionBtn" class="gold" ${actionDisabled || searching ? 'disabled' : ''}>${searching ? 'Queueing...' : actionLabel}</button>
          ${searching ? '<button id="rankedSeriesCancelBtn" class="ghost">Cancel Search</button>' : ''}
          <button id="viewRankRankedBtn" class="ghost" type="button">View Rank</button>
          <button id="forfeitRankedSeriesBtn" class="warn" type="button" ${forfeitDisabled ? 'disabled' : ''}>Forfeit Series</button>
        </div>
        ${actionDisabled && !searching ? `<p class="muted ranked-disabled-note">${queueDisabledReason}</p>` : ''}
        ${currentRankedMatch ? '<p class="muted">Ranked series can only be exited by explicit forfeit.</p>' : ''}
      </section>

      <section class="card section ranked-series-card">
        <div class="ranked-series-head">
          <h3>Series Tracker</h3>
          <span class="muted">Best chip total after 9 games</span>
        </div>
        ${
          activeSeries
            ? `<div class="muted">Games: ${activeSeries.completedMainGames}/${activeSeries.targetGames} • Chips: ${activeSeries.yourChipDelta >= 0 ? '+' : ''}${Number(activeSeries.yourChipDelta).toLocaleString()}</div>`
            : '<div class="muted">No active ranked series. Start one to begin tracking.</div>'
        }
        <div class="ranked-series-grid">
          ${mainMarkers.map((entry, idx) => `<div class="ranked-game-marker ${entry.result ? `is-${entry.result.toLowerCase()}` : 'is-empty'}"><span>G${idx + 1}</span><strong>${entry.result || '•'}</strong>${entry.runningChipDelta === null ? '' : `<small>${entry.runningChipDelta >= 0 ? '+' : ''}${entry.runningChipDelta}</small>`}</div>`).join('')}
        </div>
        ${
          activeSeries?.inTiebreaker
            ? `<div class="ranked-tiebreaker-banner">Tiebreaker Round #${activeSeries.nextTiebreakerRound}</div>`
            : ''
        }
        ${
          tiebreakerMarkers.length
            ? `<div class="ranked-tiebreaker-list">${tiebreakerMarkers.map((entry) => `<span class="ranked-tiebreaker-pill ${entry.result ? `is-${String(entry.result).toLowerCase()}` : ''}">TB${entry.tiebreakerRound}: ${entry.result || 'P'}</span>`).join('')}</div>`
            : ''
        }
      </section>

      <section class="card section ranked-rules-card">
        <h3>Ranked Rules</h3>
        <ul class="patch-list">
          <li class="muted">Ranked is locked to your tier&apos;s fixed bet amount.</li>
          <li class="muted">Each series always plays 9 games. Leader after early games does not end the series.</li>
          <li class="muted">Series winner is decided by net chips after game 9 (not game win count).</li>
          <li class="muted">If chips tie after 9, tiebreakers continue until a non-zero chip swing decides the winner.</li>
          <li class="muted">You cannot leave mid-series unless you explicitly forfeit.</li>
          <li class="muted">Elo is finalized once per completed series (or forfeit), not per game.</li>
        </ul>
      </section>
    </main>
    ${
      state.rankedForfeitModalOpen
        ? `<div class="modal" id="rankedForfeitModal">
            <div class="modal-panel card ranked-forfeit-modal" role="dialog" aria-modal="true" aria-label="Forfeit ranked series">
              <h3>Forfeit Ranked Series?</h3>
              <p class="muted">This counts as an automatic loss and ends the current series immediately.</p>
              <div class="row">
                <button id="confirmRankedForfeitBtn" class="warn" type="button">Forfeit Series</button>
                <button id="cancelRankedForfeitBtn" class="ghost" type="button">Cancel</button>
              </div>
            </div>
          </div>`
        : ''
    }
    ${renderRankTimelineModal({ rankedElo })}
  `;

  bindShellNav();
  const rankedSeriesActionBtn = document.getElementById('rankedSeriesActionBtn');
  if (rankedSeriesActionBtn) {
    rankedSeriesActionBtn.onclick = () => {
      if (currentRankedMatch) {
        goToView('match');
        render();
        return;
      }
      if (activeSeriesLive) {
        joinRankedQueue({ continueSeries: true });
        return;
      }
      joinRankedQueue({ continueSeries: false });
    };
  }
  const rankedSeriesCancelBtn = document.getElementById('rankedSeriesCancelBtn');
  if (rankedSeriesCancelBtn) {
    rankedSeriesCancelBtn.onclick = () => cancelRankedQueue();
  }
  const viewRankRankedBtn = document.getElementById('viewRankRankedBtn');
  if (viewRankRankedBtn) {
    viewRankRankedBtn.onclick = () => {
      state.rankTimelineModalOpen = true;
      render();
    };
  }
  const forfeitRankedSeriesBtn = document.getElementById('forfeitRankedSeriesBtn');
  if (forfeitRankedSeriesBtn) {
    forfeitRankedSeriesBtn.onclick = () => {
      if (!currentRankedMatch) return;
      state.rankedForfeitModalOpen = true;
      render();
    };
  }
  const rankedForfeitModal = document.getElementById('rankedForfeitModal');
  if (rankedForfeitModal) {
    rankedForfeitModal.onclick = () => {
      state.rankedForfeitModalOpen = false;
      render();
    };
  }
  const rankedForfeitPanel = app.querySelector('.ranked-forfeit-modal');
  if (rankedForfeitPanel) {
    rankedForfeitPanel.onclick = (event) => event.stopPropagation();
  }
  const cancelRankedForfeitBtn = document.getElementById('cancelRankedForfeitBtn');
  if (cancelRankedForfeitBtn) {
    cancelRankedForfeitBtn.onclick = () => {
      state.rankedForfeitModalOpen = false;
      render();
    };
  }
  const confirmRankedForfeitBtn = document.getElementById('confirmRankedForfeitBtn');
  if (confirmRankedForfeitBtn) {
    confirmRankedForfeitBtn.onclick = () => {
      state.rankedForfeitModalOpen = false;
      state.pendingNavAfterLeave = 'ranked';
      leaveCurrentMatch({ showToast: true, refreshOnError: true });
    };
  }
  const rankTimelineModal = document.getElementById('rankTimelineModal');
  if (rankTimelineModal) {
    rankTimelineModal.onclick = () => {
      state.rankTimelineModalOpen = false;
      render();
    };
  }
  const closeRankTimelineBtn = document.getElementById('closeRankTimelineBtn');
  if (closeRankTimelineBtn) {
    closeRankTimelineBtn.onclick = () => {
      state.rankTimelineModalOpen = false;
      render();
    };
  }
  const rankTimelinePanel = app.querySelector('.rank-timeline-modal');
  if (rankTimelinePanel) {
    rankTimelinePanel.onclick = (event) => event.stopPropagation();
  }
}

function renderChallenges() {
  const groups = state.challenges || { hourly: [], daily: [], weekly: [], skill: [] };
  const claimPending = state.challengeClaimPendingById || {};
  const resetTiers = new Set(['hourly', 'daily', 'weekly', 'skill']);
  const skillPoolSize = Math.max(
    0,
    Math.floor(Number(state.challengeMeta?.skillPoolSize) || Number(groups.skill?.length) || 0)
  );
  const challengeStatusLabel = (challenge) => {
    const goal = Math.max(1, Math.floor(Number(challenge?.goal) || 1));
    const progress = Math.max(0, Math.floor(Number(challenge?.progress) || 0));
    const claimed = Boolean(challenge?.claimed || challenge?.claimedAt);
    if (claimed) return 'Claimed';
    if (progress >= goal) return 'Completed';
    return 'In Progress';
  };
  const challengeIcon = (challenge) => {
    const raw = String(challenge?.icon || '').trim().toUpperCase();
    if (raw) return raw.slice(0, 4);
    return String(challenge?.title || 'SKL').trim().slice(0, 3).toUpperCase();
  };
  const renderTier = (label, key, options = {}) => `
    <section class="card section challenge-tier">
      <div class="challenge-tier-head">
        <h3>${label}</h3>
        <div class="challenge-tier-meta">
          ${
            options.dailyRotation
              ? `<span class="challenge-tier-rotation">Daily rotation${skillPoolSize >= 25 ? ' • Pool 25+' : skillPoolSize > 0 ? ` • Pool ${skillPoolSize}` : ''}</span>`
              : ''
          }
          ${
            resetTiers.has(key)
              ? `<span class="muted challenge-reset-note" data-challenge-reset-tier="${key}">${challengeResetText(key)}</span>`
              : ''
          }
        </div>
      </div>
      ${
        (groups[key] || [])
          .map((c) => {
            const goal = Math.max(1, Math.floor(Number(c?.goal) || 1));
            const progress = Math.max(0, Math.floor(Number(c?.progress) || 0));
            const percent = Math.max(0, Math.min(100, Math.round((progress / goal) * 100)));
            const claimed = Boolean(c?.claimed || c?.claimedAt);
            const ready = progress >= goal && !claimed;
            const statusClass = claimed ? 'is-claimed' : ready ? 'is-complete' : 'is-progress';
            return `
              <article class="challenge challenge-card ${ready ? 'challenge-ready' : ''}">
                <div class="challenge-card-main">
                  <div class="challenge-card-top">
                    <span class="challenge-icon">${challengeIcon(c)}</span>
                    <div class="challenge-copy">
                      <div><strong>${c.title}</strong></div>
                      <div class="muted">${c.description}</div>
                    </div>
                    <span class="challenge-status ${statusClass}">${challengeStatusLabel(c)}</span>
                  </div>
                  <div class="challenge-progress-track" role="presentation">
                    <span style="width:${percent}%"></span>
                  </div>
                  <div class="muted challenge-progress-meta">${progress}/${goal} • Reward ${Math.max(0, Math.floor(Number(c.rewardChips) || 0)).toLocaleString()} chips</div>
                </div>
                <button
                  class="${ready && !claimPending[c.id] ? 'claim-wiggle' : ''}"
                  data-claim="${c.id}"
                  ${claimed || progress < goal || claimPending[c.id] ? 'disabled' : ''}
                >${
                  claimPending[c.id]
                    ? '<span class="btn-spinner" aria-hidden="true"></span>Claiming...'
                    : (claimed ? 'Claimed' : 'Claim')
                }</button>
              </article>
            `;
          })
          .join('') || '<p class="muted">No active challenges.</p>'
      }
    </section>
  `;
  app.innerHTML = `
    ${renderTopbar('Challenges')}
    <main class="view-stack">
      <p class="muted">Only real-chip matches count toward challenge progress.</p>
      ${renderTier('Hourly Challenges', 'hourly')}
      ${renderTier('Daily Skill Challenges', 'skill', { dailyRotation: true })}
      ${renderTier('Daily Challenges', 'daily')}
      ${renderTier('Weekly Challenges', 'weekly')}
    </main>
  `;
  bindShellNav();
  syncChallengeCountdownUI();

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
              <div class="muted notif-time">${formatNotificationTime(n.createdAt)}</div>
              ${renderNotificationActions(n)}
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
  app.querySelectorAll('[data-notif-fr-accept]').forEach((btn) => {
    btn.onclick = () => acceptRequestFromNotification(btn.dataset.notifFrAccept);
  });
  app.querySelectorAll('[data-notif-fr-decline]').forEach((btn) => {
    btn.onclick = () => declineRequestFromNotification(btn.dataset.notifFrDecline);
  });
}

function renderRules() {
  const splitTensEvent = splitTensEventState();
  app.innerHTML = `
    ${renderTopbar('Rules')}
    <main class="view-stack">
      <section class="card section rules-overview-card">
        <h2>Rules & Fairness</h2>
        <p class="muted">Complete gameplay, ranked, and reward rules in one place.</p>
        <div class="muted">Version: ${state.appVersion || 'dev'}</div>
      </section>

      <section class="card section rules-section-card">
        <h3>Active Events</h3>
        ${
          splitTensEvent.active
            ? `<div class="active-events-row">
                <div>
                  <strong>Split Tens Event: ON</strong>
                  <div class="muted">Rule change: 10/10 can be split.</div>
                </div>
                <div class="active-events-actions">
                  <span class="active-events-countdown" id="splitTensCountdownRules">Ends in ${formatCooldown(splitTensEvent.remainingMs)}</span>
                  <button class="ghost" id="openSplitTensDetailsRulesBtn" type="button">View Details</button>
                </div>
              </div>`
            : '<div class="muted">No active limited-time events.</div>'
        }
      </section>

      <section class="card section rules-section-card">
        <h3>Core Blackjack Table Rules</h3>
        <div class="rules-grid">
          <article>
            <h4>Payouts & Deck</h4>
            <ul class="rules-list">
              <li>Natural blackjack pays 3:2.</li>
              <li>Single 52-card deck is reshuffled every round.</li>
              <li>Both players start with two cards and one opponent upcard is visible.</li>
            </ul>
          </article>
          <article>
            <h4>Hand Resolution</h4>
            <ul class="rules-list">
              <li>Higher non-bust total wins.</li>
              <li>Equal totals result in a push.</li>
              <li>A busted hand loses immediately.</li>
            </ul>
          </article>
          <article>
            <h4>Player Actions</h4>
            <ul class="rules-list">
              <li>Hit, stand, double, split, and surrender are available when legal.</li>
              <li>Surrender forfeits 75% of that hand bet.</li>
              <li>Split and double outcomes are tracked as separate hand results.</li>
              <li>Splitting 10/10 is enabled only during active limited-time events.</li>
            </ul>
          </article>
          <article>
            <h4>Pressure System</h4>
            <ul class="rules-list">
              <li>Opponent split/double pressure can require match-or-surrender decisions.</li>
              <li>Pressure choices can increase chip swings within the same round.</li>
              <li>Pressure events are recorded in hand and match history.</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="card section rules-section-card">
        <h3>Mode, Ranked, and Economy Rules</h3>
        <div class="rules-grid">
          <article>
            <h4>Quick Play & Lobbies</h4>
            <ul class="rules-list">
              <li>Quick Play matches by bet buckets for fast queueing.</li>
              <li>Lobbies support private code joins and manual bets inside limits.</li>
              <li>Leaving an active PvP match is treated as forfeit.</li>
            </ul>
          </article>
          <article>
            <h4>Ranked Series</h4>
            <ul class="rules-list">
              <li>Ranked bet amount is fixed by your rank tier.</li>
              <li>A ranked series is always 9 games; winner is highest net chips after game 9.</li>
              <li>If tied, unlimited tiebreakers continue until chip delta is non-zero.</li>
              <li>Mid-series exit is forfeit-only and counts as an automatic loss.</li>
            </ul>
          </article>
          <article>
            <h4>Elo & Rank Updates</h4>
            <ul class="rules-list">
              <li>Elo finalizes once per completed ranked series (including forfeit outcomes).</li>
              <li>Series wins and losses are clamped to keep swings stable and readable.</li>
              <li>Bronze and Silver losses are softened compared with higher ranks.</li>
            </ul>
          </article>
          <article>
            <h4>Rewards & Tracking</h4>
            <ul class="rules-list">
              <li>Daily streak claims grant cooldown-based chip rewards.</li>
              <li>Level rewards trigger every 5 levels with scaling amounts.</li>
              <li>Stats, history, and ranked series records are stored server-side.</li>
            </ul>
          </article>
        </div>
      </section>
    </main>
    ${
      state.eventDetailsModalId === SPLIT_TENS_EVENT_ID && splitTensEvent.active
        ? `<div class="modal" id="splitTensEventModal">
            <div class="modal-panel card split-tens-event-modal" role="dialog" aria-modal="true" aria-label="Split tens event details">
              <div class="split-tens-event-modal-head">
                <h3>Split Tens Event</h3>
                <button id="closeSplitTensDetailsBtn" class="ghost" type="button">Close</button>
              </div>
              <p class="muted">For the next 24 hours, splitting 10s is allowed.</p>
              <ul class="rules-list split-tens-event-list">
                <li><strong>Rule change:</strong> 10/10 can be split.</li>
                <li><strong>Ends at:</strong> ${formatEventEndsAtLocal(splitTensEvent.event?.endsAt)}</li>
                <li><strong id="splitTensCountdownModal">Ends in ${formatCooldown(splitTensEvent.remainingMs)}</strong></li>
              </ul>
            </div>
          </div>`
        : ''
    }
  `;
  bindShellNav();
  const openSplitTensDetailsRulesBtn = document.getElementById('openSplitTensDetailsRulesBtn');
  if (openSplitTensDetailsRulesBtn) {
    openSplitTensDetailsRulesBtn.onclick = () => {
      state.eventDetailsModalId = SPLIT_TENS_EVENT_ID;
      render();
    };
  }
  const splitTensEventModal = document.getElementById('splitTensEventModal');
  if (splitTensEventModal) {
    splitTensEventModal.onclick = () => {
      state.eventDetailsModalId = null;
      render();
    };
  }
  const closeSplitTensDetailsBtn = document.getElementById('closeSplitTensDetailsBtn');
  if (closeSplitTensDetailsBtn) {
    closeSplitTensDetailsBtn.onclick = () => {
      state.eventDetailsModalId = null;
      render();
    };
  }
  const splitTensEventModalPanel = app.querySelector('.split-tens-event-modal');
  if (splitTensEventModalPanel) {
    splitTensEventModalPanel.onclick = (event) => event.stopPropagation();
  }
  syncEventCountdownUI();
}

function renderHand(hand, index, active, pressureTagged = false) {
  const labels = [];
  if (hand.bust) labels.push('Bust');
  if (hand.surrendered) labels.push('Surrendered');
  if (hand.stood) labels.push('Stood');
  if (hand.locked && !hand.bust && !hand.surrendered && !hand.stood) labels.push('Locked');
  if (hand.outcome) labels.push(hand.outcome.toUpperCase());
  const isActive = active && !hand.locked;
  const metaParts = [formatHandTotalLine(hand)];
  if (isActive) metaParts.push('Active');
  if (hand.isSoft) metaParts.push('Soft');
  if (!hand.locked && !hand.bust && !hand.surrendered && !hand.stood) metaParts.push('In play');
  const metaLine = metaParts.join(' • ');
  const statusLine = labels.join(' • ');
  const handCards = Array.isArray(hand?.cards) ? hand.cards : [];
  const renderedCards = handCards.length ? handCards : [{ hidden: true }, { hidden: true }];

  return `
    <div class="hand ${active ? 'active' : ''}">
      <div class="hand-head">
        <div class="hand-head-left">
          <strong>Hand ${index + 1} ${pressureTagged ? '<span class="pressure-dot" title="Pressure decision applies">*</span>' : ''}</strong>
          <span class="muted hand-meta">${metaLine}</span>
        </div>
        <span class="hand-chip">Bet: ${hand.bet}</span>
      </div>
      <div class="muted hand-status">${statusLine}</div>
      <div class="card-viewport">
        <div class="cards cardsRow card-count-${Math.min(renderedCards.length, 7)}">
          ${renderedCards.map((card, cardIndex) => renderPlayingCard(card, cardIndex)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderHandPlaceholder(label = 'Waiting for cards') {
  return `
    <div class="hand hand-placeholder">
      <div class="hand-head">
        <div class="hand-head-left">
          <strong>${label}</strong>
          <span class="muted hand-meta">Cards not dealt yet</span>
        </div>
      </div>
      <div class="card-viewport">
        <div class="cards cardsRow card-count-2">
          ${renderPlayingCard({ hidden: true }, 0)}
          ${renderPlayingCard({ hidden: true }, 1)}
        </div>
      </div>
    </div>
  `;
}

function renderEmoteBubble(playerId) {
  if (!state.floatingEmote || state.floatingEmote.fromUserId !== playerId) return '';
  const bubbleClass = state.floatingEmote.type === 'emoji' ? 'emoji' : 'quip';
  return `<div class="emote-overlay-bubble ${bubbleClass}">${state.floatingEmote.value}</div>`;
}

function suitLabel(suit) {
  if (suit === 'S') return 'Spades';
  if (suit === 'H') return 'Hearts';
  if (suit === 'D') return 'Diamonds';
  if (suit === 'C') return 'Clubs';
  return 'Suit';
}

function renderSuitIcon(suit, className = '') {
  return renderSuitIconSvg(suit, className);
}

function renderPlayingCard(card, cardIndex = 0) {
  const deckSkinToken = deckSkinForUser(state.me)?.token || 'classic';
  const anim = cardAnimationMeta(card);
  const animationClasses = [];
  if (anim.isEntering) animationClasses.push('card-enter');
  if (anim.isRevealing) animationClasses.push('card-reveal');
  if (anim.isShifting) animationClasses.push('card-shift');
  const styleTokens = [`--card-enter-delay:${cardIndex * 35}ms`];
  if (anim.cardId) styleTokens.push(`--card-enter-rot:${anim.tiltDeg.toFixed(2)}deg`);
  const styleAttr = `style="${styleTokens.join(';')}"`;
  const idAttr = anim.cardId ? `data-card-id="${anim.cardId}"` : '';

  if (card.hidden) {
    return `
      <div class="playing-card hidden deck-skin-${deckSkinToken} ${animationClasses.join(' ')}" ${styleAttr} ${idAttr} aria-label="Face-down card">
        <div class="card-back-inner">
          <span class="card-back-mark">BB</span>
        </div>
      </div>
    `;
  }

  const isRed = card.suit === 'H' || card.suit === 'D';
  const colorClass = isRed ? 'red' : 'black';
  return `
    <article class="playing-card face ${colorClass} deck-skin-${deckSkinToken} ${animationClasses.join(' ')}" ${styleAttr} ${idAttr} aria-label="${card.rank} of ${suitLabel(card.suit)}">
      <div class="card-face-sheen"></div>
      <div class="corner top">
        <span class="rank">${card.rank}</span>
        ${renderSuitIcon(card.suit, 'corner-suit')}
      </div>
      <div class="center-suit">${renderSuitIcon(card.suit, 'center-suit-icon')}</div>
      <div class="corner bottom">
        <span class="rank">${card.rank}</span>
        ${renderSuitIcon(card.suit, 'corner-suit')}
      </div>
    </article>
  `;
}

function renderMatch() {
  const match = state.currentMatch;
  const me = state.me;
  if (!match) {
    goToView('home');
    return render();
  }
  pruneCardAnimState();

  const myState = match.players[me.id];
  const oppId = getOpponentId();
  const oppState = match.players[oppId];
  const myHands = Array.isArray(myState?.hands) ? myState.hands : [];
  const oppHands = Array.isArray(oppState?.hands) ? oppState.hands : [];
  const myActiveHandIndex = Number.isInteger(myState?.activeHandIndex) ? myState.activeHandIndex : 0;
  const oppActiveHandIndex = Number.isInteger(oppState?.activeHandIndex) ? oppState.activeHandIndex : 0;
  const activeHand = myHands[myActiveHandIndex] || null;
  const myTurn = isMyTurn();
  const pressure = match.pendingPressure;
  const waitingPressure = pressure && pressure.opponentId === me.id;
  const isBettingPhase = match.phase === 'ROUND_INIT';
  const opponentConnected = match.disconnects[oppId]?.connected;
  const isBotOpponent = Boolean(match.participants?.[oppId]?.isBot);
  const isPvpMatch = !isBotOpponent;
  const quickPlayBucketBet = normalizeQuickPlayBucketValue(match.quickPlayBucket);
  const supportsBetChat = Boolean(isPvpMatch && !quickPlayBucketBet && match.matchType !== 'quickplay');
  const betChatMessages = Array.isArray(match.chat) ? match.chat : [];
  const negotiation = match.betNegotiation || { enabled: false };
  const negotiationEnabled = Boolean(isBettingPhase && negotiation.enabled);
  const negotiationYourProposal = Number.isFinite(Number(negotiation.yourProposal)) ? Number(negotiation.yourProposal) : null;
  const negotiationOpponentProposal = Number.isFinite(Number(negotiation.opponentProposal)) ? Number(negotiation.opponentProposal) : null;
  const negotiationAgreedAmount = Number.isFinite(Number(negotiation.agreedAmount)) ? Number(negotiation.agreedAmount) : null;
  const negotiationTargetBet = Number.isFinite(Number(negotiation.targetBet))
    ? Number(negotiation.targetBet)
    : (negotiationAgreedAmount || Math.max(negotiationYourProposal || 0, negotiationOpponentProposal || 0) || null);
  const negotiationStatusText = negotiationEnabled
    ? negotiation.status === 'locked'
      ? `Agreed at ${Number(negotiationAgreedAmount || match.baseBet || 0).toLocaleString()}`
      : negotiationAgreedAmount
        ? `Both proposed ${Number(negotiationAgreedAmount).toLocaleString()} — click Agree to lock`
        : negotiationOpponentProposal
          ? `Opponent proposed ${Number(negotiationOpponentProposal).toLocaleString()}`
          : 'Set your proposal and wait for opponent response'
    : '';
  const myStreak = Math.max(0, Math.floor(Number(me.currentMatchWinStreak) || 0));
  const showFlame = myStreak >= 3;
  const myMeta = renderPlayerMeta(match.participants?.[me.id] || {});
  const oppMeta = renderPlayerMeta(match.participants?.[oppId] || {});
  const phaseLabelMap = {
    ROUND_INIT: 'Betting',
    DEAL: 'Dealing',
    ACTION_TURN: 'Action',
    PRESSURE_RESPONSE: 'Pressure',
    HAND_ADVANCE: 'Advance',
    ROUND_RESOLVE: 'Resolve',
    REVEAL: 'Reveal',
    RESULT: 'Result',
    NEXT_ROUND: 'Next Round'
  };
  const phaseLabel = phaseLabelMap[match.phase] || match.phase;
  const roundResolved =
    match.phase === 'ROUND_RESOLVE' ||
    match.phase === 'REVEAL' ||
    match.phase === 'RESULT' ||
    match.phase === 'NEXT_ROUND';
  const displayBankroll =
    isOfflineMatchActive()
      ? (myState.bankroll ?? 0)
      : (Number.isFinite(state.bankrollDisplay) ? state.bankrollDisplay : (myState.bankroll ?? me.chips));
  const canAct = myTurn && !waitingPressure && activeHand && !activeHand.locked;
  const canSurrender = Boolean(canAct && (activeHand?.actionCount || 0) === 0);
  const emoteCoolingDown = Date.now() < state.emoteCooldownUntil;
  const canEditBet = Boolean(match.canEditBet);
  const canConfirmBet = Boolean(match.canConfirmBet);
  const rankedMatch = String(match.matchType || '').toUpperCase() === 'RANKED';
  const practiceMode = Boolean(match.isPractice || String(match.mode || '').toLowerCase() === 'practice' || String(match.economyMode || '').toLowerCase() === 'no_delta');
  const rankedSeriesHud = rankedMatch
    ? (match.rankedSeriesHud || {
        seriesGameIndex: Number(match.seriesGameIndex) || 0,
        baseSeriesGames: Number(match.baseSeriesGames) || 9,
        isTiebreaker: Boolean(match.isTiebreaker),
        tiebreakerIndex: Number(match.tiebreakerIndex) || 0
      })
    : null;
  const seriesGameIndex = Math.max(0, Math.floor(Number(rankedSeriesHud?.seriesGameIndex) || 0));
  const baseSeriesGames = Math.max(1, Math.floor(Number(rankedSeriesHud?.baseSeriesGames) || 9));
  const isTiebreaker = Boolean(rankedSeriesHud?.isTiebreaker) || seriesGameIndex > baseSeriesGames;
  const tiebreakerIndex = Math.max(
    0,
    Math.floor(Number(rankedSeriesHud?.tiebreakerIndex) || (isTiebreaker ? (seriesGameIndex - baseSeriesGames) : 0))
  );
  const rankedSeriesHudText = rankedMatch && seriesGameIndex > 0
    ? (
      isTiebreaker
        ? `Series: ${baseSeriesGames}/${baseSeriesGames} • TB ${Math.max(1, tiebreakerIndex)}`
        : `Series: ${Math.min(seriesGameIndex, baseSeriesGames)}/${baseSeriesGames}`
    )
    : '';
  const myConfirmed = Boolean(match.betConfirmedByPlayer?.[me.id]);
  const oppConfirmed = Boolean(match.betConfirmedByPlayer?.[oppId]);
  const betBounds = getBetBounds(match);
  const minBet = betBounds.min;
  const maxBet = betBounds.max;
  const hasBetDraft = String(state.betInputDraft || '') !== '';
  const draftBet = sanitizeInt(state.betInputDraft);
  const effectiveBet = hasBetDraft ? draftBet : sanitizeInt(state.currentBet);
  const isBetValid = Number.isInteger(effectiveBet) && effectiveBet >= minBet && effectiveBet <= maxBet;
  const opponentThinking = Boolean(!canAct && !waitingPressure && isBotOpponent && match.phase === 'ACTION_TURN' && match.currentTurn === oppId);
  const splitTensEventActive = isSplitTensEventActiveClient();
  const splitLegalForHand = handCanSplit(activeHand, myHands.length, match.maxHandsPerPlayer || 4, splitTensEventActive);
  const splitTensBlocked = Boolean(canAct && isTenTenPair(activeHand) && !splitTensEventActive);
  const hitBlockedAfterDouble = Boolean(canAct && (activeHand?.doubleCount || 0) >= 1);
  const splitTensActiveHint = Boolean(canAct && isTenTenPair(activeHand) && splitTensEventActive);
  const actionHint = canAct
    ? 'Choose an action for your active hand.'
    : waitingPressure
      ? 'Respond to pressure: Match or Surrender.'
      : opponentThinking
        ? 'Opponent thinking...'
        : 'Waiting for next turn.';
  const splitButtonTitle = splitLegalForHand
    ? 'Split pair into two hands'
    : splitTensBlocked
      ? 'Splitting 10s is available during limited-time events.'
      : 'Split requires pair (max 4 hands)';
  const hitButtonTitle = canAct
    ? (hitBlockedAfterDouble ? 'Hit is unavailable after a double on this hand.' : 'Draw one card')
    : actionHint;
  const noPenaltyLeave =
    isBotOpponent &&
    (!match.stakesCommitted || match.phase === 'ROUND_INIT' || match.phase === 'RESULT' || match.phase === 'REVEAL');
  const leaveWarningText = rankedMatch
    ? 'Forfeiting ends the ranked series immediately and counts as an automatic loss.'
    : (noPenaltyLeave
      ? 'Leave to lobby. No additional chips are charged until a round starts.'
      : 'You will forfeit this round and end the match.');
  const leaveActionLabel = rankedMatch ? 'Forfeit Series' : 'Leave Match';
  const pressureMine = waitingPressure ? new Set(pressure?.affectedHandIndices || []) : new Set();
  const pressureOpp = pressure && pressure.opponentId === oppId ? new Set(pressure?.affectedHandIndices || []) : new Set();
  const turnTimerState = getTurnTimerState(match);
  const modePill = practiceMode
    ? '<span class="mode-pill mode-pill-practice">Practice</span>'
    : (isBotOpponent ? '<span class="mode-pill mode-pill-real">Bot Match</span>' : '');

  app.innerHTML = `
    ${renderTopbar('Blackjack Battle')}
    <main class="view-stack match-view">
      <div class="match match-shell card section reveal-panel ${isBettingPhase ? 'betting-flat' : ''}">
        ${
          isBettingPhase
            ? `<section class="betting-layout">
                <div class="betting-header">
                  <h3>Round ${match.roundNumber} — ${negotiationEnabled ? 'Negotiate your bet' : 'Place your bet'}${match.highRoller ? ' • High Roller' : ''} ${modePill}</h3>
                  <div class="bankroll-pill"><span class="muted">Bankroll</span> <strong>${(myState.bankroll ?? me.chips).toLocaleString()}</strong></div>
                </div>
                <div class="match-zone betting-zone ${supportsBetChat ? 'with-chat' : ''}">
                  <div class="bet-control ${negotiationEnabled ? 'is-negotiation' : ''}">
                    <div class="bet-head">
                      <strong>${negotiationEnabled ? 'Bet Negotiation' : 'Base Bet'}</strong>
                      <span class="muted bet-head-helper">
                        ${quickPlayBucketBet ? `Quick Play fixed: $${quickPlayBucketBet.toLocaleString()}` : `Min ${minBet.toLocaleString()} / Max ${maxBet.toLocaleString()}`}
                      </span>
                    </div>
                    ${
                      negotiationEnabled
                        ? `<div class="negotiation-status-grid">
                            <div class="negotiation-cell">
                              <span class="muted">Your proposal</span>
                              <strong>${negotiationYourProposal ? negotiationYourProposal.toLocaleString() : '—'}</strong>
                            </div>
                            <div class="negotiation-cell">
                              <span class="muted">Opponent proposal</span>
                              <strong>${negotiationOpponentProposal ? negotiationOpponentProposal.toLocaleString() : '—'}</strong>
                            </div>
                            <div class="negotiation-cell is-target">
                              <span class="muted">Current target</span>
                              <strong>${negotiationTargetBet ? negotiationTargetBet.toLocaleString() : 'Pending'}</strong>
                            </div>
                          </div>`
                        : ''
                    }
                    <div class="bet-row">
                      <button id="betMinus" class="ghost" ${!canEditBet ? 'disabled' : ''}>-</button>
                      <div class="bet-pill">${state.currentBet}</div>
                      <button id="betPlus" class="ghost" ${!canEditBet ? 'disabled' : ''}>+</button>
                      <button data-bet-quick="5" class="gold" ${!canEditBet ? 'disabled' : ''}>+5</button>
                      <button data-bet-quick="10" class="gold" ${!canEditBet ? 'disabled' : ''}>+10</button>
                      <button data-bet-quick="25" class="gold" ${!canEditBet ? 'disabled' : ''}>+25</button>
                      <div class="bet-input-wrap">
                        <label for="betInput" class="bet-input-label muted">${negotiationEnabled ? 'Propose' : 'Custom'}</label>
                        <input
                          id="betInput"
                          class="bet-input"
                          type="number"
                          inputmode="numeric"
                          step="1"
                          min="${minBet}"
                          max="${maxBet}"
                          value="${hasBetDraft ? state.betInputDraft : state.currentBet}"
                          ${!canEditBet ? 'disabled' : ''}
                        />
                      </div>
                    </div>
                    ${
                      negotiationEnabled
                        ? `<div class="negotiation-status-line">
                             <span class="muted">Status</span>
                             <strong>${negotiationStatusText}</strong>
                           </div>`
                        : ''
                    }
                    <div class="bet-confirm-row">
                      <div class="bet-confirm-actions ${negotiationEnabled ? 'negotiation-actions negotiation-actions-primary' : ''}">
                        ${
                          negotiationEnabled
                            ? `<button id="agreeBetBtn" class="primary" ${!canConfirmBet ? 'disabled' : ''}>Agree</button>
                               <button id="raiseBetBtn" class="gold" ${!isBetValid ? 'disabled' : ''}>Propose Raise</button>
                               <button id="lowerBetBtn" class="ghost" ${!isBetValid ? 'disabled' : ''}>Propose Lower</button>`
                            : `<button id="confirmBetBtn" class="primary" ${!canConfirmBet || !isBetValid ? 'disabled' : ''}>Confirm Bet</button>
                               <button id="leaveMatchBtn" class="ghost leave-btn" type="button">${leaveActionLabel}</button>`
                        }
                      </div>
                      ${
                        negotiationEnabled
                          ? `<div class="bet-confirm-actions negotiation-actions negotiation-actions-secondary">
                               <button id="resetNegotiationBtn" class="ghost" type="button">Reset negotiation</button>
                               <button id="leaveMatchBtn" class="ghost leave-btn" type="button">${leaveActionLabel}</button>
                             </div>`
                          : ''
                      }
                      <div class="muted">
                        ${
                          negotiationEnabled
                            ? `${myConfirmed ? 'You agreed to current proposal.' : 'Waiting on your response.'} ${oppConfirmed ? 'Opponent agreed.' : 'Waiting on opponent response.'}`
                            : `${myConfirmed ? 'You confirmed.' : 'Waiting for your confirmation.'} ${oppConfirmed ? 'Opponent confirmed.' : 'Waiting for opponent...'}`
                        }
                        ${!isBetValid ? '<span class="bet-invalid-note"> Enter a whole number in range.</span>' : ''}
                        <button id="resetBetStateBtn" class="bet-reset-link" type="button">Reset</button>
                      </div>
                    </div>
                  </div>
                  ${
                    supportsBetChat
                      ? `<div class="bet-chat card">
                           <div class="bet-chat-head">
                             <strong>Bet Chat</strong>
                             <span class="muted">Lobby only</span>
                           </div>
                           <div class="bet-chat-log" id="betChatLog">
                             ${
                               betChatMessages.length
                                 ? betChatMessages
                                     .map(
                                       (entry) => `<div class="bet-chat-line ${entry.userId === me.id ? 'mine' : ''}">
                                         <span class="bet-chat-author">${entry.userId === me.id ? 'You' : entry.username || 'Opponent'}:</span>
                                         <span>${entry.text}</span>
                                       </div>`
                                     )
                                     .join('')
                                 : '<div class="muted">Say hi before locking in your bet.</div>'
                             }
                           </div>
                           <div class="bet-chat-compose">
                             <input id="betChatInput" maxlength="140" placeholder="Message opponent..." />
                             <button id="betChatSendBtn" class="ghost" type="button">Send</button>
                           </div>
                         </div>`
                      : ''
                  }
                </div>
              </section>`
            : `<section class="match-main play-layout">
                <div class="status-strip">
                  <div class="strip-item"><span class="muted">Round</span> <strong>${match.roundNumber}</strong></div>
                  <div class="strip-item"><span class="muted">Turn</span> <strong class="${myTurn ? 'your-turn' : ''}">${myTurn ? 'You' : playerName(match.currentTurn)}</strong></div>
                  <div class="strip-item"><span class="muted">Phase</span> <strong class="phase-strong">${phaseLabel}${modePill}${rankedSeriesHudText ? ` <span class="series-pill">${rankedSeriesHudText}</span>` : ''}</strong></div>
                  <div class="strip-item"><span class="muted">Streak</span> <strong>${myStreak}${showFlame ? ' <span class="streak-flame" aria-hidden="true"><span class="streak-flame-core"></span><span class="streak-flame-glow"></span><span class="streak-flame-trail"></span><span class="streak-flame-spark"></span></span>' : ''}</strong></div>
                  <div class="strip-item bankroll-pill"><span class="muted">Bankroll</span> <strong>${Math.round(displayBankroll).toLocaleString()}</strong></div>
                </div>
                <div class="match-zone opponent-zone ${match.currentTurn === oppId ? 'turn-active-zone' : ''}">
                  ${renderEmoteBubble(oppId)}
                  <div class="zone-head">
                    <div class="zone-player">
                      <span class="player-tag">Opponent</span>
                      <h4>${playerName(oppId)}</h4>
                      <span class="zone-player-meta">${oppMeta}</span>
                      <span class="muted player-sub">${isBotOpponent ? (practiceMode ? 'Bot practice' : 'Bot match') : opponentConnected ? 'Connected' : 'Disconnected'}</span>
                    </div>
                  </div>
                  <div class="hands">
                    ${oppHands.length
                      ? oppHands.map((h, idx) => renderHand(h, idx, idx === oppActiveHandIndex, pressureOpp.has(idx))).join('')
                      : renderHandPlaceholder('Opponent Hand')}
                  </div>
                </div>
                <div class="match-zone you-zone ${myTurn ? 'turn-active-zone' : ''}">
                  ${renderEmoteBubble(me.id)}
                  <div class="zone-head">
                    <div class="zone-player">
                      <span class="player-tag">You</span>
                      <h4>${playerName(me.id)}</h4>
                      <span class="zone-player-meta">${myMeta}</span>
                    </div>
                    <div class="zone-head-meta">
                      <span class="turn ${myTurn ? 'turn-on' : ''}">${myTurn ? 'Your turn' : 'Stand by'}</span>
                    </div>
                  </div>
                  <div class="hands">
                    ${myHands.length
                      ? myHands.map((h, idx) => renderHand(h, idx, idx === myActiveHandIndex, pressureMine.has(idx))).join('')
                      : renderHandPlaceholder('Your Hand')}
                  </div>
                </div>

                <div class="actions-panel" ${roundResolved ? 'style="display:none"' : ''}>
                  <div class="actions-row">
                    <div class="actions actions-main">
                      <button data-action="hit" title="${hitButtonTitle}" class="primary" ${!canAct || hitBlockedAfterDouble ? 'disabled' : ''}>Hit</button>
                      <button data-action="stand" title="${canAct ? 'Lock this hand' : actionHint}" class="ghost" ${!canAct ? 'disabled' : ''}>Stand</button>
                      <button data-action="double" title="${canAct ? 'Double your bet and draw one card (re-double allowed while eligible)' : actionHint}" ${!canAct || (activeHand?.doubleCount || 0) >= (match.maxDoublesPerHand || 1) ? 'disabled' : ''}>Double</button>
                      <button data-action="split" title="${splitButtonTitle}" ${!canAct || !splitLegalForHand ? 'disabled' : ''}>Split</button>
                      <button class="warn" data-action="surrender" title="${canSurrender ? 'Lose 75% and lock hand' : 'Surrender only available before you act.'}" ${!canSurrender ? 'disabled' : ''}>Surrender</button>
                    </div>
                    <div class="actions-timer-slot">
                      ${renderTurnTimer(me.id, turnTimerState, 'action')}
                    </div>
                  </div>
                  <div class="muted action-hint">${actionHint}</div>
                  ${splitTensActiveHint ? '<div class="muted split-tens-hint split-tens-hint--active">Event rule active: 10/10 split enabled.</div>' : ''}
                  ${splitTensBlocked ? '<div class="muted split-tens-hint">Splitting 10s is available during limited-time events.</div>' : ''}
                  ${
                    isPvpMatch
                      ? `<div class="emote-dock ${state.emotePickerOpen ? 'is-open' : ''}">
                           <button id="toggleEmoteBtn" class="ghost emote-toggle-btn" type="button" ${emoteCoolingDown ? 'disabled' : ''}>🙂 Emote</button>
                           ${
                             state.emotePickerOpen
                               ? `<div class="emote-popover card">
                                    <div class="emote-grid">
                                      <button data-emote-type="emoji" data-emote-value="🔥" ${emoteCoolingDown ? 'disabled' : ''}>🔥</button>
                                      <button data-emote-type="emoji" data-emote-value="😎" ${emoteCoolingDown ? 'disabled' : ''}>😎</button>
                                      <button data-emote-type="emoji" data-emote-value="👏" ${emoteCoolingDown ? 'disabled' : ''}>👏</button>
                                      <button data-emote-type="emoji" data-emote-value="😅" ${emoteCoolingDown ? 'disabled' : ''}>😅</button>
                                      <button data-emote-type="emoji" data-emote-value="🤝" ${emoteCoolingDown ? 'disabled' : ''}>🤝</button>
                                      <button data-emote-type="emoji" data-emote-value="😵‍💫" ${emoteCoolingDown ? 'disabled' : ''}>😵‍💫</button>
                                    </div>
                                    <div class="emote-quips">
                                      <button data-emote-type="quip" data-emote-value="Nice hand" ${emoteCoolingDown ? 'disabled' : ''}>Nice hand</button>
                                      <button data-emote-type="quip" data-emote-value="No way" ${emoteCoolingDown ? 'disabled' : ''}>No way</button>
                                      <button data-emote-type="quip" data-emote-value="Run it" ${emoteCoolingDown ? 'disabled' : ''}>Run it</button>
                                      <button data-emote-type="quip" data-emote-value="Clutch" ${emoteCoolingDown ? 'disabled' : ''}>Clutch</button>
                                      <button data-emote-type="quip" data-emote-value="Focus mode" ${emoteCoolingDown ? 'disabled' : ''}>Focus mode</button>
                                      <button data-emote-type="quip" data-emote-value="GG" ${emoteCoolingDown ? 'disabled' : ''}>GG</button>
                                    </div>
                                  </div>`
                               : ''
                           }
                         </div>
                         <div class="actions actions-extra">
                           <button id="leaveMatchBtn" class="ghost leave-btn" type="button">${rankedMatch ? 'Forfeit Series' : 'Leave'}</button>
                         </div>`
                      : ''
                  }
                ${
                  state.leaveMatchModal
                      ? `<div class="leave-inline">
                        <strong>${rankedMatch ? 'Forfeit Ranked Series?' : 'Leave Match?'}</strong>
                        <p class="muted">${leaveWarningText}</p>
                        <div class="pressure-actions">
                          <button id="confirmLeaveMatchBtn" class="warn">${rankedMatch ? 'Forfeit Series' : 'Leave Match'}</button>
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
                  ${practiceMode ? '<div class="muted">Practice mode active: No chips won/lost.</div>' : ''}
                  <div class="muted">AFK protection enabled: inactive turns auto-stand after ${Math.round((match.turnTimeoutMs || 30000) / 1000)}s.</div>
                  <div class="muted">${actionHint}</div>
                </details>
              </section>`
        }
        ${
          isBettingPhase && state.leaveMatchModal
            ? `<div class="leave-inline">
                 <strong>${rankedMatch ? 'Forfeit Ranked Series?' : 'Leave Match?'}</strong>
                 <p class="muted">${leaveWarningText}</p>
                 <div class="pressure-actions">
                   <button id="confirmLeaveMatchBtn" class="warn">${rankedMatch ? 'Forfeit Series' : 'Leave Match'}</button>
                   <button id="cancelLeaveMatchBtn" class="ghost">Cancel</button>
                 </div>
               </div>`
            : ''
        }
        ${
          state.confirmActionModal
            ? `<div class="modal">
                 <div class="card section modal-panel">
                   <h3>${state.confirmActionModal.title}</h3>
                   <p class="muted">${state.confirmActionModal.body}</p>
                   <div class="row">
                     <button id="confirmActionYes" class="primary">Confirm</button>
                     <button id="confirmActionNo" class="ghost">Cancel</button>
                   </div>
                 </div>
               </div>`
            : ''
        }
      </div>
    </main>
  `;
  bindShellNav();

  app.querySelectorAll('[data-action]').forEach((btn) => {
    btn.onclick = () => triggerAction(btn.dataset.action);
  });
  const betMinus = document.getElementById('betMinus');
  if (betMinus) betMinus.onclick = () => adjustBet(-5);
  const betPlus = document.getElementById('betPlus');
  if (betPlus) betPlus.onclick = () => adjustBet(5);
  app.querySelectorAll('[data-bet-quick]').forEach((btn) => {
    btn.onclick = () => adjustBet(Number(btn.dataset.betQuick));
  });
  const betInput = document.getElementById('betInput');
  if (betInput) {
    betInput.addEventListener('input', (event) => {
      state.betInputDraft = String(event.target.value || '');
      const bounds = getBetBounds(state.currentMatch);
      if (state.betInputDraft === '' || isValidBetValue(state.betInputDraft, bounds)) {
        betInput.setCustomValidity('');
      } else {
        betInput.setCustomValidity(`Enter a whole number from ${bounds.min} to ${bounds.max}`);
      }
      const agreeBtn = document.getElementById('agreeBetBtn');
      if (agreeBtn) agreeBtn.disabled = !canConfirmBet;
      const raiseBtn = document.getElementById('raiseBetBtn');
      if (raiseBtn) raiseBtn.disabled = !isValidBetValue(state.betInputDraft, bounds);
      const lowerBtn = document.getElementById('lowerBetBtn');
      if (lowerBtn) lowerBtn.disabled = !isValidBetValue(state.betInputDraft, bounds);
      const confirmBtn = document.getElementById('confirmBetBtn');
      if (confirmBtn) confirmBtn.disabled = !canConfirmBet || !isValidBetValue(state.betInputDraft, bounds);
    });
    betInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitBetDraft({ renderNow: true });
    });
    betInput.addEventListener('blur', () => {
      commitBetDraft({ renderNow: false });
    });
  }
  const confirmBetBtn = document.getElementById('confirmBetBtn');
  if (confirmBetBtn) {
    confirmBetBtn.onclick = () => {
      if (state.betInputDraft !== '') commitBetDraft({ renderNow: false });
      const bounds = getBetBounds(state.currentMatch);
      if (!isValidBetValue(state.currentBet, bounds)) return;
      emitConfirmBet();
    };
  }
  const agreeBetBtn = document.getElementById('agreeBetBtn');
  if (agreeBetBtn) {
    agreeBetBtn.onclick = () => {
      if (state.betInputDraft !== '') commitBetDraft({ renderNow: false });
      emitBetResponse('agree');
    };
  }
  const raiseBetBtn = document.getElementById('raiseBetBtn');
  if (raiseBetBtn) {
    raiseBetBtn.onclick = () => {
      if (state.betInputDraft !== '') commitBetDraft({ renderNow: false });
      const bounds = getBetBounds(state.currentMatch);
      if (!isValidBetValue(state.currentBet, bounds)) return;
      emitBetResponse('raise', state.currentBet);
    };
  }
  const lowerBetBtn = document.getElementById('lowerBetBtn');
  if (lowerBetBtn) {
    lowerBetBtn.onclick = () => {
      if (state.betInputDraft !== '') commitBetDraft({ renderNow: false });
      const bounds = getBetBounds(state.currentMatch);
      if (!isValidBetValue(state.currentBet, bounds)) return;
      emitBetResponse('lower', state.currentBet);
    };
  }
  const resetNegotiationBtn = document.getElementById('resetNegotiationBtn');
  if (resetNegotiationBtn) {
    resetNegotiationBtn.onclick = () => {
      emitResetBetNegotiation();
    };
  }
  const resetBetStateBtn = document.getElementById('resetBetStateBtn');
  if (resetBetStateBtn) {
    resetBetStateBtn.onclick = () => {
      resetBetStateToLobby();
    };
  }
  const betChatInput = document.getElementById('betChatInput');
  const betChatSendBtn = document.getElementById('betChatSendBtn');
  const sendBetChat = () => {
    const draft = String(state.matchChatDraft || '').trim();
    if (!draft) return;
    emitMatchChat(draft);
    state.matchChatDraft = '';
    render();
  };
  if (betChatInput) {
    betChatInput.value = state.matchChatDraft || '';
    betChatInput.addEventListener('input', (event) => {
      state.matchChatDraft = String(event.target.value || '').slice(0, 140);
    });
    betChatInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      sendBetChat();
    });
  }
  if (betChatSendBtn) {
    betChatSendBtn.onclick = () => {
      sendBetChat();
    };
  }
  const emoteToggleBtn = document.getElementById('toggleEmoteBtn');
  if (emoteToggleBtn) {
    emoteToggleBtn.onclick = () => {
      if (Date.now() < state.emoteCooldownUntil) return;
      state.emotePickerOpen = !state.emotePickerOpen;
      render();
    };
  }
  app.querySelectorAll('[data-emote-type]').forEach((btn) => {
    btn.onclick = () => {
      if (Date.now() < state.emoteCooldownUntil) return;
      emitEmote(btn.dataset.emoteType, btn.dataset.emoteValue);
      state.emoteCooldownUntil = Date.now() + 5000;
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
      if (rankedMatch) state.pendingNavAfterLeave = 'ranked';
      else if (isBotMatchActive()) state.pendingNavAfterLeave = 'home';
      leaveCurrentMatch({ showToast: true, refreshOnError: true });
    };
  }
  const cancelLeaveMatchBtn = document.getElementById('cancelLeaveMatchBtn');
  if (cancelLeaveMatchBtn) {
    cancelLeaveMatchBtn.onclick = () => {
      state.leaveMatchModal = false;
      render();
    };
  }
  const confirmActionYes = document.getElementById('confirmActionYes');
  if (confirmActionYes) {
    confirmActionYes.onclick = () => {
      const action = state.confirmActionModal?.action;
      state.confirmActionModal = null;
      if (action) emitAction(action);
      render();
    };
  }
  const confirmActionNo = document.getElementById('confirmActionNo');
  if (confirmActionNo) {
    confirmActionNo.onclick = () => {
      state.confirmActionModal = null;
      render();
    };
  }
  syncTurnCountdownUI();
}

function syncPressureOverlay() {
  let mount = document.getElementById('pressureOverlayMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'pressureOverlayMount';
    document.body.appendChild(mount);
  }

  const match = state.currentMatch;
  const me = state.me;
  if (!match || !me || state.view !== 'match' || !match.pendingPressure) {
    state.pressureGlow = { key: '', expiresAt: 0, seen: true };
    mount.innerHTML = '';
    return;
  }

  const pressure = match.pendingPressure;
  const waitingPressure = pressure?.opponentId === me.id;
  const initiatorName = playerName(pressure.initiatorId);
  const glowKey = waitingPressure ? pressureGlowKey(match, pressure, me.id) : '';
  if (waitingPressure && state.pressureGlow.key !== glowKey) {
    state.pressureGlow = {
      key: glowKey,
      expiresAt: Date.now() + 5000,
      seen: false
    };
  } else if (!waitingPressure) {
    state.pressureGlow = {
      key: '',
      expiresAt: 0,
      seen: true
    };
  }
  const shouldPulse = waitingPressure && !state.pressureGlow.seen && Date.now() < state.pressureGlow.expiresAt;

  mount.innerHTML = `
    <div class="pressure-overlay-wrap ${shouldPulse ? 'is-attention' : ''}">
      <div class="pressure-overlay card">
        <strong>Pressure Bet Response Required</strong>
        <div class="muted">${initiatorName} used <strong>${pressure.type}</strong>.</div>
        ${
          waitingPressure
            ? `<div class="muted">Match +${pressure.delta} or surrender this hand.</div>
               <div class="pressure-actions">
                 <button class="primary ${shouldPulse ? 'attention-pulse' : ''}" id="pressureOverlayMatch">Match Bet</button>
                 <button class="warn ${shouldPulse ? 'attention-pulse' : ''}" id="pressureOverlaySurrender">Surrender Hand</button>
               </div>`
            : '<div class="muted">Waiting for opponent decision...</div>'
        }
      </div>
    </div>
  `;

  const matchBtn = document.getElementById('pressureOverlayMatch');
  if (matchBtn) {
    matchBtn.onclick = () => {
      state.pressureGlow.seen = true;
      syncPressureOverlay();
      emitPressureDecision('match');
    };
  }
  const surrenderBtn = document.getElementById('pressureOverlaySurrender');
  if (surrenderBtn) {
    surrenderBtn.onclick = () => {
      state.pressureGlow.seen = true;
      syncPressureOverlay();
      emitPressureDecision('surrender');
    };
  }
}

function syncQuickPlayOverlay() {
  let mount = document.getElementById('quickPlayOverlayMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'quickPlayOverlayMount';
    document.body.appendChild(mount);
  }

  if (!quickPlayIsActive()) {
    mount.innerHTML = '';
    return;
  }

  const isConnected = state.quickPlay.status === 'connected';
  const queuePosition =
    Number.isFinite(Number(state.quickPlay.queuePosition)) && Number(state.quickPlay.queuePosition) > 0
      ? Number(state.quickPlay.queuePosition)
      : null;
  const bucket = normalizeQuickPlayBucketValue(state.quickPlay.bucket) || normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket);
  const opponentName = state.quickPlay.opponentName || 'Opponent';
  mount.innerHTML = `
    <div class="quickplay-overlay-backdrop"></div>
    <div class="quickplay-overlay-panel card">
      <div class="quickplay-status-pill ${isConnected ? 'is-connected' : 'is-searching'}">
        ${isConnected ? 'Connected' : 'Searching'}
      </div>
      <h3>${isConnected ? 'Opponent found' : 'Finding match...'}</h3>
      <p class="muted">
        ${isConnected ? `Connected with ${opponentName}. Loading bet confirmation...` : 'Looking for another player in the Quick Play queue.'}
      </p>
      <div class="muted quickplay-bucket-note">Bet: $${formatQuickPlayBucket(bucket)}</div>
      ${
        !isConnected
          ? `<div class="quickplay-loader-row">
              <span class="quickplay-spinner" aria-hidden="true"></span>
              <span class="muted">${queuePosition ? `Queue position: ${queuePosition}` : 'Searching for a compatible opponent...'}</span>
            </div>`
          : ''
      }
      ${
        !isConnected
          ? `<div class="quickplay-actions">
               <button id="quickPlayCancelBtn" class="ghost">Cancel</button>
             </div>`
          : ''
      }
    </div>
  `;
  const cancelBtn = document.getElementById('quickPlayCancelBtn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      cancelQuickPlayQueue();
    };
  }
}

function syncRankedOverlay() {
  let mount = document.getElementById('rankedOverlayMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'rankedOverlayMount';
    document.body.appendChild(mount);
  }
  if (!rankedQueueIsActive()) {
    mount.innerHTML = '';
    return;
  }
  const isConnected = state.rankedQueue.connected;
  const tier = rankTierLabelFromUser(state.me || {});
  const elo = Math.max(0, Math.floor(Number(state.me?.rankedElo) || 0));
  mount.innerHTML = `
    <div class="quickplay-overlay-backdrop"></div>
    <div class="quickplay-overlay-panel card">
      <div class="quickplay-status-pill ${isConnected ? 'is-connected' : 'is-searching'}">
        ${isConnected ? 'Connected' : 'Searching'}
      </div>
      <h3>${isConnected ? 'Ranked opponent found' : 'Finding ranked match...'}</h3>
      <p class="muted">${isConnected ? `Connected with ${state.rankedQueue.opponentName || 'opponent'}.` : 'Matching by Elo and current rank tier.'}</p>
      <div class="muted quickplay-bucket-note">${tier} • Elo ${elo} • Bet ${Number(state.rankedQueue.bet || 0).toLocaleString()}</div>
      ${
        !isConnected
          ? `<div class="quickplay-loader-row">
              <span class="quickplay-spinner" aria-hidden="true"></span>
              <span class="muted">Searching for a fair ranked opponent...</span>
            </div>
            <div class="quickplay-actions">
              <button id="rankedOverlayCancelBtn" class="ghost">Cancel</button>
            </div>`
          : ''
      }
    </div>
  `;
  const cancelBtn = document.getElementById('rankedOverlayCancelBtn');
  if (cancelBtn) cancelBtn.onclick = () => cancelRankedQueue();
}

function syncQuickPlayBucketModal() {
  let mount = document.getElementById('quickPlayBucketMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'quickPlayBucketMount';
    document.body.appendChild(mount);
  }

  if (state.view !== 'home' || !state.quickPlay.bucketPickerOpen || quickPlayIsActive()) {
    mount.innerHTML = '';
    return;
  }

  const selectedBucket = normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) || 250;
  mount.innerHTML = `
    <div class="quickplay-picker-backdrop" id="quickPlayPickerBackdrop"></div>
    <div class="quickplay-picker-panel card">
      <h3>Quick Play Bet Bucket</h3>
      <p class="muted">Pick a fixed bet. You only match with players in the same bucket.</p>
      <div class="quickplay-bucket-grid" role="radiogroup" aria-label="Quick play bet bucket">
        ${QUICK_PLAY_BUCKETS.map((bucket) => `
          <button
            type="button"
            role="radio"
            aria-checked="${selectedBucket === bucket}"
            class="quickplay-bucket-btn ${selectedBucket === bucket ? 'is-selected' : ''}"
            data-quickplay-bucket="${bucket}"
          >
            $${bucket.toLocaleString()}
          </button>
        `).join('')}
      </div>
      <div class="quickplay-picker-actions">
        <button id="quickPlayPickerConfirmBtn" class="primary">Find Match</button>
        <button id="quickPlayPickerCancelBtn" class="ghost">Cancel</button>
      </div>
    </div>
  `;

  const backdrop = document.getElementById('quickPlayPickerBackdrop');
  if (backdrop) {
    backdrop.onclick = () => {
      state.quickPlay.bucketPickerOpen = false;
      render();
    };
  }
  mount.querySelectorAll('[data-quickplay-bucket]').forEach((btn) => {
    btn.onclick = () => {
      const bucket = normalizeQuickPlayBucketValue(btn.dataset.quickplayBucket);
      if (!bucket) return;
      state.quickPlay.selectedBucket = bucket;
      render();
    };
  });
  const confirmBtn = document.getElementById('quickPlayPickerConfirmBtn');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      const bucket = normalizeQuickPlayBucketValue(state.quickPlay.selectedBucket) || 250;
      joinQuickPlayQueue({ bucket });
    };
  }
  const cancelBtn = document.getElementById('quickPlayPickerCancelBtn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      state.quickPlay.bucketPickerOpen = false;
      render();
    };
  }
}

function render() {
  const previousView = state.lastRenderedView;
  const enteringFriends = previousView !== 'friends' && state.view === 'friends';
  state.lastRenderedView = state.view;
  app.dataset.view = state.view;
  const hasOnlineSession = Boolean(state.token && state.me);
  const hasOfflineSession = Boolean(!state.token && state.me && (offlineModeEnabled() || String(state.me.id || '').startsWith('offline:')));
  if (!hasOnlineSession && !hasOfflineSession) {
    renderAuth();
  } else {
    if (state.view === 'profile') {
      renderProfile();
    } else if (state.view === 'friends') {
      renderFriends();
    } else if (state.view === 'lobbies') {
      renderLobby();
    } else if (state.view === 'ranked') {
      renderRanked();
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
  syncChallengePromptOverlay();
  syncRoundResultModal();
  syncRankedSeriesResultModal();
  syncPressureOverlay();
  syncQuickPlayBucketModal();
  syncQuickPlayOverlay();
  syncRankedOverlay();
  syncTurnCountdownUI();
  syncXpBars();
  if (enteringFriends && state.token) loadFriendsData();
}

(async function init() {
  window.addEventListener('online', () => {
    refreshOfflineMode();
  });
  window.addEventListener('offline', () => {
    state.network.offlineMode = true;
    render();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.quickPlay.bucketPickerOpen) {
      state.quickPlay.bucketPickerOpen = false;
      render();
      return;
    }
    if (e.key === 'Escape' && state.notificationsOpen) {
      state.notificationsOpen = false;
      render();
      return;
    }
    if (state.view !== 'match') return;
    if (state.leaveMatchModal) {
      if (e.key === 'Escape') {
        state.leaveMatchModal = false;
        render();
      }
      return;
    }

    if (state.confirmActionModal) {
      if (e.key === 'Enter') {
        const action = state.confirmActionModal.action;
        state.confirmActionModal = null;
        if (action) emitAction(action);
        render();
      } else if (e.key === 'Escape') {
        state.confirmActionModal = null;
        render();
      }
      return;
    }

    if (isTypingTarget(e.target)) return;

    const key = String(e.key || '').toLowerCase();
    if (key === 'h') {
      triggerAction('hit');
    } else if (key === 's') {
      triggerAction('stand');
    } else if (key === 'd') {
      triggerAction('double');
    } else if (key === 'p') {
      triggerAction('split');
    } else if (key === 'r') {
      triggerAction('surrender');
    } else if (key === 'e') {
      if (Date.now() < state.emoteCooldownUntil) return;
      if (!isBotMatchActive() && state.currentMatch?.phase === 'ACTION_TURN') {
        state.emotePickerOpen = !state.emotePickerOpen;
        render();
      }
    }
  });
  window.addEventListener('pointerdown', (event) => {
    if (!state.emotePickerOpen || state.view !== 'match') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.emote-dock')) return;
    state.emotePickerOpen = false;
    render();
  }, { passive: true, capture: true });
  window.addEventListener('popstate', () => {
    state.view = initialViewFromPath();
    render();
  });
  initCursorSpotlight();
  useHoverGlow();
  initTwinkleLayer();
  await refreshOfflineMode({ silent: true });
  if (!offlineHeartbeatTimer) {
    offlineHeartbeatTimer = setInterval(() => {
      refreshOfflineMode({ silent: true });
    }, 8000);
  }
  if (!freeClaimTicker) {
    freeClaimTicker = setInterval(() => {
      let needsRender = false;
      if (state.token && state.me && state.freeClaimNextAt) {
        updateFreeClaimCountdown();
        if (state.view === 'home') syncFreeClaimUI();
      }
      const eventsChanged = refreshActiveEventsCountdown();
      if (eventsChanged && ['home', 'rules', 'match'].includes(state.view)) {
        needsRender = true;
      } else if (state.activeEvents.length && ['home', 'rules'].includes(state.view)) {
        syncEventCountdownUI();
      }
      if (needsRender) render();
    }, 1000);
  }
  if (!inviteCountdownTicker) {
    inviteCountdownTicker = setInterval(() => {
      if (!state.friendInvite) return;
      if (state.view === 'friends') syncInviteCountdownUI();
      else state.friendInviteRemainingMs = inviteRemainingMs();
    }, 1000);
  }
  if (!matchTurnTicker) {
    matchTurnTicker = setInterval(() => {
      if (state.view !== 'match') return;
      syncTurnCountdownUI();
    }, 120);
  }
  if (!challengeCountdownTicker) {
    challengeCountdownTicker = setInterval(() => {
      const crossedResetBoundary = updateChallengeResetCountdowns();
      if (state.view === 'challenges') syncChallengeCountdownUI();
      if (crossedResetBoundary && state.token && !state.challengeResetRefreshInFlight) {
        state.challengeResetRefreshInFlight = true;
        loadChallenges().finally(() => {
          state.challengeResetRefreshInFlight = false;
        });
      }
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
