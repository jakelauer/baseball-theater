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
 * case (h) is its deletion (ADR-028): `deleteFor` reaches profile and links.
 * Case (i) is the same deletion for any registered `PersonalDataStore` (S6),
 * so each new store (settings now, S50's Postgres stores) runs one shared case.
 * Case (j) is the schedule repository's month read (S124, `listGameCounts`).
 */
import {
	beforeEach, describe, expect, it,
} from "vitest";
import type { ScheduleDay, UserProfile } from "@bt/domain";
import { entitlementsForTier } from "@bt/domain";
import type {
	PersonalDataStore, ScheduleRepository, UserRepository,
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

/** The identity-link part of the contract, for any `UserRepository` adapter. */
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
			const kept = await repo.exportFor("uid-2");

			await repo.deleteFor("uid-1");
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
					fetchedAt: days[2]!.fetchedAt,
					lastChangedAt: days[2]!.lastChangedAt,
				},
				{
					date: "2024-07-06",
					gameCount: 0,
					teamIds: [],
					gameTypes: [],
					regularSeason: false,
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
	});
}
