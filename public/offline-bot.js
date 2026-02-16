const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const OFFLINE_STARTING_BANKROLL = 1000;
const OFFLINE_BASE_BET = 25;
const OFFLINE_BOT_ID = 'bot:offline:normal';
const OFFLINE_STORAGE_KEYS = Object.freeze({
  bankroll: 'bj_offline_bankroll',
  stats: 'bj_offline_stats',
  name: 'bj_offline_name'
});

let cardCounter = 0;

function nextCardId() {
  cardCounter += 1;
  return `off-${Date.now()}-${cardCounter}`;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(rank)) return 10;
  return Number(rank) || 0;
}

function handMeta(cards = []) {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  const isSoft = cards.some((card) => card.rank === 'A') && total <= 21 && total + 10 > 21;
  return {
    total,
    isSoft,
    isBust: total > 21,
    isNaturalBlackjack: cards.length === 2 && total === 21
  };
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: nextCardId(), rank, suit, hidden: false });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(match) {
  if (!Array.isArray(match._deck) || match._deck.length === 0) {
    match._deck = buildDeck();
  }
  return match._deck.pop();
}

function newHand(cards, bet, splitDepth = 0) {
  const meta = handMeta(cards);
  return {
    bet,
    cards,
    stood: false,
    locked: false,
    surrendered: false,
    actionCount: 0,
    bust: meta.isBust,
    doubled: false,
    doubleCount: 0,
    splitDepth,
    naturalBlackjack: meta.isNaturalBlackjack,
    outcome: null
  };
}

function refreshHandView(hand, { revealAll = true } = {}) {
  const visibleCards = revealAll ? hand.cards : hand.cards.filter((card) => !card.hidden);
  const visibleMeta = handMeta(visibleCards);
  const fullMeta = handMeta(hand.cards);
  hand.totalKnown = revealAll;
  hand.visibleTotal = revealAll ? fullMeta.total : visibleMeta.total;
  hand.total = revealAll ? fullMeta.total : null;
  hand.isSoft = revealAll ? fullMeta.isSoft : visibleMeta.isSoft;
}

function refreshMatchViews(match) {
  const playerId = match.playerIds[0];
  const botId = match.playerIds[1];
  const revealOpponent = match.phase === 'RESULT' || match.phase === 'REVEAL';
  for (const hand of match.players[playerId].hands) refreshHandView(hand, { revealAll: true });
  for (const hand of match.players[botId].hands) refreshHandView(hand, { revealAll: revealOpponent });
  match.participants[botId].difficulty = match._difficulty || 'normal';
}

function hasPlayableHand(playerState) {
  return (playerState.hands || []).some((hand) => !hand.locked && !hand.bust && !hand.surrendered && !hand.stood);
}

function advanceToNextPlayableHand(playerState) {
  for (let i = 0; i < playerState.hands.length; i += 1) {
    const hand = playerState.hands[i];
    if (!hand.locked && !hand.bust && !hand.surrendered && !hand.stood) {
      playerState.activeHandIndex = i;
      return true;
    }
  }
  return false;
}

function handCanSplit(hand, handCount, maxHands = 4) {
  if (!hand || !Array.isArray(hand.cards) || hand.cards.length !== 2) return false;
  if (handCount >= maxHands) return false;
  if ((hand.splitDepth || 0) >= 3) return false;
  return hand.cards[0]?.rank === hand.cards[1]?.rank;
}

function revealBotCards(match) {
  const botId = match.playerIds[1];
  for (const hand of match.players[botId].hands) {
    for (const card of hand.cards) card.hidden = false;
  }
}

function startRound(match) {
  const playerId = match.playerIds[0];
  const botId = match.playerIds[1];
  const bet = Math.max(1, Math.floor(Number(match.baseBet) || OFFLINE_BASE_BET));
  if (match.players[playerId].bankroll < bet) {
    return { error: `Need at least ${bet} offline chips to start.` };
  }
  match._deck = buildDeck();
  match._committedThisRound = bet;
  match._roundStartBankroll = match.players[playerId].bankroll;
  match.players[playerId].bankroll -= bet;
  match.stakesCommitted = true;
  match.canEditBet = false;
  match.canConfirmBet = false;
  const pCards = [drawCard(match), drawCard(match)];
  const bCards = [drawCard(match), drawCard(match)];
  bCards[1].hidden = true;
  match.players[playerId].hands = [newHand(pCards, bet, 0)];
  match.players[playerId].activeHandIndex = 0;
  match.players[botId].hands = [newHand(bCards, bet, 0)];
  match.players[botId].activeHandIndex = 0;
  match.phase = 'ACTION_TURN';
  match.currentTurn = playerId;
  match.roundResult = null;
  match.resultChoiceByPlayer = {};
  refreshMatchViews(match);
  return { ok: true };
}

function resolveRound(match) {
  const playerId = match.playerIds[0];
  const botId = match.playerIds[1];
  revealBotCards(match);
  const botHand = match.players[botId].hands[0];
  const botMeta = handMeta(botHand.cards);
  let payout = 0;

  for (const hand of match.players[playerId].hands) {
    const meta = handMeta(hand.cards);
    if (hand.surrendered) {
      hand.outcome = 'lose';
      payout += Math.floor(hand.bet * 0.25);
      continue;
    }
    if (meta.isBust) {
      hand.outcome = 'lose';
      continue;
    }
    const playerNatural = meta.isNaturalBlackjack;
    const botNatural = botMeta.isNaturalBlackjack;
    if (botMeta.isBust) {
      hand.outcome = 'win';
      payout += hand.bet * 2;
      continue;
    }
    if (playerNatural && !botNatural) {
      hand.outcome = 'win';
      payout += hand.bet * 2;
      continue;
    }
    if (botNatural && !playerNatural) {
      hand.outcome = 'lose';
      continue;
    }
    if (meta.total > botMeta.total) {
      hand.outcome = 'win';
      payout += hand.bet * 2;
    } else if (meta.total < botMeta.total) {
      hand.outcome = 'lose';
    } else {
      hand.outcome = 'push';
      payout += hand.bet;
    }
  }

  match.players[playerId].bankroll += payout;
  const delta = match.players[playerId].bankroll - match._roundStartBankroll;
  match.phase = 'RESULT';
  match.currentTurn = null;
  match.canEditBet = false;
  match.canConfirmBet = false;
  match.resultChoiceByPlayer = {};
  match.roundResult = {
    matchId: match.id,
    roundNumber: match.roundNumber,
    outcome: delta > 0 ? 'win' : delta < 0 ? 'lose' : 'push',
    title: delta > 0 ? 'You Win' : delta < 0 ? 'You Lose' : 'Push',
    deltaChips: delta,
    previousBankroll: match._roundStartBankroll,
    newBankroll: match.players[playerId].bankroll,
    isPractice: true
  };
  refreshMatchViews(match);
  return { ok: true, roundResult: match.roundResult };
}

function botPlay(match) {
  const botId = match.playerIds[1];
  const state = match.players[botId];
  const hand = state.hands[state.activeHandIndex || 0];
  if (!hand) return;
  while (!hand.locked && !hand.bust && !hand.stood && !hand.surrendered) {
    const meta = handMeta(hand.cards);
    if (meta.total < 17) {
      const card = drawCard(match);
      card.hidden = true;
      hand.cards.push(card);
      hand.actionCount += 1;
      if (handMeta(hand.cards).isBust) {
        hand.bust = true;
        hand.locked = true;
      }
    } else {
      hand.stood = true;
      hand.locked = true;
    }
  }
}

export function loadOfflineProfile() {
  const storedName = String(localStorage.getItem(OFFLINE_STORAGE_KEYS.name) || '').trim();
  const bankrollRaw = Number(localStorage.getItem(OFFLINE_STORAGE_KEYS.bankroll));
  const bankroll = Number.isFinite(bankrollRaw) ? Math.max(0, Math.floor(bankrollRaw)) : OFFLINE_STARTING_BANKROLL;
  const statsRaw = localStorage.getItem(OFFLINE_STORAGE_KEYS.stats);
  let stats = { rounds: 0, wins: 0, losses: 0, pushes: 0 };
  if (statsRaw) {
    try {
      const parsed = JSON.parse(statsRaw);
      stats = {
        rounds: Math.max(0, Math.floor(Number(parsed?.rounds) || 0)),
        wins: Math.max(0, Math.floor(Number(parsed?.wins) || 0)),
        losses: Math.max(0, Math.floor(Number(parsed?.losses) || 0)),
        pushes: Math.max(0, Math.floor(Number(parsed?.pushes) || 0))
      };
    } catch {
      // Ignore invalid local storage payloads.
    }
  }
  return {
    name: storedName || 'Offline Player',
    bankroll,
    stats
  };
}

export function saveOfflineProfile(profile) {
  if (!profile) return;
  const bankroll = Math.max(0, Math.floor(Number(profile.bankroll) || 0));
  const name = String(profile.name || 'Offline Player').trim().slice(0, 24) || 'Offline Player';
  const stats = {
    rounds: Math.max(0, Math.floor(Number(profile.stats?.rounds) || 0)),
    wins: Math.max(0, Math.floor(Number(profile.stats?.wins) || 0)),
    losses: Math.max(0, Math.floor(Number(profile.stats?.losses) || 0)),
    pushes: Math.max(0, Math.floor(Number(profile.stats?.pushes) || 0))
  };
  localStorage.setItem(OFFLINE_STORAGE_KEYS.name, name);
  localStorage.setItem(OFFLINE_STORAGE_KEYS.bankroll, String(bankroll));
  localStorage.setItem(OFFLINE_STORAGE_KEYS.stats, JSON.stringify(stats));
}

export function createOfflineMatch({ playerId, playerName, bankroll, difficulty = 'normal', baseBet = OFFLINE_BASE_BET }) {
  const match = {
    id: `offline:${Date.now()}`,
    lobbyId: null,
    matchType: 'OFFLINE_BOT',
    participants: {
      [playerId]: { id: playerId, username: playerName, isBot: false, level: 1, dynamicBadge: null, selectedTitle: '' },
      [OFFLINE_BOT_ID]: { id: OFFLINE_BOT_ID, username: `Bot (${difficulty})`, isBot: true, difficulty, level: 1, dynamicBadge: null, selectedTitle: '' }
    },
    mode: 'offline',
    isPractice: true,
    highRoller: false,
    roundNumber: 1,
    phase: 'ROUND_INIT',
    playerIds: [playerId, OFFLINE_BOT_ID],
    currentTurn: null,
    turnExpiresAt: null,
    turnTimeoutMs: 30000,
    pendingPressure: null,
    baseBet: Math.max(1, Math.floor(Number(baseBet) || OFFLINE_BASE_BET)),
    minBet: 5,
    maxDoublesPerHand: 1,
    maxBetCap: 5000,
    maxHandsPerPlayer: 4,
    canEditBet: true,
    canConfirmBet: true,
    betConfirmedByPlayer: { [playerId]: false, [OFFLINE_BOT_ID]: false },
    stakesCommittedByPlayer: {},
    stakesCommitted: false,
    postedBetByPlayer: {},
    roundResult: null,
    resultChoiceByPlayer: {},
    players: {
      [playerId]: { activeHandIndex: 0, bankroll: Math.max(0, Math.floor(Number(bankroll) || OFFLINE_STARTING_BANKROLL)), hands: [] },
      [OFFLINE_BOT_ID]: { activeHandIndex: 0, bankroll: 1_000_000_000, hands: [] }
    },
    disconnects: {
      [playerId]: { connected: true, graceEndsAt: null },
      [OFFLINE_BOT_ID]: { connected: true, graceEndsAt: null }
    },
    _difficulty: difficulty,
    _deck: [],
    _committedThisRound: 0,
    _roundStartBankroll: Math.max(0, Math.floor(Number(bankroll) || OFFLINE_STARTING_BANKROLL))
  };
  return match;
}

function finishPlayerTurn(match) {
  const playerId = match.playerIds[0];
  const playerState = match.players[playerId];
  if (advanceToNextPlayableHand(playerState)) {
    match.currentTurn = playerId;
    match.phase = 'ACTION_TURN';
    refreshMatchViews(match);
    return { ok: true };
  }
  const botId = match.playerIds[1];
  match.currentTurn = botId;
  botPlay(match);
  return resolveRound(match);
}

export function offlineSetBaseBet(match, amount) {
  if (!match || match.phase !== 'ROUND_INIT') return { error: 'Bet can only be changed before round start' };
  const bankroll = match.players[match.playerIds[0]].bankroll;
  const parsed = Math.max(match.minBet, Math.min(match.maxBetCap, Math.floor(Number(amount) || match.baseBet)));
  if (parsed > bankroll) return { error: 'Insufficient offline bankroll for this bet' };
  match.baseBet = parsed;
  return { ok: true, selected: parsed };
}

export function offlineConfirmBet(match) {
  if (!match || match.phase !== 'ROUND_INIT') return { error: 'Round is already active' };
  return startRound(match);
}

export function offlineApplyAction(match, action) {
  if (!match || match.phase !== 'ACTION_TURN') return { error: 'Round not in action phase' };
  const playerId = match.playerIds[0];
  if (match.currentTurn !== playerId) return { error: 'Not your turn' };
  const state = match.players[playerId];
  const hand = state.hands[state.activeHandIndex || 0];
  if (!hand || hand.locked || hand.bust || hand.surrendered || hand.stood) return { error: 'No active hand' };
  if (action === 'hit') {
    hand.actionCount += 1;
    hand.cards.push(drawCard(match));
    const meta = handMeta(hand.cards);
    if (meta.isBust) {
      hand.bust = true;
      hand.locked = true;
    } else if (meta.total === 21) {
      hand.stood = true;
      hand.locked = true;
    }
    refreshMatchViews(match);
    return hand.locked ? finishPlayerTurn(match) : { ok: true };
  }
  if (action === 'stand') {
    hand.actionCount += 1;
    hand.stood = true;
    hand.locked = true;
    refreshMatchViews(match);
    return finishPlayerTurn(match);
  }
  if (action === 'surrender') {
    if ((hand.actionCount || 0) > 0) return { error: 'Surrender is only available before you act on this hand' };
    hand.actionCount += 1;
    hand.surrendered = true;
    hand.locked = true;
    refreshMatchViews(match);
    return finishPlayerTurn(match);
  }
  if (action === 'double') {
    if ((hand.actionCount || 0) > 0 || hand.doubled) return { error: 'Double is only available as your first action on this hand' };
    if (match.players[playerId].bankroll < hand.bet) return { error: 'Insufficient bankroll to double' };
    match.players[playerId].bankroll -= hand.bet;
    match._committedThisRound += hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.doubleCount = (hand.doubleCount || 0) + 1;
    hand.actionCount += 1;
    hand.cards.push(drawCard(match));
    const meta = handMeta(hand.cards);
    if (meta.isBust) {
      hand.bust = true;
    } else {
      hand.stood = true;
    }
    hand.locked = true;
    refreshMatchViews(match);
    return finishPlayerTurn(match);
  }
  if (action === 'split') {
    if (!handCanSplit(hand, state.hands.length, match.maxHandsPerPlayer || 4)) return { error: 'Split unavailable' };
    if (match.players[playerId].bankroll < hand.bet) return { error: 'Insufficient bankroll to split' };
    match.players[playerId].bankroll -= hand.bet;
    match._committedThisRound += hand.bet;
    const [c1, c2] = hand.cards;
    const depth = (hand.splitDepth || 0) + 1;
    const h1 = newHand([{ ...c1, hidden: false }, drawCard(match)], hand.bet, depth);
    const h2 = newHand([{ ...c2, hidden: false }, drawCard(match)], hand.bet, depth);
    h1.wasSplitHand = true;
    h2.wasSplitHand = true;
    const idx = state.activeHandIndex || 0;
    state.hands.splice(idx, 1, h1, h2);
    state.activeHandIndex = idx;
    refreshMatchViews(match);
    return { ok: true };
  }
  return { error: 'Unknown action' };
}

export function offlineRoundChoice(match, choice) {
  if (!match || match.phase !== 'RESULT') return { error: 'Round result not ready' };
  const playerId = match.playerIds[0];
  if (choice === 'betting') {
    match.phase = 'ROUND_INIT';
    match.roundNumber += 1;
    match.stakesCommitted = false;
    match.canEditBet = true;
    match.canConfirmBet = true;
    match.roundResult = null;
    match.currentTurn = null;
    return { ok: true };
  }
  if (choice === 'double') {
    const doubled = Math.max(1, Math.floor(Number(match.baseBet) || OFFLINE_BASE_BET) * 2);
    if (match.players[playerId].bankroll < doubled) return { error: `Need at least ${doubled} offline chips` };
    match.baseBet = doubled;
  }
  match.phase = 'ROUND_INIT';
  match.roundNumber += 1;
  match.stakesCommitted = false;
  match.canEditBet = true;
  match.canConfirmBet = true;
  match.roundResult = null;
  match.currentTurn = null;
  return startRound(match);
}

export function applyOfflineRoundStats(stats, roundResult) {
  const base = {
    rounds: Math.max(0, Math.floor(Number(stats?.rounds) || 0)),
    wins: Math.max(0, Math.floor(Number(stats?.wins) || 0)),
    losses: Math.max(0, Math.floor(Number(stats?.losses) || 0)),
    pushes: Math.max(0, Math.floor(Number(stats?.pushes) || 0))
  };
  if (!roundResult) return base;
  base.rounds += 1;
  if (roundResult.outcome === 'win') base.wins += 1;
  else if (roundResult.outcome === 'lose') base.losses += 1;
  else base.pushes += 1;
  return base;
}

export { OFFLINE_STORAGE_KEYS, OFFLINE_STARTING_BANKROLL, OFFLINE_BASE_BET };
