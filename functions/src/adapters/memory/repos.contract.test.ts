/**
 * Every in-memory repository against the shared storage contract (S46, `storage-contract.ts`),
 * seeded from the committed fixtures, plus the registry's deletion case for the stores only
 * the in-memory doubles back here: data downloads (R2 in production) and the mailer.
 */
import { downloadExpiresAt } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import {
	DOWNLOADS_STORE, MAIL_STORE, personalDataStores,
} from "../../services/personal-data.js";
import {
	describeGameRecheckContract, describeGameStateContract, describeOwedEdgePurgeContract, describePersonalDataStoreContract, describePlayerIdContract, describeServedBaseContract,
} from "../repository-contract.js";
import { contractGame, describeStorageContract } from "../storage-contract.js";
import {
	InMemoryExportStore,
	InMemoryGameProjectionRepository,
	InMemoryOwedEdgePurgeRepository,
	InMemoryGameRepository,
	InMemoryGameStateRepository,
	InMemoryMailer,
	InMemoryPlayerIdRepository,
	InMemoryReplayArtifactRepository,
	InMemorySettingsRepository,
	InMemoryUserRepository,
	memoryScheduleStores,
} from "./repos.js";

describeStorageContract("InMemory", {
	schedules: () => memoryScheduleStores().schedules,
	games: () => new InMemoryGameRepository(),
	projections: () => new InMemoryGameProjectionRepository(),
	replays: () => new InMemoryReplayArtifactRepository(),
	users: () => new InMemoryUserRepository(),
	settings: () => new InMemorySettingsRepository(),
});

describeGameStateContract("InMemoryGameStateRepository", () => new InMemoryGameStateRepository());

describeServedBaseContract("InMemoryScheduleRepository", memoryScheduleStores);

describeGameRecheckContract("InMemoryGameRepository", () =>
{
	const gameStates = new InMemoryGameStateRepository();
	return {
		games: new InMemoryGameRepository(gameStates),
		gameStates,
	};
}, contractGame);

describeOwedEdgePurgeContract("InMemoryOwedEdgePurgeRepository", () => new InMemoryOwedEdgePurgeRepository());
describePlayerIdContract("InMemoryPlayerIdRepository", () => new InMemoryPlayerIdRepository());

type RegistryDeps = {
	users: InMemoryUserRepository;
	settings: InMemorySettingsRepository;
	downloads: InMemoryExportStore;
	mailer: InMemoryMailer;
};

/** Every registered store runs the shared deletion case (i), through the registry itself. */
function registeredStore(name: string, write: (deps: RegistryDeps, uid: string) => Promise<void>)
{
	return () =>
	{
		const deps: RegistryDeps = {
			users: new InMemoryUserRepository(),
			settings: new InMemorySettingsRepository(),
			downloads: new InMemoryExportStore(),
			mailer: new InMemoryMailer(),
		};
		const store = personalDataStores(deps).find((s) => s.name === name)!;
		return {
			store,
			write: (uid: string) => write(deps, uid),
		};
	};
}

describePersonalDataStoreContract(DOWNLOADS_STORE, {
	create: registeredStore(DOWNLOADS_STORE, (deps, uid) => deps.downloads.put({
		id: `download-${uid}`,
		uid,
		createdAt: "2026-10-27T12:00:00.000Z",
		expiresAt: downloadExpiresAt(new Date("2026-10-27T12:00:00.000Z")),
	}, {
		stores: {},
	})),
});

describePersonalDataStoreContract(MAIL_STORE, {
	create: registeredStore(MAIL_STORE, (deps, uid) => deps.mailer.send({
		uid,
		to: `${uid}@example.test`,
		subject: "Your Baseball Theater data download is ready",
		text: "Sign in and open Settings.",
	})),
});

describe("InMemoryScheduleRepository.clear (S194)", () =>
{
	it("drops the month records with the days, so a cleared double starts with no checks or claims", async () =>
	{
		const repo = memoryScheduleStores().schedules;
		await repo.recordScheduleMonthCheck("2026-04", "2026-04-10T12:00:00.000Z");
		await repo.claimScheduleMonth("2026-05", "2026-04-10T12:00:00.000Z");
		repo.clear();
		expect(await repo.listScheduleMonthChecks("2026-01", "2026-12")).toEqual([]);
	});
});
