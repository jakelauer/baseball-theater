/**
 * A stand-in for GitHub's REST API behind a {@link GhRunner}, for the S164 tests (github.test.ts,
 * migrate.test.ts, audit-edit.test.ts): it answers the `gh api -i` calls github.ts makes from an
 * in-memory set of issues, comments and milestones, so no test reaches GitHub. Test-only; nothing
 * outside tests imports it.
 */

import type { CachedIssue, GhRunner } from "./github.ts";

/** One stored issue, with its comments, and whether it was deleted or transferred away. */
export interface FakeIssue extends CachedIssue
{
	comments: { body: string;
		user: { login: string } }[];
	gone?: "deleted" | "transferred";
	/** Its timeline, oldest first (S165's live check reads the newest `closed` entry and merged pull requests' cross-references). */
	events?: Record<string, unknown>[];
}

/** A call the fake saw: method, path and its `-f`/`-F` fields. */
export interface FakeCall
{
	method: string;
	path: string;
	fields: [string, string][];
}

/** A hook that may answer a call itself (a rate limit, a lost response), returning raw `gh api -i` output. */
export type Intercept = (call: FakeCall, fake: FakeGithub) => string | undefined;

/** The fake. `owner` is the repository's owner; `viewer` the token's login. */
export class FakeGithub
{
	issues = new Map<number, FakeIssue>();
	calls: FakeCall[] = [];
	milestones = [{
		number: 3,
		title: "v3.1.0",
	}];
	/** The releases `GET …/releases` lists (S165's areas). */
	releases: { tag_name: string;
		draft: boolean;
		published_at: string | null }[] = [];
	pageSize = 100;
	tick = 0;
	intercept: Intercept | undefined;
	readonly owner: string;
	readonly viewer: string;
	readonly repo: string;
	constructor(owner = "owner", viewer = "owner", repo = "owner/bt")
	{
		this.owner = owner;
		this.viewer = viewer;
		this.repo = repo;
	}

	/** The next timestamp: every change moves the clock one second on. */
	now(): string
	{
		this.tick++;
		return new Date(Date.UTC(2026, 10, 21, 0, 0, this.tick)).toISOString();
	}

	/** Adds an issue as someone filed it. */
	add(issue: Partial<FakeIssue> & { title: string }): FakeIssue
	{
		const number = issue.number ?? Math.max(0, ...this.issues.keys()) + 1;
		const stored: FakeIssue = {
			state: "open",
			state_reason: null,
			labels: [],
			user: {
				login: this.owner,
			},
			body: "",
			milestone: null,
			comments: [],
			...issue,
			number,
			updated_at: issue.updated_at ?? this.now(),
		};
		this.issues.set(number, stored);
		return stored;
	}

	/** The issue as the API returns it (comments and the fake's own flags left out). */
	view(issue: FakeIssue): Record<string, unknown>
	{
		const {
			comments: _comments, gone: _gone, events: _events, ...rest
		} = issue;
		return rest;
	}

	/** The runner github.ts calls. */
	run: GhRunner = (args) => this.handle(args);

	private handle(args: string[]): string
	{
		const rest = args.slice(2);
		let method = "GET";
		if (rest[0] === "-X")
		{
			method = rest[1]!;
			rest.splice(0, 2);
		}
		const path = rest.shift()!;
		const fields: [string, string][] = [];
		for (let k = 0; k < rest.length; k += 2)
		{
			const [name, ...value] = rest[k + 1]!.split("=");
			fields.push([name!, value.join("=")]);
		}
		const call = {
			method,
			path,
			fields,
		};
		this.calls.push(call);
		const answer = this.intercept?.(call, this);
		return answer ?? this.answer(call);
	}

	/** A raw `gh api -i` response. */
	static respond(status: number, body: unknown, headers: string[] = []): string
	{
		return [`HTTP/2.0 ${status} X`, "date: Sat, 21 Nov 2026 00:00:00 GMT", ...headers, "", JSON.stringify(body)].join("\n");
	}

	private answer({
		method, path, fields,
	}: FakeCall): string
	{
		const r = FakeGithub.respond;
		const prefix = "repos/{owner}/{repo}";
		if (path === prefix)
		{
			return r(200, {
				full_name: this.repo,
				owner: {
					login: this.owner,
				},
			});
		}
		if (path === "user")
		{
			return r(200, {
				login: this.viewer,
			});
		}
		if (path.startsWith(`${prefix}/milestones`))
		{
			return r(200, this.milestones);
		}
		const list = /^repos\/\{owner\}\/\{repo\}\/issues\?state=all&since=([^&]+)&per_page=100(?:&page=(\d+))?$/.exec(path);
		if (list && method === "GET")
		{
			const since = decodeURIComponent(list[1]!);
			const page = Number(list[2] ?? 1);
			const all = [...this.issues.values()].filter((i) => !i.gone && (i.updated_at ?? "") >= since).sort((a, b) => a.number - b.number);
			const slice = all.slice((page - 1) * this.pageSize, page * this.pageSize);
			const more = all.length > page * this.pageSize;
			return r(200, slice.map((i) => this.view(i)), more ? [`link: <repos/{owner}/{repo}/issues?state=all&since=${list[1]}&per_page=100&page=${page + 1}>; rel="next"`] : []);
		}
		// S166: the open listing an incremental sync checks its cached open issues against.
		const open = /^repos\/\{owner\}\/\{repo\}\/issues\?state=open&per_page=100(?:&page=(\d+))?$/.exec(path);
		if (open && method === "GET")
		{
			const page = Number(open[1] ?? 1);
			const all = [...this.issues.values()].filter((i) => !i.gone && i.state === "open").sort((a, b) => a.number - b.number);
			const more = all.length > page * this.pageSize;
			return r(200, all.slice((page - 1) * this.pageSize, page * this.pageSize).map((i) => this.view(i)),
				more ? [`link: <repos/{owner}/{repo}/issues?state=open&per_page=100&page=${page + 1}>; rel="next"`] : []);
		}
		if (path.startsWith(`${prefix}/releases`) && method === "GET")
		{
			return r(200, this.releases);
		}
		// S165: labels added and removed one by one, and the issue's timeline (paged like the listing).
		const labelCall = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/labels(?:\/([^?]+))?$/.exec(path);
		if (labelCall)
		{
			const issue = this.issues.get(Number(labelCall[1]));
			if (!issue || issue.gone)
			{
				return r(404, {
					message: "Not Found",
				});
			}
			if (method === "POST" && labelCall[2] === undefined)
			{
				for (const [, name] of fields.filter(([n]) => n === "labels[]"))
				{
					if (!issue.labels.some((l) => l.name === name))
					{
						issue.labels.push({
							name,
						});
					}
				}
				issue.updated_at = this.now();
				return r(200, issue.labels);
			}
			if (method === "DELETE" && labelCall[2] !== undefined)
			{
				const name = decodeURIComponent(labelCall[2]);
				if (!issue.labels.some((l) => l.name === name))
				{
					return r(404, {
						message: "Label does not exist",
					});
				}
				issue.labels = issue.labels.filter((l) => l.name !== name);
				issue.updated_at = this.now();
				return r(200, issue.labels);
			}
		}
		const events = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/timeline\?per_page=100(?:&page=(\d+))?$/.exec(path);
		if (events && method === "GET")
		{
			const issue = this.issues.get(Number(events[1]));
			const all = issue?.events ?? [];
			const page = Number(events[2] ?? 1);
			const more = all.length > page * this.pageSize;
			return r(200, all.slice((page - 1) * this.pageSize, page * this.pageSize),
				more ? [`link: <repos/{owner}/{repo}/issues/${events[1]}/timeline?per_page=100&page=${page + 1}>; rel="next"`] : []);
		}
		const one = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)(\/comments)?(?:\?|$)/.exec(path);
		if (one)
		{
			const issue = this.issues.get(Number(one[1]));
			if (!issue || issue.gone === "deleted")
			{
				return r(issue ? 410 : 404, {
					message: "gone",
				});
			}
			if (issue.gone === "transferred")
			{
				return r(301, {
					message: "Moved Permanently",
				});
			}
			if (one[2])
			{
				if (method === "POST")
				{
					const comment = {
						body: fields.find(([n]) => n === "body")?.[1] ?? "",
						user: {
							login: this.viewer,
						},
					};
					issue.comments.push(comment);
					return r(201, comment);
				}
				return r(200, issue.comments);
			}
			if (method === "PATCH")
			{
				this.change(issue, fields);
			}
			return r(200, this.view(issue));
		}
		if (path === `${prefix}/issues` && method === "POST")
		{
			const issue = this.add({
				title: "",
				user: {
					login: this.viewer,
				},
			});
			this.change(issue, fields);
			return r(201, this.view(issue));
		}
		return r(404, {
			message: `fake: no route for ${method} ${path}`,
		});
	}

	private change(issue: FakeIssue, fields: [string, string][]): void
	{
		const labels = fields.filter(([n]) => n === "labels[]").map(([, v]) => v);
		if (labels.length > 0)
		{
			issue.labels = labels.map((name) => ({
				name,
			}));
		}
		for (const [name, value] of fields)
		{
			if (name === "body" || name === "title" || name === "state")
			{
				issue[name] = value;
			}
			else if (name === "state_reason")
			{
				issue.state_reason = value;
			}
			else if (name === "milestone")
			{
				issue.milestone = value === "null" ? null : this.milestones.find((m) => m.number === Number(value)) ?? null;
			}
		}
		if (issue.state === "open")
		{
			issue.state_reason = null;
		}
		issue.updated_at = this.now();
	}

	/** Every issue a given call kind touched, e.g. `fake.count("POST", /issues$/)`. */
	count(method: string, path: RegExp): number
	{
		return this.calls.filter((c) => c.method === method && path.test(c.path)).length;
	}
}
