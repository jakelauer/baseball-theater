import type { EdgeCachePurger } from "@bt/ports";

/** The test double of `EdgeCachePurger` (S212 AC 4): records each list of URLs it was asked to purge, in order. */
export class MemoryEdgeCachePurger implements EdgeCachePurger
{
	/** Every call's URLs, in call order. */
	readonly calls: string[][] = [];

	async purge(urls: readonly string[]): Promise<void>
	{
		this.calls.push([...urls]);
	}

	/** Every URL asked for so far, flattened. */
	get purged(): string[]
	{
		return this.calls.flat();
	}
}
