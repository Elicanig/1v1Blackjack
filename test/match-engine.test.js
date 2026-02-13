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
  advanceToNextPlayableHand
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

test('17 double doubles bet, draws one, and creates pending pressure', () => {
  const m = makeMatch({ deck: [card('3')] });
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.ok, true);
  const hand = m.round.players.p1.hands[0];
  assert.equal(hand.bet, 10);
  assert.equal(hand.locked, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.ok(m.round.pendingPressure);
});

test('18 cannot double twice on same hand', () => {
  const m = makeMatch({ deck: [card('3'), card('4')] });
  applyAction(m, 'p1', 'double');
  m.phase = PHASES.ACTION_TURN;
  m.round.pendingPressure = null;
  m.round.turnPlayerId = 'p1';
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.error, 'Hand cannot double down');
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

test('31 pressure match rejected when insufficient bankroll', () => {
  const m = makeMatch({ deck: [card('3')] });
  m.bot = { chipsById: { 'bot:test': 0 } };
  m.playerIds = ['p1', 'bot:test'];
  m.round.players['bot:test'] = m.round.players.p2;
  delete m.round.players.p2;
  applyAction(m, 'p1', 'double');
  const res = applyPressureDecision(m, 'bot:test', 'match');
  assert.equal(res.error, 'Insufficient chips to match pressure');
});

test('32 deal blocked until both players confirm', () => {
  const m = makeBettingMatch();
  const one = confirmBaseBet(m, 'p1');
  assert.equal(one.ok, true);
  assert.equal(m.phase, PHASES.ROUND_INIT);
  assert.equal(m.round.players.p1.hands.length, 0);
  const two = confirmBaseBet(m, 'p2');
  assert.equal(two.ok, true);
  assert.equal(m.phase, PHASES.ACTION_TURN);
  assert.equal(m.round.players.p1.hands[0].cards.length, 2);
  assert.equal(m.round.players.p2.hands[0].cards.length, 2);
});

test('33 invalid bet rejected during betting phase', () => {
  const m = makeBettingMatch();
  const res = applyBaseBetSelection(m, 'p1', 2);
  assert.equal(res.error, 'Bet must be at least 5');
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

test('36 all-in posting when opponent cannot fully match base bet', () => {
  const m = makeBettingMatch();
  m.bot = { chipsById: { 'bot:easy': 12 } };
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
  assert.equal(m.round.players['bot:easy'].hands[0].bet, 12);
  assert.equal(m.round.allInPlayers['bot:easy'], true);
});
