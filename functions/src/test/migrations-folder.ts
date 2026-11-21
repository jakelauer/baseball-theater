/**
 * Test-only copies of the committed migrations folder with extra migrations after them, as a checkout
 * ahead of a database would hold. Shared by the baseball-data copy's tests (S117) and the migrate
 * step's drift checks (#48), which both need a database to differ from a folder in a known way.
 */
import {
	cpSync, mkdtempSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../adapters/postgres/migrate.js";

/** The committed migration's `when`, so a test's own migrations sort before or after it as needed. */
export const FIRST_WHEN = (JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: { when: number }[] }).entries.at(-1)!.when;

/** A copy of the committed migrations folder with `extra` migrations after them, as a checkout ahead of production would hold. */
export function migrationsWith(extra: { tag: string;
	sql: string;
	when: number; }[]): string
{
	const folder = mkdtempSync(join(tmpdir(), "bt-migrations-"));
	cpSync(MIGRATIONS_FOLDER, folder, {
		recursive: true,
	});
	const journalPath = join(folder, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Record<string, unknown>[] };
	for (const migration of extra)
	{
		writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql);
		journal.entries.push({
			idx: journal.entries.length,
			version: "7",
			when: migration.when,
			tag: migration.tag,
			breakpoints: true,
		});
	}
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}
