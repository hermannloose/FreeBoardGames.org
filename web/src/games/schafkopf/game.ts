import { Ctx, Game } from 'boardgame.io';
import { Stage } from 'boardgame.io/core';
import { ICard, Suit, ITrick } from 'gamesShared/definitions/cards';

import { Phases, Stages, Contract, IG, DefaultIG, IPlayer, DefaultIPlayer } from './types';
import * as util from './util/misc';
import * as u_summary from './util/summary';
import { Moves } from './moves';

export const SchafkopfGame: Game<IG> = {
  name: 'schafkopf',

  setup: (ctx: Ctx): IG => {
    const game = { ...DefaultIG };
    game.players = new Array(ctx.numPlayers).fill(0).map((_, i) => ({
      ...DefaultIPlayer,
      id: i.toString(),
      isDealer: i == 0,
    }));
    game.trick = { cards: [], leaderId: game.players[1].id };
    return game;
  },

  playerView: (G: IG, ctx: Ctx, playerID: string): IG => {
    if (ctx.gameover || playerID === null || ctx.phase == Phases.round_end) return G;
    const dummyCard: ICard = { suit: Suit.Schell, value: 14 };
    const dummyTrick: ITrick = { cards: [] };
    const stripSecrets: (IPlayer) => IPlayer = (P) => {
      if (P.id == playerID) return P;
      return <IPlayer>{
        ...P,
        hand: P.hand.map(() => dummyCard),
      };
    };
    return {
      ...G,
      players: G.players.map(stripSecrets),
      deck: G.deck.map(() => dummyCard),
      calledTakerId: G.calledTakerId == playerID ? G.calledTakerId : null,
      calledMayRun: G.calledTakerId == playerID ? G.calledMayRun : null,
      resolvedTricks: G.resolvedTricks.map((T, i) => (i == G.resolvedTricks.length - 1 ? T : dummyTrick)),
    };
  },

  phases: {
    bidding: {
      start: true,

      onBegin: (G: IG, ctx: Ctx) => {
        const handSize = 8;
        const dealerId = G.players.findIndex((P) => P.isDealer);
        const leader = G.players[util.mod(dealerId + 1, ctx.numPlayers)];
        const cmpCards = util.get_cmpCards(Contract.None, ctx.numPlayers == 4 ? Suit.Herz : null);
        Object.assign(G, {
          ...DefaultIG,
          players: G.players,
          deck: ctx.random.Shuffle(getSortedDeck(ctx.numPlayers)),
          trick: { cards: [], leaderId: leader.id },
          roundSummaries: G.roundSummaries,
        });
        G.players.forEach((P, i) => {
          P.bid = Contract.None;
          P.isTaker = false;
          P.isReady = true;
          P.hand = G.deck.slice(i * handSize, (i + 1) * handSize).sort(cmpCards);
        });
      },

      turn: {
        moveLimit: 1,
        order: {
          first: (G: IG, ctx: Ctx) => {
            const dealerPos = G.players.findIndex((P) => P.isDealer);
            return util.mod(dealerPos + 1, ctx.playOrder.length);
          },
          next: (G: IG, ctx: Ctx) => {
            let i = ctx.playOrderPos;
            do {
              i = util.mod(i + 1, ctx.playOrder.length);
            } while (G.players[i].bid == 0);
            return i;
          },
        },
      },

      moves: {
        MakeBid: Moves.MakeBid,
      },

      endIf: (G: IG) => {
        if (G.players[0].hand.length == 0) return;
        if (G.players.some((P) => P.bid == Contract.Solo)) {
          return { next: Phases.discard };
        }
        if (G.players.some((P) => P.bid == Contract.None || P.bid == Contract.Some)) return;
        if (G.players.every((P) => P.bid == Contract.Pass)) {
          return { next: Phases.bidding };
        } else if (G.players.filter((P) => P.bid > Contract.Some).length == 1) {
          return { next: Phases.discard };
        }
      },

      onEnd: (G: IG, ctx: Ctx) => {
        let taker: IPlayer;
        let highestBid: Contract = Contract.Pass;
        G.players.forEach((P) => {
          if (P.bid > highestBid) {
            highestBid = P.bid;
            taker = P;
          }
          P.bid = Contract.None;
        });
        if (highestBid == Contract.Pass) {
          const dealerPos = G.players.findIndex((P) => P.isDealer);
          G.players[dealerPos].isDealer = false;
          G.players[util.mod(dealerPos + 1, ctx.numPlayers)].isDealer = true;
          return;
        }
        G.takerId = taker.id;
        G.contract = highestBid;
        taker.isTaker = true;
        if (G.contract == Contract.Ace) {
          G.trumpSuit = Suit.Herz;
        }
        const cmpCards = util.get_cmpCards(G.contract, G.trumpSuit);
        G.players.forEach((P) => {
          P.hand = P.hand.sort(cmpCards);
        });
      },
    },

    discard: {
      next: Phases.placement,
      turn: {
        onBegin: (G: IG, ctx: Ctx) => {
          const taker = util.getPlayerById(G, G.takerId);
          const has_highest_trump = taker.hand.some((C) => C.suit == Suit.Eichel && C.value == 12);
          if (G.contract == Contract.Solo) {
            ctx.events.setActivePlayers({ currentPlayer: Stages.select_trump });
          } else if (G.contract == Contract.Ace) {
            ctx.events.setActivePlayers({ currentPlayer: Stages.call_card });
          } else if (G.contract != Contract.Bettel && has_highest_trump) {
            ctx.events.setActivePlayers({ currentPlayer: Stages.announce_tout });
          } else {
            ctx.events.endPhase();
          }
        },
        stages: {
          select_trump: { moves: { SelectTrumpSuit: Moves.SelectTrumpSuit } },
          call_card: { moves: { Call: Moves.Call } },
          announce_tout: { moves: { AnnounceTout: Moves.AnnounceTout } },
        },
        order: {
          first: (G) => +G.takerId,
          next: (G) => +G.takerId,
        },
      },

      moves: {
        SelectCards: Moves.SelectCards,
      },

      onEnd: (G: IG) => {
        if (G.calledCard) {
          G.calledTakerId = getCalledTakerId(G.players, G.calledCard);
          const calledTaker = util.getPlayerById(G, G.calledTakerId);
          const CalledSuitCards = calledTaker.hand.filter((C) => C.suit == G.calledCard.suit);
          const numCalledSuit = CalledSuitCards.filter((C) => !util.isTrump(G, C)).length;
          G.calledMayRun = numCalledSuit >= 4 ? 1 : 0;
        }
        const cmpCards = util.get_cmpCards(G.contract, G.trumpSuit);
        G.players.forEach((P) => {
          P.hand = P.hand.sort(cmpCards);
        });
      },
    },

    placement: {
      turn: {
        activePlayers: { all: Stage.NULL },
        order: {
          first: (G) => +G.trick.leaderId,
          next: (G, ctx) => util.mod(ctx.playOrderPos + 1, ctx.playOrder.length),
        },
      },

      moves: {
        SelectCards: Moves.SelectCards,
        GiveContra: Moves.GiveContra,
      },

      next: (G: IG) => {
        if (G.players.some((P) => !P.isReady)) {
          return Phases.round_end;
        }
        return Phases.placement;
      },

      endIf: (G: IG, ctx: Ctx) => {
        return G.trick.cards.length == ctx.numPlayers;
      },

      onEnd: (G: IG) => {
        if (resolveTrick(G)) {
          const roundSummary = u_summary.getRoundSummary(G);
          G.roundSummaries.push(roundSummary);
          G.players.forEach((P, i) => {
            P.score += roundSummary.scoring[i];
            P.isReady = false;
          });
        }
      },
    },

    round_end: {
      next: Phases.bidding,
      turn: {
        stages: { get_ready: { moves: { Finish: Moves.Finish } } },
        activePlayers: { all: Stages.get_ready, moveLimit: 1 },
      },
      endIf: (G: IG) => G.players.every((P) => P.isReady),
      onEnd: (G: IG, ctx: Ctx) => {
        G.resolvedTricks = [];
        const dealerPos = G.players.findIndex((P) => P.isDealer);
        const newDealerPos = util.mod(dealerPos + 1, ctx.numPlayers);
        G.players.forEach((P, i) => {
          P.isDealer = i == newDealerPos;
          P.hand = [];
        });
      },
    },
  },
};

export function resolveTrick(G: IG): boolean {
  // returns true if this was the last trick in the game
  const lead_suit = G.trick.cards[0].suit;
  const lead_suit_is_called = G.contract == Contract.Ace && G.calledCard.suit == lead_suit;
  if (lead_suit_is_called && G.calledMayRun == 1) {
    G.calledMayRun = -1;
  }
  const winnerId = getTrickWinnerId(G.contract, G.trumpSuit, G.trick);
  const winner = util.getPlayerById(G, winnerId);
  G.trick.winnerId = winner.id;
  G.resolvedTricks.push(G.trick);
  G.trick = { cards: [], leaderId: winner.id };
  if (G.contract == Contract.Bettel && winner.isTaker) {
    return true;
  }
  return G.players.every((P) => P.hand.length == 0);
}

export function getCalledTakerId(players: IPlayer[], card: ICard): string {
  const takerId = players.find((P) => P.isTaker).id;
  const calledTaker = players.find((P) => {
    return P.hand.some((C) => C.suit == card.suit && C.value == card.value);
  });
  return calledTaker ? calledTaker.id : takerId;
}

export function getTrickWinnerId(contract: Contract, trumpSuit: Suit, T: ITrick): string {
  const leaderId = +T.leaderId;
  let ranks = T.cards.map((C) => util.cardRank(contract, trumpSuit, C));
  if (ranks.every((R) => R < 500)) {
    const lead_suit = T.cards[0].suit;
    ranks = ranks.map((R, i) => (T.cards[i].suit == lead_suit ? R : -1));
  }
  const max_rank = Math.max(...ranks);
  return util.mod(leaderId + ranks.findIndex((R) => R == max_rank), T.cards.length).toString();
}

export function getSortedDeck(numPlayers: number): ICard[] {
  let deck: ICard[] = [];
  for (let suit of ['Schell', 'Herz', 'Gras', 'Eichel']) {
    deck = deck.concat(
      Array(numPlayers == 3 ? 6 : 8)
        .fill(0)
        .map((_, i) => {
          return { suit: Suit[suit], value: i + (numPlayers == 3 ? 9 : 7) };
        }),
    );
  }
  return deck;
}
