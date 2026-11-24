#!/usr/bin/env node
// Lays out a story's design-match pairs for the owner (rule 22; owner, 2026-10-30): each
// capture in docs/v3/design-checks/<ID>/ beside the ratified frame of the same name (or the
// frames its frames.json entry names), one PNG per capture, in the git-ignored .designreview/<ID>/. Delete the folder once the owner
// has given the verdict.
//
//   pnpm design:review S68          # build .designreview/S68/
//   pnpm design:review S68 --done   # delete it after the verdict
//
// Which references each capture is judged against comes from
// scripts/backlog-vault/design-reference.ts (reviewPairing, i.e. captureReferences), the same code
// `scripts/audit.sh --design-match` uses, so the folder shows exactly the pairs the ledger records:
// an amendment frame over the original, a written amendment over any frame it overrides (its text
// then goes on the reference side), or every frame the story's
// docs/v3/design-checks/<ID>/frames.json names for the capture (owner, 2026-11-24: "Change the tool
// (Recommended)"). A capture audit.sh would refuse (a bad map entry, or a name matching no frame or
// several) is shown with that refusal instead, and the run exits 1.
// The pairs are drawn by Playwright's Chromium (already installed for `pnpm design:capture`), so no
// image library is needed.
import {
	existsSync, mkdirSync, readdirSync, readFileSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { reviewPairing } from "../scripts/backlog-vault/design-reference.ts";

const [id, flag] = process.argv.slice(2);
if (!id || !/^[SV]\d+$/i.test(id))
{
	console.error("usage: pnpm design:review <story ID> [--done]  (docs/v3/design-checks/<ID>/frames.json may name a capture's ratified frames)");
	process.exit(2);
}
const story = id.toUpperCase();
const out = join(".designreview", story);

if (flag === "--done")
{
	rmSync(out, {
		recursive: true,
		force: true,
	});
	console.log(`removed ${out}`);
	process.exit(0);
}

const checks = join("docs/v3/design-checks", story);
if (!existsSync(checks))
{
	console.error(`${checks} does not exist; run pnpm design:capture ${story} first`);
	process.exit(1);
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dataUrl = (path: string): string => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
const panel = (label: string, path: string): string => `<figure><figcaption>${label}<small>${path}</small></figcaption><img src="${dataUrl(path)}"></figure>`;

rmSync(out, {
	recursive: true,
	force: true,
});
mkdirSync(out, {
	recursive: true,
});
const browser = await chromium.launch();
const page = await browser.newPage();
const captures = readdirSync(checks).filter((f) => f.endsWith(".png")).sort();
for (const name of captures)
{
	const { references, error } = reviewPairing("docs/v3/visual", checks, name);
	if (error)
	{
		console.error(`${name}: ${error}`);
		process.exitCode = 1;
	}
	const reference = error
		? `<figure class="written"><figcaption>No pair audit.sh would record</figcaption><pre>${escapeHtml(error)}</pre></figure>`
		: references.map((ref) => (ref.kind === "amendment"
			? `<figure class="written"><figcaption>Ratified written amendment (no frame; it supersedes any older frame named ${name})<small>${ref.path}</small></figcaption><pre>${escapeHtml(readFileSync(ref.path, "utf8"))}</pre></figure>`
			: panel("Ratified frame", ref.path))).join("");
	await page.setContent(`<!doctype html><style>
		body { margin: 0; background: #282828; color: #fff2d3; font: 20px Helvetica, Arial, sans-serif; }
		main { display: inline-flex; gap: 24px; padding: 16px 24px 24px; align-items: flex-start; }
		figure { margin: 0; }
		figcaption { margin-bottom: 12px; }
		small { display: block; font-size: 12px; opacity: 0.7; }
		img { display: block; }
		.written pre { width: 560px; margin: 0; white-space: pre-wrap; font: 14px/1.45 Helvetica, Arial, sans-serif; }
	</style><main>${reference}${panel(`${story} build`, join(checks, name))}</main>`);
	await page.locator("main").screenshot({
		path: join(out, name),
	});
	console.log(`${join(out, name)}${error ? "  (refused; see above)" : `  (${references.map((ref) => ref.path).join(", ")})`}`);
}
await browser.close();
