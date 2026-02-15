import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES,
  RULES,
  handTotal,
  handMeta,
  canSplit,
  applyAction,
  applyBaseBetSelection,
  confirmBaseBet,
  applyPressureDecision,
  newHand,
  hasPlayableHand,
  advanceToNextPlayableHand,
  refreshChallengesForUser,
  recordChallengeEventForMatch,
  buildChallengePayload
} from '../server.js';

function card(rank, suit = 'H') {
  return { rank, suit, id: `${rank}${suit}` };
}

function makeMatch({ phase = PHASES.ACTION_TURN, p1Hand, p2Hand, deck = [] } = {}) {
  return {
    id: 'm1',
    phase,
    playerIds: ['p1', 'p2'],
    betControllerId: 'p1',
    betSettings: { selectedBetById: { p1: 5, p2: 5 } },
    startingPlayerIndex: 0,
    round: {
      turnPlayerId: 'p1',
      pendingPressure: null,
      baseBet: 5,
      firstActionTaken: false,
      postedBetByPlayer: { p1: 5, p2: 5 },
      allInPlayers: { p1: false, p2: false },
      deck: [...deck],
      players: {
        p1: {
          activeHandIndex: 0,
          hands: [p1Hand || newHand([card('9'), card('7')], [false, true], 5, 0)]
        },
        p2: {
          activeHandIndex: 0,
          hands: [p2Hand || newHand([card('10'), card('6')], [false, true], 5, 0)]
        }
      }
    }
  };
}

function makeBettingMatch() {
  return {
    id: 'm-bet',
    phase: PHASES.ROUND_INIT,
    playerIds: ['p1', 'p2'],
    betControllerId: 'p1',
    betSettings: { selectedBetById: { p1: 25, p2: 25 } },
    startingPlayerIndex: 0,
    roundNumber: 1,
    round: {
      baseBet: 25,
      firstActionTaken: false,
      postedBetByPlayer: { p1: 0, p2: 0 },
      allInPlayers: { p1: false, p2: false },
      betConfirmedByPlayer: { p1: false, p2: false },
      turnPlayerId: null,
      firstActionPlayerId: null,
      pendingPressure: null,
      deck: [],
      players: {
        p1: { activeHandIndex: 0, hands: [] },
        p2: { activeHandIndex: 0, hands: [] }
      }
    }
  };
}

function makeBotBettingMatch(difficulty = 'easy') {
  const botId = `bot:${difficulty}:t1`;
  return {
    id: 'm-bot-bet',
    phase: PHASES.ROUND_INIT,
    playerIds: ['p1', botId],
    betControllerId: 'p1',
    betSettings: { selectedBetById: { p1: 25, [botId]: 25 } },
    bot: { difficultyById: { [botId]: difficulty }, chipsById: { [botId]: 1000 } },
    startingPlayerIndex: 0,
    roundNumber: 1,
    round: {
      baseBet: 25,
      firstActionTaken: false,
      postedBetByPlayer: { p1: 0, [botId]: 0 },
      allInPlayers: { p1: false, [botId]: false },
      betConfirmedByPlayer: { p1: false, [botId]: false },
      turnPlayerId: null,
      firstActionPlayerId: null,
      pendingPressure: null,
      deck: [],
      players: {
        p1: { activeHandIndex: 0, hands: [] },
        [botId]: { activeHandIndex: 0, hands: [] }
      }
    }
  };
}

test('01 handTotal without aces', () => {
  assert.equal(handTotal([card('10'), card('7')]), 17);
});

test('02 handTotal with soft ace', () => {
  assert.equal(handTotal([card('A'), card('6')]), 17);
});

test('03 handTotal with multiple aces adjusts correctly', () => {
  assert.equal(handTotal([card('A'), card('A'), card('9')]), 21);
});

test('04 handMeta marks soft totals', () => {
  const meta = handMeta([card('A'), card('6')]);
  assert.equal(meta.total, 17);
  assert.equal(meta.isSoft, true);
});

test('05 handMeta marks bust', () => {
  const meta = handMeta([card('K'), card('9'), card('5')]);
  assert.equal(meta.isBust, true);
});

test('06 handMeta marks natural blackjack', () => {
  const meta = handMeta([card('A'), card('K')]);
  assert.equal(meta.isNaturalBlackjack, true);
});

test('07 canSplit true on same rank pair', () => {
  assert.equal(canSplit(newHand([card('8'), card('8', 'D')], [false, true], 5, 0)), true);
});

test('08 canSplit false on non-pair', () => {
  assert.equal(canSplit(newHand([card('8'), card('7')], [false, true], 5, 0)), false);
});

test('09 canSplit false with more than two cards', () => {
  assert.equal(canSplit(newHand([card('8'), card('8', 'D'), card('2')], [false, true, false], 5, 0)), false);
});

test('10 canSplit false when max split depth reached', () => {
  assert.equal(canSplit(newHand([card('8'), card('8', 'D')], [false, true], 5, RULES.MAX_SPLITS)), false);
});

test('11 applyAction rejects when not in action phase', () => {
  const m = makeMatch({ phase: PHASES.PRESSURE_RESPONSE });
  const res = applyAction(m, 'p1', 'hit');
  assert.equal(res.error, 'Round not in action phase');
});

test('12 applyAction rejects when not your turn', () => {
  const m = makeMatch();
  const res = applyAction(m, 'p2', 'hit');
  assert.equal(res.error, 'Not your turn');
});

test('13 hit draws exactly one card', () => {
  const m = makeMatch({ deck: [card('2', 'S')] });
  const before = m.round.players.p1.hands[0].cards.length;
  const res = applyAction(m, 'p1', 'hit');
  assert.equal(res.ok, true);
  assert.equal(m.round.players.p1.hands[0].cards.length, before + 1);
});

test('14 hit bust locks the hand', () => {
  const m = makeMatch({ p1Hand: newHand([card('K'), card('Q')], [false, true], 5, 0), deck: [card('5')] });
  const res = applyAction(m, 'p1', 'hit');
  assert.equal(res.ok, true);
  const hand = m.round.players.p1.hands[0];
  assert.equal(hand.bust, true);
  assert.equal(hand.locked, true);
});

test('15 stand locks and marks stood', () => {
  const m = makeMatch();
  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  const hand = m.round.players.p1.hands[0];
  assert.equal(hand.stood, true);
  assert.equal(hand.locked, true);
});

test('16 surrender locks and marks surrendered', () => {
  const m = makeMatch();
  const res = applyAction(m, 'p1', 'surrender');
  assert.equal(res.ok, true);
  const hand = m.round.players.p1.hands[0];
  assert.equal(hand.surrendered, true);
  assert.equal(hand.locked, true);
});

test('17 double doubles bet, draws one, locks hand, and creates pending pressure', () => {
  const m = makeMatch({ deck: [card('3')] });
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.ok, true);
  const hand = m.round.players.p1.hands[0];
  assert.equal(hand.bet, 10);
  assert.equal(hand.locked, true);
  assert.equal(hand.stood, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.ok(m.round.pendingPressure);
});

test('18 cannot double after taking another action', () => {
  const m = makeMatch({ p1Hand: newHand([card('5'), card('4')], [false, true], 5, 0), deck: [card('2')] });
  const hit = applyAction(m, 'p1', 'hit');
  assert.equal(hit.ok, true);
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.error, 'Double is only available as your first action on this hand');
});

test('19 split creates two hands with hidden second cards', () => {
  const m = makeMatch({ p1Hand: newHand([card('8'), card('8', 'D')], [false, true], 5, 0), deck: [card('4'), card('3')] });
  const res = applyAction(m, 'p1', 'split');
  assert.equal(res.ok, true);
  assert.equal(m.round.players.p1.hands.length, 2);
  assert.deepEqual(m.round.players.p1.hands[0].hidden, [false, true]);
  assert.deepEqual(m.round.players.p1.hands[1].hidden, [false, true]);
});

test('20 split disallowed if not a pair', () => {
  const m = makeMatch({ p1Hand: newHand([card('8'), card('7')], [false, true], 5, 0) });
  const res = applyAction(m, 'p1', 'split');
  assert.equal(res.error, 'Split unavailable');
});

test('21 split disallowed after max depth', () => {
  const m = makeMatch({ p1Hand: newHand([card('8'), card('8', 'D')], [false, true], 5, RULES.MAX_SPLITS) });
  const res = applyAction(m, 'p1', 'split');
  assert.equal(res.error, 'Split unavailable');
});

test('22 pressure decision match increases opponent bet on affected hand', () => {
  const m = makeMatch({ deck: [card('3')] });
  applyAction(m, 'p1', 'double');
  const before = m.round.players.p2.hands[0].bet;
  const res = applyPressureDecision(m, 'p2', 'match');
  assert.equal(res.ok, true);
  assert.equal(m.round.players.p2.hands[0].bet, before + 5);
  assert.equal(m.round.pendingPressure, null);
});

test('23 pressure decision surrender locks affected hand', () => {
  const m = makeMatch({ deck: [card('3')] });
  applyAction(m, 'p1', 'double');
  const res = applyPressureDecision(m, 'p2', 'surrender');
  assert.equal(res.ok, true);
  const hand = m.round.players.p2.hands[0];
  assert.equal(hand.surrendered, true);
  assert.equal(hand.locked, true);
});

test('24 pressure decision rejected in wrong phase', () => {
  const m = makeMatch();
  const res = applyPressureDecision(m, 'p2', 'match');
  assert.equal(res.error, 'No pressure decision needed');
});

test('25 pressure decision rejected for wrong actor', () => {
  const m = makeMatch({ deck: [card('3')] });
  applyAction(m, 'p1', 'double');
  const res = applyPressureDecision(m, 'p1', 'match');
  assert.equal(res.error, 'Not your decision');
});

test('26 actions are blocked while pressure is pending', () => {
  const m = makeMatch({ deck: [card('3')] });
  applyAction(m, 'p1', 'double');
  const res = applyAction(m, 'p2', 'hit');
  assert.equal(res.error, 'Round not in action phase');
});

test('27 advanceToNextPlayableHand selects first unlocked hand left-to-right', () => {
  const playerState = {
    activeHandIndex: 2,
    hands: [
      { locked: true, surrendered: false, bust: false, stood: true },
      { locked: false, surrendered: false, bust: false, stood: false },
      { locked: false, surrendered: false, bust: false, stood: false }
    ]
  };
  const found = advanceToNextPlayableHand(playerState);
  assert.equal(found, true);
  assert.equal(playerState.activeHandIndex, 1);
});

test('28 hasPlayableHand false when all hands are resolved', () => {
  const playerState = {
    hands: [
      { locked: true, surrendered: false, bust: true, stood: false },
      { locked: true, surrendered: true, bust: false, stood: false }
    ]
  };
  assert.equal(hasPlayableHand(playerState), false);
});

test('29 base bet can be changed before first action by controller', () => {
  const m = makeBettingMatch();
  const res = applyBaseBetSelection(m, 'p1', 25);
  assert.equal(res.ok, true);
  assert.equal(m.round.baseBet, 25);
  assert.equal(m.phase, PHASES.ROUND_INIT);
  assert.equal(m.round.players.p1.hands.length, 0);
});

test('30 base bet cannot change current round after first action', () => {
  const m = makeBettingMatch();
  m.phase = PHASES.ACTION_TURN;
  const res = applyBaseBetSelection(m, 'p1', 25);
  assert.equal(res.error, 'Bet can only be changed before cards are dealt');
});

test('31 pressure match rejected when it would exceed table max', () => {
  const m = makeMatch({ deck: [card('3')] });
  const botId = 'bot:easy:test';
  m.playerIds = ['p1', botId];
  m.bot = { difficultyById: { [botId]: 'easy' }, chipsById: { [botId]: 999999 } };
  m.round.players[botId] = m.round.players.p2;
  delete m.round.players.p2;
  m.round.players[botId].hands[0].bet = 250;
  m.round.players.p1.hands[0].bet = 125;
  applyAction(m, 'p1', 'double');
  const res = applyPressureDecision(m, botId, 'match');
  assert.equal(res.error, 'Bet cannot exceed 250 for this table');
});

test('32 deal blocked until both players confirm', () => {
  const m = makeBettingMatch();
  const one = confirmBaseBet(m, 'p1');
  assert.equal(one.ok, true);
  assert.equal(m.phase, PHASES.ROUND_INIT);
  assert.equal(m.round.players.p1.hands.length, 0);
  const two = confirmBaseBet(m, 'p2');
  assert.equal(two.ok, true);
  assert.ok(m.phase === PHASES.ACTION_TURN || m.phase === PHASES.NEXT_ROUND);
  assert.equal(m.round.players.p1.hands[0].cards.length, 2);
  assert.equal(m.round.players.p2.hands[0].cards.length, 2);
});

test('33 invalid bet rejected during betting phase', () => {
  const m = makeBettingMatch();
  const res = applyBaseBetSelection(m, 'p1', 2);
  assert.equal(res.ok, true);
  assert.equal(res.selected, 5);
});

test('34 bet change rejected outside betting phase', () => {
  const m = makeBettingMatch();
  m.phase = PHASES.ACTION_TURN;
  const res = applyBaseBetSelection(m, 'p1', 30);
  assert.equal(res.error, 'Bet can only be changed before cards are dealt');
});

test('35 round starts with correct posted bets after confirm', () => {
  const m = makeBettingMatch();
  applyBaseBetSelection(m, 'p1', 25);
  confirmBaseBet(m, 'p1');
  confirmBaseBet(m, 'p2');
  assert.equal(m.round.baseBet, 25);
  assert.equal(m.round.players.p1.hands[0].bet, 25);
  assert.equal(m.round.players.p2.hands[0].bet, 25);
});

test('36 bots have unlimited bankroll and always post full base bet', () => {
  const m = makeBettingMatch();
  m.bot = { difficultyById: { 'bot:easy': 'easy' }, chipsById: { 'bot:easy': 12 } };
  m.playerIds = ['p1', 'bot:easy'];
  m.round.players['bot:easy'] = { activeHandIndex: 0, hands: [] };
  delete m.round.players.p2;
  m.round.postedBetByPlayer['bot:easy'] = 0;
  m.round.allInPlayers['bot:easy'] = false;
  m.round.betConfirmedByPlayer['bot:easy'] = false;
  delete m.round.postedBetByPlayer.p2;
  delete m.round.allInPlayers.p2;
  delete m.round.betConfirmedByPlayer.p2;
  m.betSettings.selectedBetById['bot:easy'] = 25;
  delete m.betSettings.selectedBetById.p2;
  confirmBaseBet(m, 'p1');
  confirmBaseBet(m, 'bot:easy');
  assert.equal(m.round.players['bot:easy'].hands[0].bet, 25);
  assert.equal(m.round.allInPlayers['bot:easy'], false);
});

test('37 busting one split hand advances to next split hand', () => {
  const m = makeMatch({
    p1Hand: newHand([card('10'), card('Q')], [false, true], 5, 0),
    p2Hand: newHand([card('9'), card('7')], [false, true], 5, 0),
    deck: [card('5')]
  });
  m.round.players.p1.hands = [
    newHand([card('10'), card('Q')], [false, true], 5, 1),
    newHand([card('9'), card('2')], [false, true], 5, 1)
  ];
  m.round.players.p1.activeHandIndex = 0;
  const res = applyAction(m, 'p1', 'hit');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.ACTION_TURN);
  assert.equal(m.round.turnPlayerId, 'p1');
  assert.equal(m.round.players.p1.activeHandIndex, 1);
  assert.equal(m.round.players.p1.hands[0].bust, true);
});

test('38 resplitting is allowed up to 4 hands total', () => {
  const m = makeMatch({
    p1Hand: newHand([card('8'), card('8', 'D')], [false, true], 5, 0),
    deck: [card('5'), card('7'), card('6'), card('8')]
  });
  const first = applyAction(m, 'p1', 'split');
  assert.equal(first.ok, true);
  m.phase = PHASES.ACTION_TURN;
  m.round.pendingPressure = null;
  m.round.turnPlayerId = 'p1';
  const second = applyAction(m, 'p1', 'split');
  assert.equal(second.ok, true);
  assert.equal(m.round.players.p1.hands.length, 3);

  // Force 4th hand cap and verify split is then rejected.
  m.round.players.p1.hands.push(newHand([card('4'), card('5')], [false, true], 5, 1));
  m.round.players.p1.activeHandIndex = 0;
  m.phase = PHASES.ACTION_TURN;
  m.round.pendingPressure = null;
  m.round.turnPlayerId = 'p1';
  const blocked = applyAction(m, 'p1', 'split');
  assert.equal(blocked.error, 'Split unavailable');
});

test('39 bot difficulty bet ranges are clamped server-side', () => {
  const m = makeBotBettingMatch('easy');
  const high = applyBaseBetSelection(m, 'p1', 9999);
  assert.equal(high.ok, true);
  assert.equal(high.selected, 250);

  const low = applyBaseBetSelection(m, 'p1', 0);
  assert.equal(low.ok, true);
  assert.equal(low.selected, 1);
});

test('40 bot bust resolves round immediately without waiting for player action', () => {
  const botId = 'bot:normal:t2';
  const m = {
    id: 'm-bot-bust-now',
    phase: PHASES.ACTION_TURN,
    playerIds: ['p1', botId],
    round: {
      turnPlayerId: botId,
      pendingPressure: null,
      baseBet: 5,
      firstActionTaken: false,
      postedBetByPlayer: { p1: 5, [botId]: 5 },
      allInPlayers: { p1: false, [botId]: false },
      deck: [card('2', 'S')],
      players: {
        p1: { activeHandIndex: 0, hands: [newHand([card('9'), card('7')], [false, true], 5, 0)] },
        [botId]: { activeHandIndex: 0, hands: [newHand([card('K'), card('Q')], [false, true], 5, 0)] }
      }
    }
  };

  const res = applyAction(m, botId, 'hit');
  assert.equal(res.ok, true);
  assert.equal(m.round.players[botId].hands[0].bust, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.outcome, 'win');
  assert.equal(m.round.resultByPlayer[botId].outcome, 'lose');
});

test('41 bot split first-hand bust advances to second bot hand', () => {
  const botId = 'bot:normal:t3';
  const m = {
    id: 'm-bot-split-bust-advance',
    phase: PHASES.ACTION_TURN,
    playerIds: ['p1', botId],
    round: {
      turnPlayerId: botId,
      pendingPressure: null,
      baseBet: 5,
      firstActionTaken: false,
      postedBetByPlayer: { p1: 5, [botId]: 5 },
      allInPlayers: { p1: false, [botId]: false },
      deck: [card('5', 'D')],
      players: {
        p1: { activeHandIndex: 0, hands: [newHand([card('9'), card('7')], [false, true], 5, 0)] },
        [botId]: {
          activeHandIndex: 0,
          hands: [
            newHand([card('10'), card('Q')], [false, true], 5, 1),
            newHand([card('9'), card('2')], [false, true], 5, 1)
          ]
        }
      }
    }
  };

  const res = applyAction(m, botId, 'hit');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.ACTION_TURN);
  assert.equal(m.round.turnPlayerId, botId);
  assert.equal(m.round.players[botId].activeHandIndex, 1);
  assert.equal(m.round.players[botId].hands[0].bust, true);
  assert.equal(m.round.players[botId].hands[1].bust, false);
});

test('42 practice matches do not advance challenge progress, real matches do', () => {
  const user = { challengeSets: {}, skillChallenges: [] };
  refreshChallengesForUser(user, true);
  const item = user.challengeSets.hourly.items[0];
  const before = item.progress;

  const blocked = recordChallengeEventForMatch({ mode: 'practice' }, user, item.event, 1);
  assert.equal(blocked, false);
  assert.equal(item.progress, before);

  const recorded = recordChallengeEventForMatch({ mode: 'real' }, user, item.event, 1);
  assert.equal(recorded, true);
  assert.equal(item.progress, Math.min(item.goal, before + 1));
});

test('43 challenge payload includes reset timestamps for countdown UI', () => {
  const user = { challengeSets: {}, skillChallenges: [] };
  refreshChallengesForUser(user, true);
  const payload = buildChallengePayload(user);
  assert.ok(payload.challengeResets.daily);
  assert.ok(payload.challengeResets.weekly);
  assert.equal(Number.isFinite(new Date(payload.nextDailyResetAt).getTime()), true);
  assert.equal(Number.isFinite(new Date(payload.nextWeeklyResetAt).getTime()), true);
});
