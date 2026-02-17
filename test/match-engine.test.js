import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES,
  RULES,
  handTotal,
  handMeta,
  isSixSevenStartingHand,
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
  buildChallengePayload,
  countWinningSplitHandsForPlayer,
  calculateForfeitLossAmount,
  rankedTierFromElo,
  rankedBetRangeForElo,
  rankedKFactorForElo,
  rankedEloDeltaForGame,
  rankedSeriesDeltaForOutcome,
  streakCountsAfterOutcome,
  matchWinStreakAfterOutcome,
  getBotObservation,
  chooseBotActionFromObservation
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

test('06b six-seven stat checks initial two-card hand only', () => {
  assert.equal(isSixSevenStartingHand([card('6'), card('7')]), true);
  assert.equal(isSixSevenStartingHand([card('7'), card('6')]), true);
  assert.equal(isSixSevenStartingHand([card('6'), card('7'), card('2')]), false);
  assert.equal(isSixSevenStartingHand([card('6'), card('8')]), false);
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

test('31 bot pressure matching stays legal with dynamic in-round cap', () => {
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
  assert.equal(res.ok, true);
  assert.equal(m.round.players[botId].hands[0].bet, 375);
});

test('32 deal blocked until both players confirm', () => {
  const m = makeBettingMatch();
  const one = confirmBaseBet(m, 'p1');
  assert.equal(one.ok, true);
  assert.equal(m.phase, PHASES.ROUND_INIT);
  assert.equal(m.round.players.p1.hands.length, 0);
  const two = confirmBaseBet(m, 'p2');
  assert.equal(two.ok, true);
  assert.ok(
    m.phase === PHASES.ACTION_TURN ||
      m.phase === PHASES.NEXT_ROUND ||
      m.phase === PHASES.ROUND_RESOLVE ||
      m.phase === PHASES.REVEAL ||
      m.phase === PHASES.RESULT
  );
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

test('39b ranked tiers map elo to expected ranges', () => {
  assert.equal(rankedTierFromElo(1000).label, 'Bronze');
  assert.equal(rankedTierFromElo(1250).label, 'Silver');
  assert.equal(rankedTierFromElo(1700).label, 'Diamond');
  assert.deepEqual(rankedBetRangeForElo(1850), { min: 1000, max: 1000 });
});

test('39ba ranked K-factor decreases at higher Elo', () => {
  assert.equal(rankedKFactorForElo(1000), 32);
  assert.equal(rankedKFactorForElo(1300), 24);
  assert.equal(rankedKFactorForElo(1700), 16);
  assert.equal(rankedKFactorForElo(1950), 12);
});

test('39bb losing 2 of 3 vs similar Elo is net negative', () => {
  let playerElo = 1500;
  let opponentElo = 1500;
  let net = 0;
  const outcomes = [0, 0, 1];
  for (const actualScore of outcomes) {
    const playerCalc = rankedEloDeltaForGame({
      playerElo,
      opponentElo,
      actualScore,
      varianceMultiplier: 1,
      marginMultiplier: 1
    });
    const opponentCalc = rankedEloDeltaForGame({
      playerElo: opponentElo,
      opponentElo: playerElo,
      actualScore: 1 - actualScore,
      varianceMultiplier: 1,
      marginMultiplier: 1
    });
    playerElo += playerCalc.finalDelta;
    opponentElo += opponentCalc.finalDelta;
    net += playerCalc.finalDelta;
  }
  assert.equal(net < 0, true);
});

test('39bc high Elo win over low Elo yields small gain', () => {
  const result = rankedEloDeltaForGame({
    playerElo: 1900,
    opponentElo: 1200,
    actualScore: 1,
    varianceMultiplier: 1,
    marginMultiplier: 1
  });
  assert.equal(result.finalDelta >= 1, true);
  assert.equal(result.finalDelta <= 5, true);
});

test('39bd low Elo upset win is bigger but still clamped', () => {
  const highFav = rankedEloDeltaForGame({
    playerElo: 1900,
    opponentElo: 1200,
    actualScore: 1,
    varianceMultiplier: 1,
    marginMultiplier: 1
  });
  const upset = rankedEloDeltaForGame({
    playerElo: 1200,
    opponentElo: 1900,
    actualScore: 1,
    varianceMultiplier: 1,
    marginMultiplier: 1
  });
  assert.equal(upset.finalDelta > highFav.finalDelta, true);
  assert.equal(Math.abs(upset.finalDelta) <= 35, true);
});

test('39be series Elo win vs similar Elo lands in target range', () => {
  const seriesWin = rankedSeriesDeltaForOutcome({
    playerElo: 1400,
    opponentElo: 1400,
    won: true,
    rankTierKey: 'GOLD'
  });
  assert.equal(seriesWin.finalDelta >= 22, true);
  assert.equal(seriesWin.finalDelta <= 32, true);
});

test('39bf Bronze loss is softened versus Gold at same Elo', () => {
  const bronzeLoss = rankedSeriesDeltaForOutcome({
    playerElo: 1100,
    opponentElo: 1100,
    won: false,
    rankTierKey: 'BRONZE'
  });
  const goldLoss = rankedSeriesDeltaForOutcome({
    playerElo: 1500,
    opponentElo: 1500,
    won: false,
    rankTierKey: 'GOLD'
  });
  assert.equal(Math.abs(bronzeLoss.finalDelta) < Math.abs(goldLoss.finalDelta), true);
});

test('39bfa series loss vs similar Elo is moderate', () => {
  const goldLoss = rankedSeriesDeltaForOutcome({
    playerElo: 1500,
    opponentElo: 1500,
    won: false,
    rankTierKey: 'GOLD'
  });
  assert.equal(goldLoss.finalDelta <= -10, true);
  assert.equal(goldLoss.finalDelta >= -18, true);
});

test('39bg high Elo expected series win stays bounded', () => {
  const favoredWin = rankedSeriesDeltaForOutcome({
    playerElo: 1900,
    opponentElo: 1200,
    won: true,
    rankTierKey: 'LEGENDARY'
  });
  assert.equal(favoredWin.finalDelta >= 1, true);
  assert.equal(favoredWin.finalDelta <= 12, true);
});

test('39c double is blocked when pressure would exceed table max for opponent', () => {
  const p1Hand = newHand([card('9'), card('2')], [false, true], 250, 0);
  const p2Hand = newHand([card('10'), card('7')], [false, true], 500, 0);
  const m = makeMatch({ p1Hand, p2Hand, deck: [card('3')] });
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.error, 'Stake increase would exceed table max 500');
});

test('39d split is blocked when pressure would exceed table max for opponent', () => {
  const p1Hand = newHand([card('8'), card('8', 'D')], [false, true], 260, 0);
  const p2Hand = newHand([card('10'), card('7')], [false, true], 260, 0);
  const m = makeMatch({ p1Hand, p2Hand, deck: [card('4'), card('3')] });
  const res = applyAction(m, 'p1', 'split');
  assert.equal(res.error, 'Stake increase would exceed table max 500');
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

test('40b player bust on hit resolves round immediately as loss (no push)', () => {
  const m = makeMatch({
    p1Hand: newHand([card('K'), card('Q')], [false, true], 5, 0),
    p2Hand: newHand([card('10'), card('9')], [false, true], 5, 0),
    deck: [card('2', 'C')]
  });
  m.round.turnPlayerId = 'p1';

  const res = applyAction(m, 'p1', 'hit');
  assert.equal(res.ok, true);
  assert.equal(m.round.players.p1.hands[0].bust, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.outcome, 'lose');
  assert.notEqual(m.round.resultByPlayer.p1.outcome, 'push');
  assert.equal(m.round.resultByPlayer.p2.outcome, 'win');
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

function makeSplitResolutionMatch({ firstHand, secondHand, opponentHand }) {
  const m = makeMatch({ p1Hand: firstHand, p2Hand: opponentHand, deck: [] });
  m.round.turnPlayerId = 'p1';
  m.round.players.p1.hands = [firstHand, secondHand];
  m.round.players.p1.activeHandIndex = 1;
  m.round.players.p2.hands = [opponentHand];
  m.round.players.p2.activeHandIndex = 0;
  m.round.firstActionTaken = true;
  return m;
}

function makeOpponentSplitResolutionMatch({ playerHand, opponentFirstHand, opponentSecondHand }) {
  const m = makeMatch({ p1Hand: playerHand, p2Hand: opponentFirstHand, deck: [] });
  m.round.turnPlayerId = 'p1';
  m.round.players.p1.hands = [playerHand];
  m.round.players.p1.activeHandIndex = 0;
  m.round.players.p2.hands = [opponentFirstHand, opponentSecondHand];
  m.round.players.p2.activeHandIndex = 1;
  m.round.firstActionTaken = true;
  return m;
}

test('41b split payout sums both winning split hands', () => {
  const hand1 = newHand([card('10'), card('Q')], [false, false], 5, 1);
  hand1.wasSplitHand = true;
  hand1.stood = true;
  hand1.locked = true;
  const hand2 = newHand([card('10'), card('9')], [false, false], 5, 1);
  hand2.wasSplitHand = true;
  const opp = newHand([card('10'), card('8')], [false, false], 5, 0);
  opp.stood = true;
  opp.locked = true;
  const m = makeSplitResolutionMatch({ firstHand: hand1, secondHand: hand2, opponentHand: opp });

  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.deltaChips, 10);
  assert.equal(m.round.resultByPlayer.p2.deltaChips, -10);
});

test('41c split payout nets correctly when winning one and losing one hand', () => {
  const hand1 = newHand([card('10'), card('Q')], [false, false], 5, 1);
  hand1.wasSplitHand = true;
  hand1.stood = true;
  hand1.locked = true;
  const hand2 = newHand([card('10'), card('6')], [false, false], 5, 1);
  hand2.wasSplitHand = true;
  const opp = newHand([card('10'), card('8')], [false, false], 5, 0);
  opp.stood = true;
  opp.locked = true;
  const m = makeSplitResolutionMatch({ firstHand: hand1, secondHand: hand2, opponentHand: opp });

  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.deltaChips, 0);
  assert.equal(m.round.resultByPlayer.p2.deltaChips, 0);
});

test('41d split payout handles push scenarios per hand', () => {
  const hand1 = newHand([card('10'), card('Q')], [false, false], 5, 1);
  hand1.wasSplitHand = true;
  hand1.stood = true;
  hand1.locked = true;
  const hand2 = newHand([card('10'), card('8')], [false, false], 5, 1);
  hand2.wasSplitHand = true;
  const opp = newHand([card('10'), card('8')], [false, false], 5, 0);
  opp.stood = true;
  opp.locked = true;
  const m = makeSplitResolutionMatch({ firstHand: hand1, secondHand: hand2, opponentHand: opp });

  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.deltaChips, 5);
  assert.equal(m.round.resultByPlayer.p2.deltaChips, -5);
});

test('41da opponent split: player beating both split hands wins both payouts', () => {
  const playerHand = newHand([card('10'), card('Q')], [false, false], 10, 0);
  const opp1 = newHand([card('10'), card('8')], [false, false], 10, 1);
  opp1.wasSplitHand = true;
  opp1.stood = true;
  opp1.locked = true;
  const opp2 = newHand([card('10'), card('7')], [false, false], 10, 1);
  opp2.wasSplitHand = true;
  opp2.stood = true;
  opp2.locked = true;
  const m = makeOpponentSplitResolutionMatch({
    playerHand,
    opponentFirstHand: opp1,
    opponentSecondHand: opp2
  });

  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.deltaChips, 20);
  assert.equal(m.round.resultByPlayer.p2.deltaChips, -20);
});

test('41db opponent split: one win and one loss nets zero', () => {
  const playerHand = newHand([card('10'), card('9')], [false, false], 10, 0);
  const opp1 = newHand([card('10'), card('8')], [false, false], 10, 1);
  opp1.wasSplitHand = true;
  opp1.stood = true;
  opp1.locked = true;
  const opp2 = newHand([card('10'), card('Q')], [false, false], 10, 1);
  opp2.wasSplitHand = true;
  opp2.stood = true;
  opp2.locked = true;
  const m = makeOpponentSplitResolutionMatch({
    playerHand,
    opponentFirstHand: opp1,
    opponentSecondHand: opp2
  });

  const res = applyAction(m, 'p1', 'stand');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.REVEAL);
  assert.equal(m.round.resultByPlayer.p1.deltaChips, 0);
  assert.equal(m.round.resultByPlayer.p2.deltaChips, 0);
});

test('41e PvP double executes and syncs through pressure resolution', () => {
  const m = makeMatch({ deck: [card('3', 'C')] });
  const doubleRes = applyAction(m, 'p1', 'double');
  assert.equal(doubleRes.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.pendingPressure?.type, 'double');
  assert.equal(m.round.players.p1.hands[0].bet, 10);

  const matchRes = applyPressureDecision(m, 'p2', 'match');
  assert.equal(matchRes.ok, true);
  assert.equal(m.phase, PHASES.ACTION_TURN);
  assert.equal(m.round.players.p2.hands[0].bet, 10);
});

test('41f PvP split executes and resumes with two playable split hands', () => {
  const m = makeMatch({
    p1Hand: newHand([card('8'), card('8', 'D')], [false, true], 5, 0),
    deck: [card('4', 'S'), card('3', 'C')]
  });
  const splitRes = applyAction(m, 'p1', 'split');
  assert.equal(splitRes.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.pendingPressure?.type, 'split');
  assert.equal(m.round.players.p1.hands.length, 2);

  const matchRes = applyPressureDecision(m, 'p2', 'match');
  assert.equal(matchRes.ok, true);
  assert.equal(m.phase, PHASES.ACTION_TURN);
  assert.equal(m.round.turnPlayerId, 'p1');
  assert.equal(m.round.players.p2.hands[0].bet, 10);
});

test('41g bot double works against player pressure response', () => {
  const botId = 'bot:normal:double-flow';
  const m = makeMatch({ deck: [card('2', 'D')] });
  m.playerIds = ['p1', botId];
  m.round.players[botId] = m.round.players.p2;
  delete m.round.players.p2;
  m.round.turnPlayerId = botId;

  const doubleRes = applyAction(m, botId, 'double');
  assert.equal(doubleRes.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.pendingPressure?.opponentId, 'p1');
  assert.equal(m.round.players[botId].hands[0].bet, 10);

  const matchRes = applyPressureDecision(m, 'p1', 'match');
  assert.equal(matchRes.ok, true);
  assert.equal(m.round.players.p1.hands[0].bet, 10);
});

test('41h bot split works against player pressure response', () => {
  const botId = 'bot:normal:split-flow';
  const botPair = newHand([card('9'), card('9', 'D')], [false, true], 5, 0);
  const m = makeMatch({ p2Hand: botPair, deck: [card('4', 'S'), card('3', 'C')] });
  m.playerIds = ['p1', botId];
  m.round.players[botId] = m.round.players.p2;
  delete m.round.players.p2;
  m.round.turnPlayerId = botId;

  const splitRes = applyAction(m, botId, 'split');
  assert.equal(splitRes.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.pendingPressure?.opponentId, 'p1');
  assert.equal(m.round.players[botId].hands.length, 2);

  const matchRes = applyPressureDecision(m, 'p1', 'match');
  assert.equal(matchRes.ok, true);
  assert.equal(m.round.players.p1.hands[0].bet, 10);
});

test('41i action identifiers are case-insensitive server-side', () => {
  const m = makeMatch({ deck: [card('3', 'S')] });
  const res = applyAction(m, 'p1', 'DOUBLE');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
});

test('41j ranked double is allowed under normal legality rules', () => {
  const m = makeMatch({
    p1Hand: newHand([card('5'), card('6')], [false, true], 50, 0),
    p2Hand: newHand([card('9'), card('8')], [false, true], 50, 0),
    deck: [card('3', 'S')]
  });
  m.matchType = 'RANKED';
  m.rankedBet = 50;
  const res = applyAction(m, 'p1', 'double');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.players.p1.hands[0].bet, 100);
});

test('41k ranked split is allowed under normal legality rules', () => {
  const m = makeMatch({
    p1Hand: newHand([card('8'), card('8', 'D')], [false, true], 50, 0),
    p2Hand: newHand([card('10'), card('7')], [false, true], 50, 0),
    deck: [card('4', 'S'), card('3', 'C')]
  });
  m.matchType = 'RANKED';
  m.rankedBet = 50;
  const res = applyAction(m, 'p1', 'split');
  assert.equal(res.ok, true);
  assert.equal(m.phase, PHASES.PRESSURE_RESPONSE);
  assert.equal(m.round.players.p1.hands.length, 2);
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

test('44 bot observation excludes deck and hidden opponent cards', () => {
  const botId = 'bot:normal:t4';
  const hiddenOpponentHand = newHand([card('K', 'S'), card('A', 'D')], [false, true], 25, 0);
  const match = {
    id: 'm-bot-observe',
    phase: PHASES.ACTION_TURN,
    playerIds: ['p1', botId],
    round: {
      turnPlayerId: botId,
      pendingPressure: null,
      baseBet: 25,
      deck: [card('9', 'C'), card('7', 'D')],
      players: {
        p1: { activeHandIndex: 0, hands: [hiddenOpponentHand] },
        [botId]: { activeHandIndex: 0, hands: [newHand([card('9', 'H'), card('7', 'H')], [false, false], 25, 0)] }
      }
    }
  };
  const observation = getBotObservation(match, botId);
  const serialized = JSON.stringify(observation);
  assert.equal(serialized.includes('"deck"'), false);
  assert.equal(serialized.includes('A","suit":"D"'), false);
  assert.equal(observation.opponent.hands[0].upcards.length, 1);
  assert.equal(observation.opponent.hands[0].upcards[0].rank, 'K');
});

test('45 bot chooses from observed legal actions only', () => {
  const observation = {
    phase: PHASES.ACTION_TURN,
    allowedActions: ['hit', 'stand'],
    bot: {
      activeHandIndex: 0,
      hands: [{ total: 11, isSoft: false, splitEligible: false, pairRank: null }]
    },
    opponent: {
      hands: [{ upcards: [{ rank: '6', suit: 'H' }] }]
    },
    public: { baseBet: 25, mode: 'real' }
  };
  for (let i = 0; i < 30; i += 1) {
    const action = chooseBotActionFromObservation(observation, 'normal');
    assert.equal(['hit', 'stand'].includes(action), true);
  }
});

test('46 split-win counter counts a single split hand win', () => {
  const outcomes = [
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 0, winnerHandWasSplit: true },
    { winner: 'p2', loser: 'p1', amount: 25, handIndex: 1, winnerHandWasSplit: false }
  ];
  assert.equal(countWinningSplitHandsForPlayer(outcomes, 'p1'), 1);
});

test('47 split-win counter counts re-split wins separately', () => {
  const outcomes = [
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 0, winnerHandWasSplit: true },
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 1, winnerHandWasSplit: true },
    { winner: 'p2', loser: 'p1', amount: 25, handIndex: 2, winnerHandWasSplit: false }
  ];
  assert.equal(countWinningSplitHandsForPlayer(outcomes, 'p1'), 2);
});

test('48 split-win counter supports multiple split-hand wins in one round', () => {
  const outcomes = [
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 0, winnerHandWasSplit: true },
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 1, winnerHandWasSplit: true },
    { winner: 'p1', loser: 'p2', amount: 25, handIndex: 2, winnerHandWasSplit: true },
    { winner: null, loser: null, amount: 0, handIndex: 3, winnerHandWasSplit: false }
  ];
  assert.equal(countWinningSplitHandsForPlayer(outcomes, 'p1'), 3);
});

test('49 forfeit loss amount uses exposure when available', () => {
  assert.equal(calculateForfeitLossAmount(1000, 160, 25), 160);
});

test('50 forfeit loss amount falls back to base bet and caps by bankroll', () => {
  assert.equal(calculateForfeitLossAmount(40, 0, 50), 40);
});

test('51 hand streak: win increments, push keeps, loss resets win and increments loss', () => {
  const afterWin = streakCountsAfterOutcome({ winStreak: 3, lossStreak: 0, outcome: 'win' });
  assert.equal(afterWin.winStreak, 4);
  assert.equal(afterWin.lossStreak, 0);

  const afterPush = streakCountsAfterOutcome({ winStreak: 4, lossStreak: 0, outcome: 'push' });
  assert.equal(afterPush.winStreak, 4);
  assert.equal(afterPush.lossStreak, 0);

  const afterLoss = streakCountsAfterOutcome({ winStreak: 4, lossStreak: 0, outcome: 'loss' });
  assert.equal(afterLoss.winStreak, 0);
  assert.equal(afterLoss.lossStreak, 1);
});

test('52 match win streak: push is neutral and loss resets', () => {
  assert.equal(matchWinStreakAfterOutcome(5, 'win'), 6);
  assert.equal(matchWinStreakAfterOutcome(6, 'push'), 6);
  assert.equal(matchWinStreakAfterOutcome(6, 'loss'), 0);
});
