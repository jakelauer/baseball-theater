/**
 * What one hub knows (S18; ADR-022): the latest whole state it has passed on. Shared by the
 * `game-hub` Durable Object, the in-memory `LiveGameHub` and, since S149, the `day-hub`
 * Durable Object, whose state is a served schedule day: all apply the same rules — only a
 * newer version goes out (`applyIfNewer`), and a viewer connecting behind gets the full
 * current state. `T` is the pushed state (a game by default); it only needs a `version`.
 *
 * A hub that has just started (or woke from hibernation, which drops memory) knows
 * nothing, so its first question loads the latest stored state through the repository
 * port: a viewer who connects then still gets the game (or the day).
 */
import type { GameSnapshot, Versioned } from "@bt/domain";
import { applyIfNewer } from "@bt/domain";

export class LiveHubState<T extends Versioned = GameSnapshot>
{
	private latest: T | null = null;
	private loaded = false;

	constructor(private readonly load: () => Promise<T | null>) {}

	private async current(): Promise<T | null>
	{
		if (!this.loaded)
		{
			this.latest = this.latest ?? await this.load();
			this.loaded = true;
		}
		return this.latest;
	}

	/** Takes a published state; true when it is newer than anything before, so viewers should get it. */
	async accept(state: T): Promise<boolean>
	{
		const before = await this.current();
		this.latest = applyIfNewer(before, state);
		return this.latest !== before;
	}

	/** What a viewer who has `since` (or nothing) gets on connect: the current state if it is newer, else nothing. */
	async onConnect(since?: number): Promise<T | null>
	{
		const latest = await this.current();
		return latest && (since === undefined || latest.version > since) ? latest : null;
	}
}

/** The one message a viewer receives: the whole state (a game, or a day), which carries its `version`. */
export function liveMessage(state: Versioned): string
{
	return JSON.stringify(state);
}
