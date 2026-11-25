/**
 * The committed fixtures bundled into the Worker (S45; ADR-017): a Worker has no
 * `node:fs`, so the files the API serves are static JSON imports, and the fixture
 * client reads them through the same `FixtureFiles` port Node uses. Only what
 * `FixtureClient` reads by name is here — schedules, games, plays, standings,
 * players, play metrics, player of the game (S99), season calendars and each season's final and spring standings (S128; S139 adds 2027's
 * season table, which lists the new season's teams before its first game, and 2026-09-12's mapped table), and
 * MLB's recorded table for each dated day (S160: `fetchStandings` maps `raw/standings-<date>.json` first, so the
 * Worker serves what the mapper adds, the clinch letter among it; the mapped `standings-<date>.json` stays as the
 * fallback it reads when a day has no recording). The recorded replay walk (`raw/`, 5+ MB) is for the Node capture tool,
 * which the Worker never runs. `bundled.test.ts` fails when a fixture the client
 * would read is missing from this list.
 */
import game744834 from "../../../../fixtures/game-744834.json" with { type: "json" };
import game745001 from "../../../../fixtures/game-745001.json" with { type: "json" };
import game823823 from "../../../../fixtures/game-823823.json" with { type: "json" };
import players823823 from "../../../../fixtures/players-823823.json" with { type: "json" };
import plays744834 from "../../../../fixtures/plays-744834.json" with { type: "json" };
import plays823823 from "../../../../fixtures/plays-823823.json" with { type: "json" };
import graphContent823823 from "../../../../fixtures/raw/graphql-content-823823.json" with { type: "json" };
import playMetrics823823 from "../../../../fixtures/raw/playmetrics-823823.json" with { type: "json" };
import playerOfTheGame823823 from "../../../../fixtures/raw/potg-823823.json" with { type: "json" };
import uniforms823823 from "../../../../fixtures/raw/uniforms-823823.json" with { type: "json" };
import seasons1950 from "../../../../fixtures/raw/seasons-1950.json" with { type: "json" };
import seasons2025 from "../../../../fixtures/raw/seasons-2025.json" with { type: "json" };
import seasons2026 from "../../../../fixtures/raw/seasons-2026.json" with { type: "json" };
import seasons2027 from "../../../../fixtures/raw/seasons-2027.json" with { type: "json" };
import rawStandings19500704 from "../../../../fixtures/raw/standings-1950-07-04.json" with { type: "json" };
import standings1950Final from "../../../../fixtures/raw/standings-1950-final.json" with { type: "json" };
import rawStandings20260905 from "../../../../fixtures/raw/standings-2026-09-05.json" with { type: "json" };
import rawStandings20260912 from "../../../../fixtures/raw/standings-2026-09-12.json" with { type: "json" };
import standings2026Final from "../../../../fixtures/raw/standings-2026-final.json" with { type: "json" };
import standings2026Spring from "../../../../fixtures/raw/standings-2026-spring.json" with { type: "json" };
import standings2027Final from "../../../../fixtures/raw/standings-2027-final.json" with { type: "json" };
import worldSeries1950 from "../../../../fixtures/raw/worldseries-1950.json" with { type: "json" };
import worldSeries2025 from "../../../../fixtures/raw/worldseries-2025.json" with { type: "json" };
import worldSeries2026 from "../../../../fixtures/raw/worldseries-2026.json" with { type: "json" };
import worldSeries2027 from "../../../../fixtures/raw/worldseries-2027.json" with { type: "json" };
import schedule20240704 from "../../../../fixtures/schedule-2024-07-04.json" with { type: "json" };
import schedule20260905 from "../../../../fixtures/schedule-2026-09-05.json" with { type: "json" };
import searchTeam147TagHomeRun from "../../../../fixtures/search--team-147--tag-home-run.json" with { type: "json" };
import searchWalkOff from "../../../../fixtures/search-walk-off.json" with { type: "json" };
import standings19500704 from "../../../../fixtures/standings-1950-07-04.json" with { type: "json" };
import standings20260905 from "../../../../fixtures/standings-2026-09-05.json" with { type: "json" };
import standings20260912 from "../../../../fixtures/standings-2026-09-12.json" with { type: "json" };
import { FixtureClient } from "./fixture-client.js";
import type { FixtureFiles } from "./fixture-client.js";

/** Fixture name → parsed JSON, as `fixtures/<name>` holds it. */
export const BUNDLED_FIXTURES: Readonly<Record<string, unknown>> = {
	"game-744834.json": game744834,
	"game-745001.json": game745001,
	"game-823823.json": game823823,
	"players-823823.json": players823823,
	"plays-744834.json": plays744834,
	"plays-823823.json": plays823823,
	// The recorded play-metrics feed (S93): pnpm dev reads only bundled fixtures.
	"raw/playmetrics-823823.json": playMetrics823823,
	// MLB's recorded GraphQL game content (S94).
	"raw/graphql-content-823823.json": graphContent823823,
	// MLB's recorded player of the game (S99).
	"raw/potg-823823.json": playerOfTheGame823823,
	// The recorded uniforms each team wore (S101).
	"raw/uniforms-823823.json": uniforms823823,
	// The recorded season calendars and World Series (S111), for the scoreboard's default day.
	// 1950 (S155): a season before divisions, and before MLB gave spring dates.
	"raw/seasons-1950.json": seasons1950,
	"raw/seasons-2025.json": seasons2025,
	"raw/seasons-2026.json": seasons2026,
	"raw/seasons-2027.json": seasons2027,
	// MLB's recorded tables for the dated days (S160), mapped by fetchStandings.
	"raw/standings-1950-07-04.json": rawStandings19500704,
	"raw/standings-1950-final.json": standings1950Final,
	"raw/standings-2026-09-05.json": rawStandings20260905,
	"raw/standings-2026-09-12.json": rawStandings20260912,
	"raw/standings-2026-final.json": standings2026Final,
	"raw/standings-2026-spring.json": standings2026Spring,
	"raw/standings-2027-final.json": standings2027Final,
	"raw/worldseries-1950.json": worldSeries1950,
	"raw/worldseries-2025.json": worldSeries2025,
	"raw/worldseries-2026.json": worldSeries2026,
	"raw/worldseries-2027.json": worldSeries2027,
	"schedule-2024-07-04.json": schedule20240704,
	"schedule-2026-09-05.json": schedule20260905,
	// MLB's recorded highlight search for "walk-off" (S5), so local and the Worker answer it offline.
	"search-walk-off.json": searchWalkOff,
	// MLB's recorded filtered search (S72): every home run in a Yankees game, newest first.
	"search--team-147--tag-home-run.json": searchTeam147TagHomeRun,
	"standings-1950-07-04.json": standings19500704,
	"standings-2026-09-05.json": standings20260905,
	"standings-2026-09-12.json": standings20260912,
};

/** The bundled fixtures as a fixture source; an unknown name rejects, like a missing file. */
export const bundledFixtureFiles: FixtureFiles = {
	read: async (name) =>
	{
		if (!(name in BUNDLED_FIXTURES)) throw new Error(`no bundled fixture ${name}`);
		return BUNDLED_FIXTURES[name];
	},
	list: async () => Object.keys(BUNDLED_FIXTURES),
};

/** The fixture MLB client the Worker uses by default. */
export function createBundledFixtureClient(): FixtureClient
{
	return new FixtureClient(bundledFixtureFiles);
}
