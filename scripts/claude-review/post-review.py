#!/usr/bin/env python3
"""Post Claude's pull request review (.github/workflows/claude-review.yml).

The reviewer has no shell or GitHub access (it reads untrusted pull request text, so it must not be
able to approve, resolve threads or run anything). It ends with one JSON object,
{"summary": str, "findings": [{"path", "line", "body"}]}, and this trusted step posts it as a single
review with event COMMENT and commit_id = the reviewed head sha, whose body starts
"Claude review of <sha>:" (CLAUDE.md -> "Claude's review is handled before a pull request merges").

Every finding should be a thread, which "Require conversation resolution" holds the merge on. A line
outside the diff makes GitHub refuse the whole inline review (HTTP 422); then every finding whose file
is in the pull request's diff (REVIEW_DIR/changed.txt), not only the one that failed to anchor, is
posted as its own file-level review comment (subject_type "file", body naming the line), which is a
thread too, and the review is posted again with no inline comments. Those comments go first and the
summary review, which carries the record, last: if a post fails, no record has posted, so a re-run is
never `unchanged` (which would post "no changes" and pass): it reviews again, fully or incrementally,
and any duplicate threads it leaves just block. A finding on a file outside the diff, or one whose
file-level comment GitHub also refuses with a 422, goes in the review body, where no thread holds it:
the step reports how many (`in_body=<count>` in GITHUB_OUTPUT) and the workflow sets its required
`claude-review/posted` status to failure. That failure holds only until the next review of any kind:
a merge from `stage` or a re-run (each usually an `unchanged` review, with no model call) sets
success, so the coordinator answers a body finding before bringing `stage` in or re-running. Any other
failed post fails the step before the summary posts. Output that can't be read fails the run, so no
summary posts and the coordinator re-runs it rather than taking silence for "no findings".

Any secret value given as REDACT_* (and GH_TOKEN) is blanked out of everything posted, in case
untrusted pull request text talked the reviewer into quoting one.

Every summary ends with what kind of review it was, what paid for it, and a hidden record
(plan-review.py reads the newest one to review only what changed since). Its findings list carries the
earlier records' findings forward, so a settled finding isn't raised again. MODE=unchanged posts with no
model call: nothing in the pull request changed since the recorded review.

Env: EXECUTION_FILE (claude-code-action's execution_file output; unset when MODE=unchanged), HEAD_SHA,
PR, GITHUB_REPOSITORY, GH_TOKEN, MODE, WHY, PAID_BY, RECORD_FILE, PREVIOUS_FILE, REVIEW_DIR, GITHUB_OUTPUT,
REDACT_*. `--dry-run` prints the review payload instead of posting it.
"""

import base64
import codecs
import json
import os
import re
import subprocess
import sys


def final_text(execution_file: str) -> str:
    """The reviewer's last result message from claude-code-action's execution log."""
    with open(execution_file, encoding="utf-8") as f:
        messages = json.load(f)
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("type") == "result":
            return str(message.get("result") or "")
    raise ValueError("no result message in the execution file")


def parse_review(text: str) -> dict:
    """The last JSON object in the text (the reviewer may wrap it in a code fence)."""
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidates = fenced or [text[text.find("{"): text.rfind("}") + 1]]
    review = json.loads(candidates[-1])
    if not isinstance(review.get("summary"), str) or not isinstance(review.get("findings"), list):
        raise ValueError("review JSON lacks summary or findings")
    for finding in review["findings"]:
        if not (isinstance(finding.get("path"), str) and isinstance(finding.get("line"), int) and isinstance(finding.get("body"), str)):
            raise ValueError(f"malformed finding: {finding!r}")
    return review


def inert(text: str) -> str:
    """Model-written text with HTML comment markers broken, so it can't open or close a hidden block
    (a fake review record, or one that cuts the real record short)."""
    return text.replace("<!--", "<\u200b!--").replace("-->", "--\u200b>")


MAX_CARRIED_FINDINGS = 60


def footer(review: dict) -> str:
    """What the review was and what paid for it, then the record the next review reads."""
    record = {}
    try:
        with open(os.environ["RECORD_FILE"], encoding="utf-8") as f:
            record = json.load(f)
        with open(os.environ["PREVIOUS_FILE"], encoding="utf-8") as f:
            previous = json.load(f)
    except (OSError, KeyError, ValueError):
        previous = {}
    carried = previous.get("findings", []) if isinstance(previous.get("findings"), list) else []
    new = [{"path": f["path"], "line": f["line"], "at": os.environ.get("HEAD_SHA", "")[:7], "gist": f["body"][:160]} for f in review["findings"]]
    record["findings"] = (carried + new)[-MAX_CARRIED_FINDINGS:]
    note = f"_{os.environ.get('WHY', '')}; paid by {os.environ.get('PAID_BY', 'n/a')}._"
    # One line, with < and > escaped so no path or gist can end the comment early.
    encoded = json.dumps(record, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")
    return f"\n\n{note}\n\n<!-- claude-review-record {encoded} -->"


def payload(review: dict, head: str, inline: bool, in_body: list | None = None, on_files: int = 0) -> dict:
    """One COMMENT review. With inline True every finding is an inline comment; with inline False only
    `in_body` (every finding when None) goes in the body, and `on_files` says how many were posted
    as file-level comments instead. The footer's record always lists every finding."""
    body = f"Claude review of {head}: {inert(review['summary'])}"
    comments = []
    if inline:
        for finding in review["findings"]:
            comments.append({"path": finding["path"], "line": finding["line"], "side": "RIGHT", "body": inert(finding["body"])})
    else:
        if on_files:
            body += f"\n\n_GitHub refused this review's line comments, so {on_files} finding(s) are posted as file-level comments._"
        for finding in review["findings"] if in_body is None else in_body:
            body += f"\n\n**{inert(finding['path'])}:{finding['line']}**\n\n{inert(finding['body'])}"
    body += footer(review)
    result = {"event": "COMMENT", "commit_id": head, "body": body}
    if comments:
        result["comments"] = comments
    return result


def redact(text: str) -> str:
    """Every secret value this run holds, blanked out."""
    secrets = [value for key, value in os.environ.items() if (key.startswith("REDACT_") or key == "GH_TOKEN") and len(value) >= 8]
    if os.environ.get("GH_TOKEN"):
        # The form actions/checkout writes into git's config, in case a credential is ever on disk.
        secrets.append(base64.b64encode(f"x-access-token:{os.environ['GH_TOKEN']}".encode()).decode())
    for secret in secrets:
        text = text.replace(secret, "[redacted]")
    return text


def post(data: dict, endpoint: str = "reviews") -> str:
    """POST to the pull request's `reviews` (a review) or `comments` (one review comment):
    'ok', 'unprocessable' (GitHub refused the content: HTTP 422) or 'failed'."""
    url = f"repos/{os.environ['GITHUB_REPOSITORY']}/pulls/{os.environ['PR']}/{endpoint}"
    done = subprocess.run(["gh", "api", "-X", "POST", url, "--input", "-"], input=redact(json.dumps(data)), text=True, capture_output=True)
    if done.returncode == 0:
        return "ok"
    print(done.stdout, done.stderr, file=sys.stderr)
    return "unprocessable" if "HTTP 422" in done.stderr else "failed"


def unquote_path(field: str) -> str:
    """A path as git printed it. The workflow writes changed.txt with core.quotePath=false, so only a
    path holding a tab, newline, double quote or backslash is C-quoted (backslash escapes, octal for
    other bytes); this undoes that, and leaves any other path as it is."""
    if len(field) < 2 or not (field.startswith('"') and field.endswith('"')):
        return field
    raw = field[1:-1].encode("utf-8")
    return codecs.escape_decode(raw)[0].decode("utf-8", "replace")


def diff_paths() -> set[str]:
    """The pull request's changed paths, from REVIEW_DIR/changed.txt (`git diff --name-status`: a
    status, then the path, or for a rename or copy the old and new paths; the new one is in the diff).
    Empty when it can't be read, so every unanchored finding goes in the body rather than being lost."""
    try:
        with open(os.path.join(os.environ["REVIEW_DIR"], "changed.txt"), encoding="utf-8") as f:
            return {unquote_path(line.rstrip("\n").split("\t")[-1]) for line in f if "\t" in line}
    except (OSError, KeyError):
        return set()


def file_comment(finding: dict, head: str) -> dict:
    """A file-level review comment (its own thread) for a finding, after GitHub refused the review's
    line comments (it doesn't say which one failed to anchor, so every in-diff finding is posted so)."""
    note = "GitHub refused this review's line comments, so this one is on the file"
    body = f"**Line {finding['line']}** ({note}):\n\n{inert(finding['body'])}"
    return {"commit_id": head, "path": finding["path"], "subject_type": "file", "body": body}


def report_in_body(count: int) -> None:
    """How many findings went in the body, for the workflow's `claude-review/posted` status."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"in_body={count}\n")


def main() -> int:
    head = os.environ["HEAD_SHA"]
    if os.environ.get("MODE") == "unchanged":
        review = {"summary": "no changes to review: no file of this pull request changed since the last recorded review.", "findings": []}
        if "--dry-run" in sys.argv:
            print(redact(json.dumps(payload(review, head, inline=False), indent=2)))
            return 0
        return 0 if post(payload(review, head, inline=False)) == "ok" else 1
    try:
        review = parse_review(final_text(os.environ["EXECUTION_FILE"]))
    except (OSError, ValueError, KeyError) as error:
        print(f"claude-review: could not read the reviewer's output: {error}", file=sys.stderr)
        return 1
    if "--dry-run" in sys.argv:
        print(redact(json.dumps(payload(review, head, inline=True), indent=2)))
        return 0
    first = post(payload(review, head, inline=True))
    if first == "ok":
        report_in_body(0)
        return 0
    # A 422 is usually a finding on a line outside the diff: post each finding on a file in the diff as
    # a file-level thread, then the review again without inline comments; a finding on a file outside
    # the diff, or one GitHub refuses on its file too (422, which a re-run would only repeat), goes in
    # its body. The summary carries the record, so it goes last: a failure before it leaves no record,
    # so a re-run is never `unchanged`. Any other failure of the inline review isn't retried here, so a
    # review GitHub did accept is never posted twice.
    if first == "unprocessable" and review["findings"]:
        paths = diff_paths()
        in_body = [f for f in review["findings"] if f["path"] not in paths]
        on_files = 0
        for finding in (f for f in review["findings"] if f["path"] in paths):
            answer = post(file_comment(finding, head), "comments")
            if answer == "unprocessable":
                in_body.append(finding)
            elif answer != "ok":
                print(f"claude-review: posting the file-level comment on {finding['path']} failed", file=sys.stderr)
                return 1
            else:
                on_files += 1
        if post(payload(review, head, inline=False, in_body=in_body, on_files=on_files)) != "ok":
            return 1
        report_in_body(len(in_body))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
