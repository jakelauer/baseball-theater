/**
 * Runs `work` over `items`, `limit` at a time, keeping their order: the dev seed's recording of
 * games (S112) and the MLB client's week-long schedule requests (#399), each of which must not
 * have more in flight than its limit. One `work` rejecting rejects the whole run at once; the
 * other runners still carry on through the items left, within the limit, and their results are dropped.
 */
export async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]>
{
	const results: R[] = new Array<R>(items.length);
	let next = 0;
	const runners = Array.from({
		length: Math.min(limit, items.length),
	}, async () =>
	{
		while (next < items.length)
		{
			const index = next++;
			results[index] = await work(items[index]!);
		}
	});
	await Promise.all(runners);
	return results;
}
