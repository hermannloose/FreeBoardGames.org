import { loadGameYaml } from "infra/games/GameLoader";
import { getGameIdFromCode } from "infra/i18n/I18nGetGameId";
import { Client } from "boardgame.io/react";
import { GameMode } from "fbg-games/gamesShared/definitions/mode";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import type { NextPage } from "next";
import { gameBoardWrapper } from "infra/games/GameBoardWrapper";
import { IGameArgs } from "fbg-games/gamesShared/definitions/game";
import { useTranslation } from "next-i18next";
import { parseGameSummary } from "infra/games/GameSummaryParser";
import { getGameStaticPaths } from "infra/misc/gameStaticPaths";

interface LocalGameProps {
  gameId: string;
  params: UrlParams;
  name: string;
}

const LocalGame: NextPage<any> = function (props: LocalGameProps) {
  // TODO(vdf): Add customization back #launch-blocker
  const t = useTranslation("Game").t;
  const players = [
    { playerID: 0, name: t("player_1") },
    { playerID: 1, name: t("player_2") },
  ];
  const gameArgs: IGameArgs = {
    gameCode: props.gameId,
    mode: GameMode.LocalFriend,
    lang: props.params.lang,
    name: props.name,
    players,
  };
  const board = require(`fbg-games/${props.gameId}/board`).default;
  const game = require(`fbg-games/${props.gameId}/game`).default;
  const App = Client({
    board: gameBoardWrapper({ gameArgs, board }),
    game,
    debug: false,
  });
  return <App />;
};

interface UrlParams {
  lang: string;
  playVerb: string;
  gameCode: string;
  gameId: string;
}

interface UrlPath {
  params: UrlParams;
}

export async function getStaticProps(
  path: UrlPath
): Promise<{ props: LocalGameProps }> {
  const { lang, gameCode } = path.params;
  const gameId = await getGameIdFromCode(lang, gameCode);
  const gameYaml = await loadGameYaml(gameId);
  const summary = parseGameSummary(gameYaml, lang, gameCode);
  return {
    props: {
      gameId,
      params: path.params,
      name: summary.name,
      ...(await serverSideTranslations(lang, [
        "Game",
        "GameOver",
        `game-${gameId}`,
      ])),
    },
  };
}

export const getStaticPaths = getGameStaticPaths;

export default LocalGame;
