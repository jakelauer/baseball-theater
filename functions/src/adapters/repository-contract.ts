/**
 * The one storage contract every repository adapter is held to (ADR-018, S46;
 * the cases S9 wrote for Firestore, carried over). The in-memory test doubles
 * run it today; the Postgres adapter (S50) joins by calling the same function,
 * so the two can't drift.
 *
 * A subject describes how to build a value for a key at a version. Values must
 * differ in content between versions, so "replaced" and "kept" are observable.
 * Case (d) runs only for ports that list by date (`listByDate`); the others
 * have no such read. Case (g) is the user repository's identity link (S8,
 * ADR-019), in its own suite because users carry no version for (c)/(f);
 * case (h) is its deletion (ADR-028): `deleteFor` reaches profile and links. Case (p) is its staging tier
 * override (S215), kept apart from the real tier, and (h) proves the download and deletion reach it.
 * Case (i) is the same deletion for any registered `PersonalDataStore` (S6),
 * so each new store (settings now, S50's Postgres stores) runs one shared case.
 * Case (j) is the schedule repository's month read (S124, `listGameCounts`).
 * Case (k) is the game-state repository's write rule (S150), and case (l) the schedule repository's `served_base`
 * raise, read from the game-state store of the same database (S150). Case (m) is the game repository's state-field
 * read (S150).
 */
import {
	beforeEach, describe, expect, it,
} from "vitest";
import type {
	GameSnapshot, GameStateRow, ScheduleDay, StoredScheduleDay, UserProfile,
} from "@bt/domain";
import {
	entitlementsForTier, GAME_RECHECK_CLAIM_LEASE_MS, projectGame, SCHEDULE_MONTH_REFRESH_INTERVAL_MS,
} from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, GameStateRepository, OwedEdgePurge, OwedEdgePurgeRepository, PersonalDataStore, ScheduleRepository, UserRepository,
} from "@bt/ports";

/** The reads and writes every keyed repository shares. */
export interface ContractRepository<K, T>
{
	upsert(value: T): Promise<void>;
	get(key: K): Promise<T | null>;
	listByDate?(date: string): Promise<T[]>;
}

export interface ContractSubject<K, T>
{
	/** A fresh repository over empty storage. */
	create(): ContractRepository<K, T>;
	/** A value for `key` at `version`, whose content depends on the version. Dated on `date` when given. */
	make(key: K, version: number, date?: string): Promise<T>;
	keyOf(value: T): K;
	/** Two keys that `make` accepts, and one that is never written. */
	keys: [K, K];
	missingKey: K;
	/** Mutate a value in place (to prove reads hand back copies). */
	mutate(value: T): void;
}

/** What Postgres `jsonb` hands back for a written value. */
function asJson<T>(value: T): T
{
	return JSON.parse(JSON.stringify(value)) as T;
}

export function describeRepositoryContract<K, T>(label: string, subject: ContractSubject<K, T>): void
{
	describe(`${label} — repository contract`, () =>
	{
		let repo: ContractRepository<K, T>;
		const [k1, k2] = subject.keys;

		beforeEach(() =>
		{
			repo = subject.create();
		});

		it("(a) a read deep-equals the JSON of what was stored and is not the same object", async () =>
		{
			const written = await subject.make(k1, 1);
			await repo.upsert(written);
			const read = await repo.get(k1);
			expect(read).toEqual(asJson(written));
			expect(read).not.toBe(written);
		});

		it("(b) reads null for a missing key", async () =>
		{
			expect(await repo.get(subject.missingKey)).toBeNull();
		});

		it("(c) an upsert with a newer version replaces the stored value", async () =>
		{
			await repo.upsert(await subject.make(k1, 1));
			const newer = await subject.make(k1, 2);
			await repo.upsert(newer);
			expect(await repo.get(k1)).toEqual(asJson(newer));
		});

		if (subject.create().listByDate)
		{
			it("(d) listByDate returns exactly that date's entries, and [] for a date with none", async () =>
			{
				await repo.upsert(await subject.make(k1, 1, "2024-07-04"));
				await repo.upsert(await subject.make(k2, 1, "2024-07-05"));
				const listed = await repo.listByDate!("2024-07-04");
				expect(listed.map((v) => subject.keyOf(v))).toEqual([k1]);
				expect(await repo.listByDate!("1999-01-01")).toEqual([]);
			});
		}

		it("(e) mutating a written or a returned value does not change the store", async () =>
		{
			const written = await subject.make(k1, 1);
			const expected = asJson(written);
			await repo.upsert(written);
			subject.mutate(written);
			const read = await repo.get(k1);
			subject.mutate(read!);
			expect(await repo.get(k1)).toEqual(expected);
		});

		it("(f) an upsert whose version is not newer than the stored one is a no-op", async () =>
		{
			const held = await subject.make(k1, 2);
			await repo.upsert(held);
			await repo.upsert(await subject.make(k1, 1));
			const sameVersion = await subject.make(k1, 2);
			subject.mutate(sameVersion);
			await repo.upsert(sameVersion);
			expect(await repo.get(k1)).toEqual(asJson(held));
		});
	});
}

/** The identity-link part of the contract, for any `UserRepository` adapter, with its deletion and tier override (S215). */
export function describeIdentityLinkContract(label: string, create: () => UserRepository): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(g) linkIdentity maps (provider, subject) to one uid, read back by getByIdentity", async () =>
		{
			const repo = create();
			expect(await repo.getByIdentity("logto", "sub-1")).toBeNull();

			await repo.linkIdentity("logto", "sub-1", "uid-1");
			await repo.linkIdentity("google", "sub-2", "uid-1");
			expect(await repo.getByIdentity("logto", "sub-1")).toBe("uid-1");
			expect(await repo.getByIdentity("google", "sub-2")).toBe("uid-1");
			// The provider is part of the key: the same subject elsewhere is a different account.
			expect(await repo.getByIdentity("google", "sub-1")).toBeNull();

			// Relinking to the same user is a no-op; to another user, it is refused and the link stands.
			await repo.linkIdentity("logto", "sub-1", "uid-1");
			await expect(repo.linkIdentity("logto", "sub-1", "uid-2")).rejects.toThrow();
			expect(await repo.getByIdentity("logto", "sub-1")).toBe("uid-1");
		});

		it("(h) deleteFor removes one user's profile and identity links and leaves another user's untouched", async () =>
		{
			const repo = create();
			for (const uid of ["uid-1", "uid-2"])
			{
				await repo.upsert(contractUser(uid));
				await repo.linkIdentity("logto", `logto-${uid}`, uid);
				await repo.linkIdentity("google", `google-${uid}`, uid);
			}
			await repo.setTierOverride("uid-1", "Star Backer");
			await repo.setTierOverride("uid-2", "Backer");
			const kept = await repo.exportFor("uid-2");
			// S215 AC 3: the download carries the tier override.
			expect((await repo.exportFor("uid-1"))?.tierOverride).toBe("Star Backer");
			expect(kept?.tierOverride).toBe("Backer");

			await repo.deleteFor("uid-1");
			expect(await repo.getTierOverride("uid-1")).toBeNull();
			expect(await repo.getByUid("uid-1")).toBeNull();
			expect(await repo.getByIdentity("logto", "logto-uid-1")).toBeNull();
			expect(await repo.getByIdentity("google", "google-uid-1")).toBeNull();
			expect(await repo.exportFor("uid-1")).toBeNull();
			expect(await repo.exportFor("uid-2")).toEqual(kept);
			expect(kept?.identities).toHaveLength(2);

			// Idempotent (ADR-028): a deletion that failed partway can run again.
			await repo.deleteFor("uid-1");
			expect(await repo.exportFor("uid-2")).toEqual(kept);
		});

		it("(p) S215 AC 3: a tier override is stored per user apart from the real tier, which setting it never changes", async () =>
		{
			const repo = create();
			await repo.upsert(contractUser("uid-1"));
			await repo.upsert(contractUser("uid-2"));
			const real = (await repo.getByUid("uid-1"))!.entitlements;
			expect(await repo.getTierOverride("uid-1")).toBeNull();

			await repo.setTierOverride("uid-1", "Premium Sponsor");
			expect(await repo.getTierOverride("uid-1")).toBe("Premium Sponsor");
			expect(await repo.getTierOverride("uid-2")).toBeNull();
			// The real tier reads back unchanged.
			expect((await repo.getByUid("uid-1"))!.entitlements).toEqual(real);

			await repo.setTierOverride("uid-1", "none");
			expect(await repo.getTierOverride("uid-1")).toBe("none");
			await repo.setTierOverride("uid-1", null);
			expect(await repo.getTierOverride("uid-1")).toBeNull();
			expect((await repo.getByUid("uid-1"))!.entitlements).toEqual(real);
			// Clearing what isn't set is a no-op.
			await repo.setTierOverride("uid-2", null);
			expect(await repo.getTierOverride("uid-2")).toBeNull();
		});
	});
}

/** A complete user record for the contract cases; content depends on `uid` so two users differ. */
function contractUser(uid: string): UserProfile
{
	return {
		uid,
		email: `${uid}@example.test`,
		displayName: uid,
		patreonUserId: null,
		role: "member",
		entitlements: entitlementsForTier("none"),
		createdAt: "2026-10-24T00:00:00.000Z",
		updatedAt: "2026-10-24T00:00:00.000Z",
	};
}

/** A registered personal data store over fresh storage, and how to write something of a user's into it. */
export interface PersonalDataSubject
{
	create(): { store: PersonalDataStore;
		write(uid: string): Promise<void> };
}

/** The deletion part of the contract for any `PersonalDataStore` (ADR-028; case (h)'s form, store-generic). */
export function describePersonalDataStoreContract(label: string, subject: PersonalDataSubject): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(i) deleteFor removes one user's data, leaves another's untouched, and is a no-op when run again", async () =>
		{
			const { store, write } = subject.create();
			await write("uid-1");
			await write("uid-2");
			const kept = await store.exportFor("uid-2");
			expect(kept).not.toBeNull();
			expect(await store.exportFor("uid-1")).not.toBeNull();

			await store.deleteFor("uid-1");
			expect(await store.exportFor("uid-1")).toBeNull();
			expect(await store.exportFor("uid-2")).toEqual(kept);

			await store.deleteFor("uid-1");
			expect(await store.exportFor("uid-1")).toBeNull();
			expect(await store.exportFor("uid-2")).toEqual(kept);
		});
	});
}

/**
 * Case (j), the schedule repository's month read (S124): `listGameCounts` returns each stored day
 * in the range, both ends included, in date order, as its game count, its teams' IDs (S136), its
 * games' types and whether it has a regular-season game (S167), and its stamps exactly as stored,
 * and leaves out days outside the range or never stored. `makeDay` builds a stored day with
 * `gameCount` games (the fixture day's, all regular season, `R`).
 */
export function describeScheduleCountsContract(
	label: string,
	create: () => ScheduleRepository,
	makeDay: (date: string, gameCount: number, stamp: string) => Promise<ScheduleDay>,
): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(j) listGameCounts gives each stored day in the range, in order, with its game count, teams and stamps", async () =>
		{
			const repo = create();
			const days = [
				await makeDay("2024-07-06", 0, "2024-07-07T00:00:03.000Z"),
				await makeDay("2024-07-03", 1, "2024-07-07T00:00:01.000Z"),
				await makeDay("2024-07-04", 2, "2024-07-07T00:00:02.000Z"),
				await makeDay("2024-07-08", 1, "2024-07-07T00:00:04.000Z"),
			];
			for (const day of days) await repo.upsert(day);
			expect(await repo.listGameCounts("2024-07-04", "2024-07-06")).toEqual([
				{
					date: "2024-07-04",
					gameCount: 2,
					// The fixture day's two games: 121 at 120, 147 at 111.
					teamIds: [111, 120, 121, 147],
					gameTypes: ["R", "R"],
					regularSeason: true,
					regularSeasonTeamIds: [111, 120, 121, 147],
					fetchedAt: days[2]!.fetchedAt,
					lastChangedAt: days[2]!.lastChangedAt,
				},
				{
					date: "2024-07-06",
					gameCount: 0,
					teamIds: [],
					gameTypes: [],
					regularSeason: false,
					regularSeasonTeamIds: [],
					fetchedAt: days[0]!.fetchedAt,
					lastChangedAt: days[0]!.lastChangedAt,
				},
			]);
			expect(await repo.listGameCounts("1999-01-01", "1999-01-31")).toEqual([]);
		});

		it("(j) S136 AC 1 teams: each day lists its games' away and home team IDs once each, ascending, from the same read; a doubleheader's teams once, an empty day []", async () =>
		{
			const repo = create();
			const doubleheader = await makeDay("2024-07-04", 2, "2024-07-07T00:00:01.000Z");
			const [first, second] = doubleheader.games;
			// Game two of a doubleheader: the first game's teams again, under its own gamePk.
			doubleheader.games = [first!, second!, {
				...first!,
				gamePk: first!.gamePk + 1,
			}];
			await repo.upsert(doubleheader);
			await repo.upsert(await makeDay("2024-07-05", 0, "2024-07-07T00:00:02.000Z"));
			const tallies = await repo.listGameCounts("2024-07-01", "2024-07-31");
			// The fixture day's games are 121 at 120 and 147 at 111; game two repeats 121 at 120.
			expect(tallies.map((day) => [day.date, day.gameCount, day.teamIds])).toEqual([
				["2024-07-04", 3, [111, 120, 121, 147]],
				["2024-07-05", 0, []],
			]);
		});

		it("(j) S136 AC 1 teams: a stored game whose team ID isn't a number (null, or a string) adds no team, never 0 or NaN", async () =>
		{
			const repo = create();
			const day = await makeDay("2024-07-04", 2, "2024-07-07T00:00:01.000Z");
			const [first, second] = day.games;
			// The stored document is whatever was written; its type can't vouch for a hand-edited or
			// older row, so the read holds only what is a real team ID.
			day.games = [
				{
					...first!,
					teams: {
						away: {
							...first!.teams.away,
							id: null as unknown as number,
						},
						home: first!.teams.home,
					},
				},
				{
					...second!,
					teams: {
						away: second!.teams.away,
						home: {
							...second!.teams.home,
							id: "111" as unknown as number,
						},
					},
				},
			];
			await repo.upsert(day);
			// The fixture day's games are 121 at 120 and 147 at 111; 121 and 111 are the bad IDs here.
			expect((await repo.listGameCounts("2024-07-04", "2024-07-04")).map((d) => [d.gameCount, d.teamIds])).toEqual([
				[2, [120, 147]],
			]);
		});

		// S167 AC 3: each stored day's game types, one per game (`null` for an untyped one), and its
		// regular-season answer, from the same read. `typed` stores the fixture day's two games under
		// the given types, `undefined` leaving a game's key out as a day stored before S167 has it.
		const typed = async (date: string, types: (string | undefined)[]) =>
		{
			const day = await makeDay(date, types.length, "2024-07-07T00:00:01.000Z");
			day.games = day.games.map((game, i) =>
			{
				const { gameType: _dropped, ...untyped } = game;
				const type = types[i];
				return type === undefined ? untyped : {
					...untyped,
					gameType: type,
				};
			});
			return day;
		};
		const answers = async (types: (string | undefined)[]) =>
		{
			const repo = create();
			await repo.upsert(await typed("2024-07-04", types));
			return (await repo.listGameCounts("2024-07-04", "2024-07-04")).map((d) => [d.gameCount, d.gameTypes, d.regularSeason]);
		};

		it("(j) S167 AC 3 R and S: a day with a regular-season game and a spring game is regularSeason true", async () =>
		{
			expect(await answers(["R", "S"])).toEqual([[2, ["R", "S"], true]]);
		});

		it("(j) S167 AC 3 all-star: the All-Star Game's day is regularSeason false", async () =>
		{
			expect(await answers(["A"])).toEqual([[1, ["A"], false]]);
		});

		it("(j) S167 AC 3 untyped: a day stored without types (before S167) is regularSeason null, one null type per game", async () =>
		{
			expect(await answers([undefined, undefined])).toEqual([[2, [null, null], null]]);
		});

		it("(j) S167 AC 3 R and untyped: a day with an R game and an untyped one is regularSeason true", async () =>
		{
			expect(await answers(["R", undefined])).toEqual([[2, ["R", null], true]]);
		});

		it("(j) S167 AC 3 S and untyped: a day with an S game and an untyped one keeps both entries and is regularSeason null", async () =>
		{
			expect(await answers(["S", undefined])).toEqual([[2, ["S", null], null]]);
		});

		it("(j) S167 AC 3 non-string type: a stored gameType that isn't a string (82) counts as untyped, [null] and regularSeason null", async () =>
		{
			const repo = create();
			const day = await typed("2024-07-04", ["S"]);
			day.games = day.games.map((game) => ({
				...game,
				gameType: 82 as never,
			}));
			await repo.upsert(day);
			expect((await repo.listGameCounts("2024-07-04", "2024-07-04")).map((d) => [d.gameTypes, d.regularSeason])).toEqual([[[null], null]]);
		});

		// S191 AC 1: the teams of each day's regular-season games, from the same read. The fixture
		// day's games are 121 at 120 (the first) and 147 at 111 (the second).
		const regularTeams = async (types: (string | undefined)[]) =>
		{
			const repo = create();
			await repo.upsert(await typed("2024-07-04", types));
			return (await repo.listGameCounts("2024-07-04", "2024-07-04")).map((d) => [d.regularSeason, d.regularSeasonTeamIds]);
		};

		it("(j) S191 AC 1 regular only: a day of only regular-season games lists every team, once each, ascending", async () =>
		{
			expect(await regularTeams(["R", "R"])).toEqual([[true, [111, 120, 121, 147]]]);
		});

		it("(j) S191 AC 1 mixed: a spring-and-regular day lists only the regular-season game's teams", async () =>
		{
			expect(await regularTeams(["S", "R"])).toEqual([[true, [111, 147]]]);
			expect(await regularTeams(["R", "S"])).toEqual([[true, [120, 121]]]);
		});

		it("(j) S191 AC 1 untyped: an untyped day is null, as regularSeason is; a typed day without an R game is []", async () =>
		{
			expect(await regularTeams([undefined, undefined])).toEqual([[null, null]]);
			expect(await regularTeams(["S", undefined])).toEqual([[null, null]]);
			expect(await regularTeams(["S", "S"])).toEqual([[false, []]]);
		});
	});
}

/** A `game_states` row for the contract: final at `version`, its score naming the version so content differs. */
function gameStateRow(gamePk: number, version: number, fields: Partial<GameStateRow> = {}): GameStateRow
{
	return {
		gamePk,
		source: "schedule",
		feedTime: null,
		officialDate: "2024-07-04",
		startTime: "2024-07-04T23:05:00.000Z",
		state: {
			status: {
				abstractGameState: "Final",
				codedGameState: "F",
				detailedState: "Final",
			},
			linescore: null,
			live: null,
			version,
			lastChangedAt: `2024-07-05T00:00:0${version}.000Z`,
		},
		...fields,
	};
}

/**
 * Case (k): the game-state repository (S150 AC 3), for any `GameStateRepository` adapter: a batch is written in one
 * call, which returns the gamePks it took. A row is taken when its version is newer, or the same with an equal state
 * (all of it, `version` and `lastChangedAt` included) and a newer feed time, which moves only the feed time and the
 * source; the accepted feed time never moves back, and a write without a first pitch keeps the stored one.
 */
export function describeGameStateContract(label: string, create: () => GameStateRepository): void
{
	describe(`${label} — game state repository contract`, () =>
	{
		let repo: GameStateRepository;

		beforeEach(() =>
		{
			repo = create();
		});

		it("(k) game state: reads null for a missing game, and a written row deep-equals what was written", async () =>
		{
			expect(await repo.getByPk(1)).toBeNull();
			const row = gameStateRow(1, 1);
			expect(await repo.write([row])).toEqual([1]);
			const read = await repo.getByPk(1);
			expect(read).toEqual(row);
			expect(read).not.toBe(row);
			expect(await repo.getMany([1, 2])).toEqual([row]);
			expect(await repo.getMany([])).toEqual([]);
			expect(await repo.write([])).toEqual([]);
		});

		it("(k) game state: a batch is written in one call, which returns the gamePks it took", async () =>
		{
			await repo.write([gameStateRow(2, 2)]);
			const taken = await repo.write([gameStateRow(3, 1), gameStateRow(2, 1), gameStateRow(1, 1)]);
			expect([...taken].sort((a, b) => a - b)).toEqual([1, 3]);
			expect((await repo.getMany([1, 2, 3])).map((row) => [row.gamePk, row.state.version]).sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 1], [2, 2], [3, 1]]);
		});

		it("(k) game state: a newer version replaces the row; the same or an older one is refused", async () =>
		{
			await repo.write([gameStateRow(1, 2)]);
			expect(await repo.write([gameStateRow(1, 1)])).toEqual([]);
			expect(await repo.write([gameStateRow(1, 2, {
				officialDate: "2024-07-05",
			})])).toEqual([]);
			expect((await repo.getByPk(1))?.officialDate).toBe("2024-07-04");
			expect(await repo.write([gameStateRow(1, 3)])).toEqual([1]);
			expect((await repo.getByPk(1))?.state.version).toBe(3);
		});

		it("(k) game state: the same version with a newer feed time moves the time and marks the row feed; the time never moves back", async () =>
		{
			await repo.write([gameStateRow(1, 2, {
				source: "feed",
				feedTime: "2024-07-04T23:00:00.000Z",
			})]);
			expect(await repo.write([gameStateRow(1, 2, {
				source: "feed",
				feedTime: "2024-07-04T22:00:00.000Z",
			})])).toEqual([]);
			await repo.write([gameStateRow(1, 2, {
				source: "schedule",
			})]);
			expect((await repo.getByPk(1))?.feedTime).toBe("2024-07-04T23:00:00.000Z");
			expect(await repo.write([gameStateRow(1, 2, {
				source: "feed",
				feedTime: "2024-07-04T23:30:00.000Z",
			})])).toEqual([1]);
			expect((await repo.getByPk(1))).toMatchObject({
				source: "feed",
				feedTime: "2024-07-04T23:30:00.000Z",
			});
			// A newer schedule state keeps the accepted feed time.
			await repo.write([gameStateRow(1, 3)]);
			expect((await repo.getByPk(1))).toMatchObject({
				source: "schedule",
				feedTime: "2024-07-04T23:30:00.000Z",
			});
		});

		it("(k) game state: one version never holds two states: a same-version write with another state is refused, whatever its feed time (ADR-022)", async () =>
		{
			const first = gameStateRow(1, 6, {
				source: "feed",
				feedTime: "2024-07-04T23:00:00.000Z",
			});
			await repo.write([first]);
			// Another writer's v6, a run different, with a later feed time.
			const other = gameStateRow(1, 6, {
				source: "feed",
				feedTime: "2024-07-04T23:00:15.000Z",
			});
			other.state.linescore = {
				teams: {
					home: {
						runs: 9,
					},
				},
			} as NonNullable<GameStateRow["state"]["linescore"]>;
			expect(await repo.write([other])).toEqual([]);
			expect((await repo.getByPk(1))?.state).toEqual(first.state);
			expect((await repo.getByPk(1))?.feedTime).toBe("2024-07-04T23:00:00.000Z");
			// The same content but another change time is another state too.
			expect(await repo.write([gameStateRow(1, 6, {
				source: "feed",
				feedTime: "2024-07-04T23:00:30.000Z",
				state: {
					...first.state,
					lastChangedAt: "2024-07-05T01:00:00.000Z",
				},
			})])).toEqual([]);
			expect((await repo.getByPk(1))?.state).toEqual(first.state);
			// The very same state with a later feed time moves only the time; the state stays as it was.
			expect(await repo.write([gameStateRow(1, 6, {
				source: "feed",
				feedTime: "2024-07-04T23:00:45.000Z",
				officialDate: "2024-07-05",
			})])).toEqual([1]);
			expect(await repo.getByPk(1)).toEqual({
				...first,
				feedTime: "2024-07-04T23:00:45.000Z",
			});
		});

		it("(k) game state: a write without a first pitch never clears a stored one", async () =>
		{
			await repo.write([gameStateRow(1, 1)]);
			await repo.write([gameStateRow(1, 2, {
				startTime: null,
			})]);
			expect((await repo.getByPk(1))?.startTime).toBe("2024-07-04T23:05:00.000Z");
			await repo.write([gameStateRow(1, 3, {
				startTime: "2024-07-05T17:05:00.000Z",
			})]);
			expect((await repo.getByPk(1))?.startTime).toBe("2024-07-05T17:05:00.000Z");
		});
	});
}

/** A schedule store and the game-state store it reads, over one database. */
export type ServedBaseStores = {
	schedules: ScheduleRepository;
	gameStates: GameStateRepository;
};

/**
 * Case (l): a schedule day's `served_base` (S150 AC 6), for any `ScheduleRepository` adapter with the game-state store
 * of its database: a write that drops games raises it by their stored state versions, read by the adapter itself in
 * the same write; a write the version guard refuses raises nothing; a new day starts at 0. S216: the upsert reports
 * the base it left, or null when refused.
 */
export function describeServedBaseContract(label: string, create: () => ServedBaseStores): void
{
	describe(`${label} — served base contract`, () =>
	{
		/** A stored day at `version` listing `gamePks` (only what the raise reads of its games). */
		const day = (version: number, gamePks: number[]) => ({
			date: "2024-07-04",
			games: gamePks.map((gamePk) => ({
				gamePk,
			})),
			fetchedAt: "2024-07-05T00:00:00.000Z",
			windowMode: "cache",
			version,
			lastChangedAt: `2024-07-05T00:00:0${version}.000Z`,
		}) as unknown as StoredScheduleDay;

		it("(l) served base: a write that drops games raises it by their state versions; a refused write raises nothing", async () =>
		{
			const { schedules, gameStates } = create();
			await gameStates.write([gameStateRow(1, 5), gameStateRow(2, 2)]);
			const base = async () => (await schedules.getWithServedBase("2024-07-04"))?.servedBase;
			await schedules.upsert(day(1, [1, 2]));
			expect(await base()).toBe(0);
			// Game 1 (state v5) dropped.
			await schedules.upsert(day(2, [2]));
			expect(await base()).toBe(5);
			// The same version again, dropping game 2: refused, nothing raised.
			await schedules.upsert(day(2, []));
			expect(await base()).toBe(5);
			expect((await schedules.getByDate("2024-07-04"))?.games.map((game) => game.gamePk)).toEqual([2]);
			// Game 2 (state v2) dropped.
			await schedules.upsert(day(3, []));
			expect(await base()).toBe(7);
		});

		it("(l) served base: the raise reads each dropped game's state version as stored when the day is written", async () =>
		{
			const { schedules, gameStates } = create();
			await gameStates.write([gameStateRow(1, 1)]);
			await schedules.upsert(day(1, [1, 3]));
			// The game's state moves on between a refresh's reads and its write; game 3 has no row.
			await gameStates.write([gameStateRow(1, 4)]);
			await schedules.upsert(day(2, []));
			expect((await schedules.getWithServedBase("2024-07-04"))?.servedBase).toBe(4);
		});

		it("S216 AC 1 schedules upsert reports its served base: the base it left on a write (raised or not), null when refused", async () =>
		{
			const { schedules, gameStates } = create();
			await gameStates.write([gameStateRow(1, 5), gameStateRow(2, 2)]);
			expect(await schedules.upsert(day(1, [1, 2]))).toBe(0);
			// Game 1 (state v5) dropped: the write reports the raised base, which a fresh read returns too.
			expect(await schedules.upsert(day(2, [2]))).toBe(5);
			expect((await schedules.getWithServedBase("2024-07-04"))?.servedBase).toBe(5);
			// The same version again: refused, reported as null, nothing raised.
			expect(await schedules.upsert(day(2, []))).toBeNull();
			expect(await schedules.upsert(day(1, []))).toBeNull();
			expect(await schedules.upsert(day(3, [2]))).toBe(5);
		});

		it("S212 review listing dates: every listing of the games asked for by a stored day of the range, in date then gamePk order", async () =>
		{
			const { schedules } = create();
			const on = (date: string, gamePks: number[]) => ({
				...day(1, gamePks),
				date,
			});
			await schedules.upsert(on("2024-07-06", [7, 8]));
			await schedules.upsert(on("2024-07-04", [7]));
			await schedules.upsert(on("2024-07-05", [8]));
			await schedules.upsert(on("2025-04-01", [7]));
			expect(await schedules.listGameListings([8, 7], "2024-01-01", "2024-12-31")).toEqual([{
				date: "2024-07-04",
				gamePk: 7,
			}, {
				date: "2024-07-05",
				gamePk: 8,
			}, {
				date: "2024-07-06",
				gamePk: 7,
			}, {
				date: "2024-07-06",
				gamePk: 8,
			}]);
			expect(await schedules.listGameListings([9], "2024-01-01", "2024-12-31")).toEqual([]);
			expect(await schedules.listGameListings([], "2024-01-01", "2024-12-31")).toEqual([]);
		});
	});
}

/** The stores S216's batched contract writes to: one database's games and projections. */
export type BatchedWriteStores = {
	games: GameRepository;
	projections: GameProjectionRepository;
};

/**
 * S216 AC 2: a game repository's batched read (`getMany`) and the games' and projections' multi-row upserts
 * (`upsertMany`), for any adapter: a read of 0, 1 or 15 keys returns the stored ones and leaves the missing out; a
 * multi-row upsert writes each row only when its version is newer and reports which it took, so a refused row is left
 * out per key, as one row's upsert (case f) refuses it.
 */
export function describeBatchedWritesContract(label: string, create: () => BatchedWriteStores, make: (gamePk: number, version: number) => Promise<GameSnapshot>): void
{
	describe(`${label} — batched writes contract`, () =>
	{
		const keys = Array.from({
			length: 15,
		}, (_, i) => 800_001 + i);

		it("S216 AC 2 games getMany 0, 1 and 15 keys: the stored ones, missing keys left out", async () =>
		{
			const { games } = create();
			for (const gamePk of keys.slice(0, 14)) await games.upsert(await make(gamePk, 1));
			expect(await games.getMany([])).toEqual([]);
			expect((await games.getMany([keys[0]!])).map((game) => game.gamePk)).toEqual([keys[0]]);
			const many = await games.getMany(keys);
			expect(many.map((game) => game.gamePk).sort((a, b) => a - b)).toEqual(keys.slice(0, 14));
			const made = await make(keys[3]!, 1);
			const found = many.find((game) => game.gamePk === keys[3]);
			expect([found?.version, found?.status, found?.plays.length]).toEqual([made.version, made.status, made.plays.length]);
			expect(await games.getMany([1, 2])).toEqual([]);
		});

		it("S216 AC 2 games upsertMany reports refusals: rows newer than the stored are taken, the rest refused per key", async () =>
		{
			const { games } = create();
			const [a, b, c] = keys;
			await games.upsert(await make(a!, 2));
			await games.upsert(await make(b!, 1));
			const taken = await games.upsertMany([await make(a!, 2), await make(b!, 3), await make(c!, 1)]);
			expect([...taken].sort((x, y) => x - y)).toEqual([b, c]);
			expect((await games.getByPk(a!))?.version).toBe(2);
			expect((await games.getByPk(b!))?.version).toBe(3);
			expect((await games.getByPk(c!))?.version).toBe(1);
			expect(await games.upsertMany([await make(a!, 1)])).toEqual([]);
			expect(await games.upsertMany([])).toEqual([]);
			// One gamePk twice: its newest version is written.
			expect(await games.upsertMany([await make(a!, 4), await make(a!, 5)])).toEqual([a]);
			expect((await games.getByPk(a!))?.version).toBe(5);
		});

		it("S216 AC 2 projections upsertMany reports refusals: rows newer than the stored are taken, the rest refused per key", async () =>
		{
			const { projections } = create();
			const [a, b] = keys;
			await projections.upsert(projectGame(await make(a!, 3)));
			const taken = await projections.upsertMany([projectGame(await make(a!, 2)), projectGame(await make(b!, 1))]);
			expect(taken).toEqual([b]);
			expect((await projections.getByPk(a!))?.header.version).toBe(3);
			expect((await projections.getByPk(b!))?.header.version).toBe(1);
			expect(await projections.upsertMany([])).toEqual([]);
		});
	});
}

/**
 * Case (m): a game repository's state fields (S150 AC 6, `getStateFields`), for any `GameRepository` adapter: what
 * `gameStateFromGame` reads of each stored game asked for (status, linescore, live moment, last at-bat's matchup), and
 * nothing for a game not stored.
 */
export function describeGameStateFieldsContract(label: string, create: () => GameRepository, make: (gamePk: number) => Promise<GameSnapshot>): void
{
	describe(`${label} — game state fields contract`, () =>
	{
		it("(m) state fields: each stored game asked for, its status, linescore, live moment and last at-bat's matchup; nothing for one not stored", async () =>
		{
			const repo = create();
			const live = {
				...await make(11),
				live: {
					runners: {
						first: 1,
						second: null,
						third: null,
					},
					batterId: 2,
					pitcherId: 3,
				},
			} as GameSnapshot;
			const bare = {
				...await make(12),
				linescore: null,
				live: null,
				plays: [],
			} as GameSnapshot;
			await repo.upsert(live);
			await repo.upsert(bare);
			const fields = [...await repo.getStateFields([12, 11, 99])].sort((a, b) => a.gamePk - b.gamePk);
			expect(fields).toEqual([{
				gamePk: 11,
				status: live.status,
				linescore: live.linescore,
				live: live.live,
				plays: [{
					matchup: live.plays.at(-1)!.matchup,
				}],
			}, {
				gamePk: 12,
				status: bare.status,
				linescore: null,
				live: null,
				plays: [],
			}]);
			expect(await repo.getStateFields([])).toEqual([]);
		});
	});
}

/** A game store and the game-state store of its database, as the re-check read joins them (S212 AC 5). */
export type GameRecheckStores = {
	games: GameRepository;
	gameStates: GameStateRepository;
};

/**
 * Case (n): the recent-game re-check record (S212 AC 5), for any `GameRepository` adapter with the game-state store of
 * its database: the one read lists each stored game of the dates with its `windowMode`, its served status (its row's,
 * else its snapshot's) and its record; a claim holds for the lease and refuses a game re-checked under 6 h ago; a
 * recorded check only moves forward.
 */
export function describeGameRecheckContract(label: string, create: () => GameRecheckStores, make: (gamePk: number, date: string) => Promise<GameSnapshot>): void
{
	describe(`${label} — game re-check contract`, () =>
	{
		const T = "2024-07-10T12:00:00.000Z";
		const later = (ms: number) => new Date(Date.parse(T) + ms).toISOString();

		it("S212 AC 5 recheck candidates: each stored game of the dates, its windowMode, first pitch and suspension, its served status and its record", async () =>
		{
			const { games, gameStates } = create();
			await games.upsert({
				...await make(3, "2024-07-04"),
				windowMode: "cache",
			});
			await games.upsert({
				...await make(1, "2024-07-05"),
				windowMode: "active",
			});
			await games.upsert(await make(2, "2024-07-09"));
			await gameStates.write([gameStateRow(1, 2, {
				officialDate: "2024-07-05",
				state: {
					...gameStateRow(1, 2).state,
					status: {
						abstractGameState: "Live",
						codedGameState: "U",
						detailedState: "Suspended: Rain",
					},
				},
			})]);
			await games.recordGameRecheck(3, T);
			const listed = await games.listRecheckCandidates("2024-07-04", "2024-07-05");
			expect(listed).toEqual([{
				gamePk: 1,
				officialDate: "2024-07-05",
				windowMode: "active",
				startTime: (await make(1, "2024-07-05")).startTime ?? null,
				suspendedAt: null,
				status: {
					codedGameState: "U",
					detailedState: "Suspended: Rain",
				},
				checkedAt: null,
				claimedAt: null,
			}, {
				gamePk: 3,
				officialDate: "2024-07-04",
				windowMode: "cache",
				startTime: (await make(3, "2024-07-04")).startTime ?? null,
				suspendedAt: null,
				status: {
					codedGameState: (await make(3, "2024-07-04")).status.codedGameState,
					detailedState: (await make(3, "2024-07-04")).status.detailedState,
				},
				checkedAt: T,
				claimedAt: null,
			}]);
			expect(await games.listRecheckCandidates("2024-08-01", "2024-08-07")).toEqual([]);
		});

		it("S212 AC 5 recheck claim: held for the lease, refused under 6 h after a check, and a check only moves forward", async () =>
		{
			const { games } = create();
			expect(await games.claimGameRecheck(7, T)).toBe(true);
			expect(await games.claimGameRecheck(7, later(GAME_RECHECK_CLAIM_LEASE_MS - 1))).toBe(false);
			expect(await games.claimGameRecheck(7, later(GAME_RECHECK_CLAIM_LEASE_MS))).toBe(true);
			await games.recordGameRecheck(7, later(GAME_RECHECK_CLAIM_LEASE_MS));
			await games.recordGameRecheck(7, T);
			const after = later(GAME_RECHECK_CLAIM_LEASE_MS);
			expect(await games.claimGameRecheck(7, new Date(Date.parse(after) + SCHEDULE_MONTH_REFRESH_INTERVAL_MS - 1).toISOString())).toBe(false);
			expect(await games.claimGameRecheck(7, new Date(Date.parse(after) + SCHEDULE_MONTH_REFRESH_INTERVAL_MS).toISOString())).toBe(true);
		});

		it("S212 review recheck hold: a hold moves the claim forward only, and a claim is refused until the hold plus the lease", async () =>
		{
			const { games } = create();
			expect(await games.claimGameRecheck(8, T)).toBe(true);
			const until = later(SCHEDULE_MONTH_REFRESH_INTERVAL_MS - GAME_RECHECK_CLAIM_LEASE_MS);
			await games.holdGameRecheck(8, until);
			await games.holdGameRecheck(8, T);
			expect(await games.claimGameRecheck(8, later(SCHEDULE_MONTH_REFRESH_INTERVAL_MS - 1))).toBe(false);
			expect(await games.claimGameRecheck(8, later(SCHEDULE_MONTH_REFRESH_INTERVAL_MS))).toBe(true);
			// A game never claimed is held too.
			await games.holdGameRecheck(9, until);
			expect(await games.claimGameRecheck(9, later(SCHEDULE_MONTH_REFRESH_INTERVAL_MS - 1))).toBe(false);
		});
	});
}

/**
 * Case (o): the purges BT still owes the edge (S212 review), for any `OwedEdgePurgeRepository` adapter: listed oldest
 * owed first up to the limit and only once their retry time has come; a settle or a deferral touches a row only while it
 * is at its listed version, so a URL owed again after the listing stays owed.
 */
export function describeOwedEdgePurgeContract(label: string, create: () => OwedEdgePurgeRepository): void
{
	describe(`${label} — owed edge purge contract`, () =>
	{
		const T = "2024-07-10T12:00:00.000Z";
		const later = (ms: number) => new Date(Date.parse(T) + ms).toISOString();

		const urlsAndFailures = (purges: readonly OwedEdgePurge[]) => purges.map((purge) => [purge.url, purge.owedAt, purge.failures]);

		it("S212 review owed list: oldest owed first, up to the limit, each owe with a version of its own", async () =>
		{
			const owed = create();
			await owed.owe(["https://a/2", "https://a/1"], later(1000));
			await owed.owe(["https://a/0"], T);
			const first = (await owed.listDue(later(5000), 10)).find((purge) => purge.url === "https://a/1")!;
			await owed.owe(["https://a/1"], later(2000));
			const due = await owed.listDue(later(5000), 2);
			expect(urlsAndFailures(due)).toEqual([["https://a/0", T, 0], ["https://a/2", later(1000), 0]]);
			const all = await owed.listDue(later(5000), 10);
			expect(urlsAndFailures(all)).toEqual([["https://a/0", T, 0], ["https://a/2", later(1000), 0], ["https://a/1", later(2000), 0]]);
			expect(new Set(all.map((purge) => purge.version)).size).toBe(3);
			expect(all[2]!.version).not.toBe(first.version);
		});

		it("S212 review owed settle: settling a listing drops only the rows still at their listed version", async () =>
		{
			const owed = create();
			await owed.owe(["https://a/x", "https://a/y"], T);
			const listed = await owed.listDue(T, 10);
			// A write fails to purge x again after the listing.
			await owed.owe(["https://a/x"], later(1000));
			await owed.settle(listed);
			expect(urlsAndFailures(await owed.listDue(later(1000), 10))).toEqual([["https://a/x", later(1000), 0]]);
		});

		it("S212 review owed race: two ticks list the same owe, one settles, a write owes the URL again, the other's settle leaves it owed", async () =>
		{
			const owed = create();
			await owed.owe(["https://a/x"], T);
			const tickA = await owed.listDue(T, 10);
			const tickB = await owed.listDue(T, 10);
			await owed.settle(tickA);
			await owed.owe(["https://a/x"], later(1000));
			await owed.settle(tickB);
			await owed.defer(tickB, later(60_000));
			expect(urlsAndFailures(await owed.listDue(later(1000), 10))).toEqual([["https://a/x", later(1000), 0]]);
		});

		it("S212 review owed defer: a deferred row counts the failure and is not listed before its retry time; a re-owe clears both", async () =>
		{
			const owed = create();
			await owed.owe(["https://a/x"], T);
			const listed = await owed.listDue(T, 10);
			await owed.defer(listed, later(60_000));
			expect(await owed.listDue(later(59_999), 10)).toEqual([]);
			expect(await owed.listDue(later(60_000), 10)).toEqual([{
				...listed[0]!,
				failures: 1,
			}]);
			// A deferral of another version changes nothing.
			await owed.defer([{
				url: "https://a/x",
				version: listed[0]!.version + 1000,
			}], later(120_000));
			expect((await owed.listDue(later(60_000), 10))[0]?.failures).toBe(1);
			await owed.owe(["https://a/x"], later(1000));
			expect(urlsAndFailures(await owed.listDue(later(1000), 10))).toEqual([["https://a/x", later(1000), 0]]);
		});
	});
}
