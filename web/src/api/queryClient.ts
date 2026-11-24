/**
 * The app's single `QueryClient` (ADR-014). Defaults stay deliberately thin:
 * per-resource timing is declared by `freshnessPolicy` in each descriptor, not
 * here, so one global number can never quietly override a resource's policy.
 */
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient
{
	return new QueryClient({
		defaultOptions: {
			queries: {
				// A payload that failed once offline is unlikely to succeed on a retry
				// burst; readers show the error instead of spinning.
				retry: false,
				refetchOnWindowFocus: true,
				// Offline reading (S74, ADR-023): a request is still sent while the browser says it is
				// offline, so the service worker can answer it from its stored copy; TanStack's default
				// ("online") would hold it paused and never reach the worker. The calendar's months opt back
				// into "online" (S194, `scheduleMonthQueryOptions`): offline they pause and show bare numbers.
				networkMode: "offlineFirst",
			},
		},
	});
}
