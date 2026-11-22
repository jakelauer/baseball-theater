import type { SeasonPhaseName } from "@bt/domain";

/** Each Standings view's name, on its tab in the switch and in the browser tab's title (standings-search-settings A9). */
export const VIEW_LABELS: Record<SeasonPhaseName, string> = {
	spring: "Spring training",
	regularSeason: "Regular season",
	playoffs: "Playoffs",
};
