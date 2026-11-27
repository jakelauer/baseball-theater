#!/usr/bin/env bash
# Grader for backlog story S103 — BT ingests Baseball Savant's per-pitch game feed (gf?game_pk=), keeping only
# what MLB's own feeds lack, on its own cadence inside S48's ingest object. A commit-time proof of this story (S84).
# Contract: docs/v3/backlog/frame/00 (Verify-script contract).
# No network. Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest
# files only, found by the tag each AC's tests carry: "S103 AC <n>").

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/raw/savant-gf-823823.json is Savant's gf answer for 823823 (340 pitches, each with a play_id), committed; the fixture client serves it from disk; tests 'S103 AC 1'"
check 2 "packages/mlb-api types Savant's pitch rows as named interfaces (packages/mlb-api/src/savant.ts) and parses them with a zod schema (its parseSavant… function), the coverage gate lists the recording, pnpm mlb:scan-drift scans it with no drift; tests 'S103 AC 2'"
check 3 "MlbStatsClient has fetchSavantGameFeed(gamePk), in the fixture and HTTP adapters, the HTTP one on Savant's own base URL (https://baseballsavant.mlb.com); no web code reaches Savant; tests 'S103 AC 3'"
check 4 "functions/src/mappers/savant.ts projects each pitch by playId into GameSnapshot.savant with exactly xba, isBarrel, x/y feet, homeRunBallparks, batSpeed, isSword, savantInZone, timesThroughOrder, isAbsChallenge, plateXPoly/plateZPoly, and copies no trajectory, zone, box-score or season field; savant is optional in the spec (fresh, pnpm api:breaking 0, generated client rendered); tests 'S103 AC 4' (52 xba, 150 batSpeed, 2 swords, ABS at atBatIndex 34, 39, 69, 82, 83)"
check 5 "Savant is pulled on its own cadence inside the ingest object, never in the live feed's fetch; fields merge by playId, newer by version, absent means not yet; first-seen times beside playEndTime; polling bounded (N seconds in config, once after the final); tests 'S103 AC 5'"
check 6 "the source is optional: a failing or empty Savant leaves savant absent and the game served as before; tests 'S103 AC 6'"
check 7 "docs/v3/SAVANT-DATA.md § Terms of use no longer says 'Not yet checked', and quotes the terms with at least one https:// link and a date read"
check 8 "S103's snapshot records Status done (story_snapshot_status), and the story stays inside its scope files (plus its own records and scripts/verify-S103.sh), touching nothing under scripts/ or test/ but its grader"

# The commit S103's own changes start from (origin/stage when the story started, 2026-11-27). The fence
# (check 8) reads only S103's own commits from here through story_own_changed_files (scripts/lib/checks.sh).
BASE=188452e5
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RECORDING=fixtures/raw/savant-gf-823823.json
MAPPER=functions/src/mappers/savant.ts
PARSER=packages/mlb-api/src/savant.ts

# run_tagged <check> <package dir> <tag> — runs every test file under the package's src/ that names <tag>,
# filtered to the tests carrying it; fails when none exists or none passes.
tagged_files() {
  (cd "$1" && grep -rlF --include="*.test.ts" --include="*.test.tsx" -- "$2" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')
}
run_tagged() {
  local id="$1" dir="$2" tag="$3" files
  files="$(tagged_files "$dir" "$tag")"
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# run_tagged_any <check> <tag> <package dir>… — run_tagged in each dir that has tests naming <tag>; fails only
# when none does. For an AC that doesn't say which package its code lives in (AC 5's merge).
run_tagged_any() {
  local id="$1" tag="$2" dir found=""
  shift 2
  for dir in "$@"; do
    [ -n "$(tagged_files "$dir" "$tag")" ] && { found=1; run_tagged "$id" "$dir" "$tag"; }
  done
  [ -n "$found" ] || bad "$id" "no test in $* names '$tag'"
}

# --- Check 1: the recording, read from disk ------------------------------------------------------------------
if [ ! -f "$RECORDING" ]; then
  bad 1 "$RECORDING is missing"
else
  # Every pitch row anywhere in the answer carries Savant's play_id; 823823 has 340 (the Gap).
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ids = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") { if (typeof v.play_id === "string") { ids.add(v.play_id); return; } Object.values(v).forEach(walk); }
    };
    walk(j);
    if (ids.size !== 340) { console.log("expected 340 pitches with a play_id, found " + ids.size); process.exit(1); }
  ' "$RECORDING" >"$TMP/rec.txt" 2>&1 || bad 1 "$RECORDING: $(cat "$TMP/rec.txt")"
  git ls-files --error-unmatch "$RECORDING" >/dev/null 2>&1 || bad 1 "$RECORDING is not committed"
fi
grep -rlF 'fetchSavantGameFeed' functions/src/adapters/fixtures >/dev/null 2>&1 || bad 1 "the fixture client (functions/src/adapters/fixtures/) has no fetchSavantGameFeed"
run_tagged 1 functions "S103 AC 1"

# --- Check 2: the parser and the drift scan ------------------------------------------------------------------
if [ ! -f "$PARSER" ]; then
  bad 2 "$PARSER is missing"
else
  grep -qE '^export interface Savant[A-Za-z]*Pitch' "$PARSER" || bad 2 "$PARSER exports no named Savant…Pitch interface"
fi
# "Parses them with zod": the exported parseSavant… function (a function or a const) calls .parse(…) or
# .safeParse(…) on a zod schema, directly or by passing one to a helper of the same file that calls .parse/.safeParse
# on that parameter. A zod schema is a value whose declaration, resolved by the TypeScript checker under
# packages/mlb-api's tsconfig (import aliases followed, so a schema from another module counts), is a chain rooted at
# zod's `z` or at another zod schema (savantPitchSchema.array()). The file isn't fixed (the package keeps its schemas
# in parse.ts); a hand-rolled parser fails, even in a file that imports zod for other feeds. Known limit (accepted at
# the pre-PR review): a parsing helper imported from another module isn't followed, so it fails loudly, never passing
# broken code; if the build puts its parse helper in another module, widen this before S103 ships (rule 7).
SAVANT_PARSE_FILE="$(grep -lE '^export (async )?(function parseSavant[A-Za-z]*\(|const parseSavant[A-Za-z]*[[:space:]]*[=:])' packages/mlb-api/src/*.ts 2>/dev/null | grep -v '\.test\.ts$' | head -1)"
if [ -z "$SAVANT_PARSE_FILE" ]; then
  bad 2 "packages/mlb-api/src exports no parseSavant… function"
else
  node -e '
    const ts = require("typescript");
    const path = require("path");
    const fail = (m) => { console.log(m); process.exit(1); };
    const cfg = ts.readConfigFile("packages/mlb-api/tsconfig.json", ts.sys.readFile);
    if (cfg.error) fail("cannot read packages/mlb-api/tsconfig.json");
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.resolve("packages/mlb-api"));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(path.resolve(process.argv[1]));
    if (!sf) fail("it is not in the packages/mlb-api program");
    const strip = (e) => { while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))) e = e.expression; return e; };
    // The identifier at the root of a call/property chain: z for z.object({…}).strict().
    const root = (e) => { e = strip(e); while (e && (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e))) e = strip(e.expression); return e; };
    const resolve = (id) => { let s = checker.getSymbolAtLocation(id); if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s); return s; };
    const inZod = (s) => (s.declarations ?? []).some((d) => /[\\/]node_modules[\\/](.*[\\/])?zod[\\/]/.test(d.getSourceFile().fileName));
    // Is e a zod schema: rooted at zod itself, or at a const (in any module) whose initializer is one?
    const isZod = (e, seen = new Set()) => {
      const r = root(e);
      if (!r || !ts.isIdentifier(r)) return false;
      const s = resolve(r);
      if (!s || seen.has(s)) return false;
      seen.add(s);
      if (inZod(s)) return true;
      const d = s.valueDeclaration;
      return !!d && ts.isVariableDeclaration(d) && !!d.initializer && isZod(d.initializer, seen);
    };
    const PARSE = ["parse", "safeParse", "parseAsync", "safeParseAsync"];
    // Does n call <receiver>.parse(…) where test(receiver) holds?
    const parses = (n, test) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && PARSE.includes(n.expression.name.text) && test(n.expression.expression)) return true;
      return !!ts.forEachChild(n, (c) => parses(c, test) || undefined);
    };
    const functions = new Map(), parsers = [];
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) functions.set(n.name.text, n.initializer);
        if (/^parseSavant/.test(n.name.text)) parsers.push(n.initializer);
      }
      if (ts.isFunctionDeclaration(n) && n.name) {
        functions.set(n.name.text, n);
        if (/^parseSavant/.test(n.name.text)) parsers.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Does n pass a zod schema to a same-file helper that parses with the matching parameter?
    const viaHelper = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && functions.has(n.expression.text)) {
        const helper = functions.get(n.expression.text);
        const hit = n.arguments.some((a, i) => {
          const p = helper.parameters[i];
          if (!p || !ts.isIdentifier(p.name) || !isZod(a)) return false;
          const param = p.name.text;
          return parses(helper, (recv) => { const r = root(recv); return !!r && ts.isIdentifier(r) && r.text === param; });
        });
        if (hit) return true;
      }
      return !!ts.forEachChild(n, (c) => viaHelper(c) || undefined);
    };
    if (!parsers.some((p) => parses(p, (recv) => isZod(recv)) || viaHelper(p)))
      fail("its parseSavant… function calls no .parse/.safeParse on a zod schema (a chain rooted at the z of zod or at another zod schema, directly or through a same-file helper)");
  ' "$SAVANT_PARSE_FILE" >"$TMP/zod.txt" 2>&1 || bad 2 "$SAVANT_PARSE_FILE: $(cat "$TMP/zod.txt")"
fi
grep -qF '"savant-gf-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "packages/mlb-api/src/coverage.test.ts does not gate the Savant recording"
pnpm -s mlb:scan-drift >"$TMP/drift.txt" 2>&1 || { bad 2 "pnpm mlb:scan-drift found drift:"; tail -15 "$TMP/drift.txt" | sed 's/^/        /'; }
grep -qE '^ +savant-gf-823823\.json$' "$TMP/drift.txt" || bad 2 "pnpm mlb:scan-drift did not scan savant-gf-823823.json"
run_tagged 2 packages/mlb-api "S103 AC 2"

# --- Check 3: the port, two adapters, Savant's own base URL, no web fetch -------------------------------------
# awk's output goes to a file first: under pipefail, grep -q's early exit can SIGPIPE awk and fail a match.
awk '/^export interface MlbStatsClient/{f=1} f{print} f&&/^}/{exit}' packages/ports/src/mlb.ts >"$TMP/port.txt"
grep -qE 'fetchSavantGameFeed\(gamePk: number\)' "$TMP/port.txt" ||
  bad 3 "MlbStatsClient (packages/ports/src/mlb.ts) has no fetchSavantGameFeed(gamePk: number)"
grep -qF 'fetchSavantGameFeed' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP client has no fetchSavantGameFeed"
grep -qE '"https://baseballsavant\.mlb\.com"' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP client names no Savant base URL (\"https://baseballsavant.mlb.com\")"
grep -rnE --include='*.ts' --include='*.tsx' 'baseballsavant|fetchSavantGameFeed|/gf\?game_pk' web/src >"$TMP/web.txt" 2>/dev/null
[ -s "$TMP/web.txt" ] && bad 3 "web code reaches Savant: $(cut -d: -f1,2 "$TMP/web.txt" | tr '\n' ' ')"
run_tagged 3 functions "S103 AC 3"

# --- Check 4: only what MLB's feeds lack, additive -----------------------------------------------------------
if [ ! -f "$MAPPER" ]; then
  bad 4 "$MAPPER is missing"
else
  # Fields MLB's live feed, box score or season lines already carry: trajectory, spin, breaks, extension, plate
  # time, the strike zone, batted-ball data and season stats. One source per value (ADR-025). The bare `zone` is
  # matched only as an output key, in the mapper's syntax tree: an object literal's `zone: …`, shorthand `zone`,
  # `"zone": …` or `["zone"]: …`, or an assignment to `….zone` / `…["zone"]`. So reading Savant's raw `pitch.zone`
  # to compute savantInZone, or a `zone: number` type or parameter, is allowed and copying it is not. A spread of
  # anything but object literals (`...pitch`, the raw row) or an Object.assign copies every field it is given, so it
  # fails too; the repo's optional-key idiom `...(cond ? { k: v } : {})` / `...cond && { k: v }` / `...(a ?? {})`
  # of literals passes, and its keys count as set. The same scan lists every key the mapper sets with a value (not
  # `undefined`, `void 0` or `null`), for the per-field check below.
  { grep -nwE 'vx0|vy0|vz0|ax|ay|az|x0|y0|z0|pfx_x|pfx_z|spin_rate|release_spin_rate|spin_axis|release_speed|start_speed|end_speed|release_extension|extension|plate_time|sz_top|sz_bot|breakX|breakZ|induced_break_z|launch_speed|launch_angle|hit_distance|avg|obp|slg|ops|era|whip|boxscore|season' "$MAPPER"
    node -e '
      const ts = require("typescript");
      const [file, keysFile] = process.argv.slice(1);
      const sf = ts.createSourceFile(file, require("fs").readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const out = [], keys = new Set();
      // A key written literally: name, "name", ["name"] or [`name`].
      const keyText = (n) => {
        if (n && ts.isComputedPropertyName(n)) n = n.expression;
        return n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
      };
      const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 + ":" + n.getText().slice(0, 80);
      const strip = (e) => { while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isNonNullExpression(e))) e = e.expression; return e; };
      // A value that sets nothing: undefined, void 0, null, or a conditional whose branches are all such.
      const empty = (e) => {
        e = strip(e);
        if (!e) return true;
        if ((ts.isIdentifier(e) && e.text === "undefined") || ts.isVoidExpression(e) || e.kind === ts.SyntaxKind.NullKeyword) return true;
        return ts.isConditionalExpression(e) && empty(e.whenTrue) && empty(e.whenFalse);
      };
      // A spread operand that adds only the keys written in it: object literals, or a conditional, &&, || or ?? of them
      // (for && the left side is the condition; a falsy one spreads nothing).
      const literalish = (e) => {
        e = strip(e);
        if (ts.isObjectLiteralExpression(e)) return true;
        if (ts.isConditionalExpression(e)) return literalish(e.whenTrue) && literalish(e.whenFalse);
        if (ts.isBinaryExpression(e)) {
          const op = e.operatorToken.kind;
          if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalish(e.right);
          if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return literalish(e.left) && literalish(e.right);
        }
        return false;
      };
      const visit = (n) => {
        let key, value;
        if (ts.isPropertyAssignment(n)) { key = keyText(n.name); value = n.initializer; }
        if (ts.isShorthandPropertyAssignment(n)) { key = keyText(n.name); value = n.name; }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          key = ts.isPropertyAccessExpression(n.left) ? n.left.name.text : ts.isElementAccessExpression(n.left) ? keyText(n.left.argumentExpression) : undefined;
          value = n.right;
        }
        if (key && !empty(value)) keys.add(key);
        if (key === "zone") out.push(at(n));
        if (ts.isSpreadAssignment(n) && !literalish(n.expression)) out.push(at(n));
        if (ts.isCallExpression(n) && n.expression.getText() === "Object.assign") out.push(at(n));
        ts.forEachChild(n, visit);
      };
      visit(sf);
      require("fs").writeFileSync(keysFile, [...keys].join("\n") + "\n");
      if (out.length) console.log(out.join("\n"));
    ' "$MAPPER" "$TMP/keys.txt"; } |
    grep -vE '^\s*[0-9]+:\s*(//|\*|/\*)' >"$TMP/copied.txt"
  [ -s "$TMP/copied.txt" ] && bad 4 "$MAPPER copies a field MLB's feeds already carry: $(cut -c1-120 "$TMP/copied.txt" | tr '\n' ' ')"
  # The mapper sets each AC 4 field (an object key or an assignment, from the scan above) and joins by playId.
  for f in xba isBarrel x y homeRunBallparks batSpeed isSword savantInZone timesThroughOrder isAbsChallenge plateXPoly plateZPoly; do
    grep -qxF "$f" "$TMP/keys.txt" || bad 4 "$MAPPER does not set $f"
  done
  grep -qw playId "$MAPPER" || bad 4 "$MAPPER does not join by playId"
fi
# "Exactly" these fields: the TypeScript checker resolves GameSnapshot.savant's entry type (through optional, arrays,
# Record/index signatures, Partial<>, Readonly<>, intersections and inline types) under packages/domain's own
# tsconfig, so its `.js` imports resolve. Every AC 4 field must be there and no field of a class MLB's feeds carry;
# any other property (AC 5's version or arrival record, named as the build chooses) passes. AC 4 and 5 join "by
# playId" without saying how it is stored, so each entry carries a playId, or the entries sit in a string-keyed
# Record / index signature or a Map (keyed by the play's id; a type can't say more).
node -e '
  const ts = require("typescript");
  const path = require("path");
  const fail = (m) => { console.log(m); process.exit(1); };
  const cfg = ts.readConfigFile("packages/domain/tsconfig.json", ts.sys.readFile);
  if (cfg.error) fail("cannot read packages/domain/tsconfig.json");
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.resolve("packages/domain"));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(path.resolve("packages/domain/src/types.ts"));
  const decl = sf?.statements.find((s) => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === "GameSnapshot");
  const unresolved = "could not resolve GameSnapshot.savant entry type";
  if (!decl) fail(unresolved + " (no GameSnapshot)");
  const prop = checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(decl.name)), "savant");
  if (!prop) fail(unresolved + " (GameSnapshot has no savant)");
  const required = ["xba", "isBarrel", "x", "y", "homeRunBallparks", "batSpeed", "isSword", "savantInZone", "timesThroughOrder", "isAbsChallenge", "plateXPoly", "plateZPoly"];
  let t = checker.getTypeOfSymbolAtLocation(prop, decl);
  let names = [];
  let keyed = false;
  for (let depth = 0; depth < 6; depth++) {
    t = checker.getNonNullableType(t);
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) fail(unresolved + " (it is any/unknown)");
    names = checker.getPropertiesOfType(t).map((p) => p.name);
    if (names.some((n) => required.includes(n))) break;
    const mapName = t.getSymbol()?.getName();
    const byString = checker.getIndexTypeOfType(t, ts.IndexKind.String);
    let inner;
    if ((mapName === "Map" || mapName === "ReadonlyMap") && checker.getTypeArguments(t).length === 2) { inner = checker.getTypeArguments(t)[1]; keyed = true; }
    else if (byString && !checker.getIndexTypeOfType(t, ts.IndexKind.Number)) { inner = byString; keyed = true; }
    else inner = checker.getIndexTypeOfType(t, ts.IndexKind.Number);
    if (!inner) break;
    t = inner;
  }
  if (!names.some((n) => required.includes(n))) fail(unresolved + " (no entry type carrying its fields)");
  const problems = [];
  const missing = required.filter((n) => !names.includes(n));
  if (missing.length) problems.push("its entries lack " + missing.join(", "));
  if (!keyed && !names.includes("playId")) problems.push("its entries carry no playId and are not keyed by one (a Record or Map)");
  const forbidden = new Set(("vx0 vy0 vz0 ax ay az x0 y0 z0 pfxX pfxZ pfx_x pfx_z spinRate spin_rate releaseSpinRate release_spin_rate spinAxis spin_axis " +
    "releaseSpeed release_speed startSpeed start_speed endSpeed end_speed releaseExtension release_extension extension plateTime plate_time " +
    "breakX breakZ breakAngle breakLength inducedBreakZ induced_break_z szTop sz_top szBot sz_bot strikeZoneTop strikeZoneBottom zone " +
    "launchSpeed launch_speed launchAngle launch_angle hitDistance hit_distance totalDistance avg obp slg ops era whip boxscore season").split(" "));
  const copied = names.filter((n) => forbidden.has(n));
  if (copied.length) problems.push("its entries copy fields MLB feeds carry: " + copied.join(", "));
  if (problems.length) fail(problems.join("; "));
' >"$TMP/entry.txt" 2>&1 || bad 4 "GameSnapshot.savant (packages/domain/src/types.ts): $(cat "$TMP/entry.txt")"
awk '/^export type GameSnapshot = /{f=1} f{print} f&&/^};/{exit}' packages/domain/src/types.ts >"$TMP/snapshot.txt"
grep -qE '^\s*savant\?:' "$TMP/snapshot.txt" ||
  bad 4 "GameSnapshot (packages/domain/src/types.ts) has no optional savant?"
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const s = spec.components?.schemas ?? {};
  const game = s.GameSnapshot ?? Object.values(s).find((x) => x?.properties?.plays && x?.properties?.gamePk);
  if (!game?.properties?.savant) { console.log("the game schema has no savant"); process.exit(1); }
  if ((game.required ?? []).includes("savant")) { console.log("savant is required, so a game from before S103 would not parse"); process.exit(1); }
' >"$TMP/spec-shape.txt" 2>&1 || bad 4 "openapi/bt-api.v1.json: $(cat "$TMP/spec-shape.txt")"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/brk.log" 2>&1 || { bad 4 "pnpm api:breaking failed:"; tail -8 "$TMP/brk.log" | sed 's/^/        /'; }
if ! (cd web && pnpm exec vitest run src/api/codegen.test.ts >"$TMP/codegen.log" 2>&1); then
  bad 4 "web/src/api/generated/ is not rendered from the current spec (web/src/api/codegen.test.ts):"; tail -8 "$TMP/codegen.log" | sed 's/^/        /'
fi
run_tagged 4 functions "S103 AC 4"

# --- Check 5: arrival time — own cadence, merge by version, first-seen log, bounded polling --------------------
# The live feed's fetch (the HTTP client's fetchGame) never asks Savant, so a slow Savant can't delay a pitch:
# fetchGame and every class method or module function it reaches (this.name / name( calls, transitively, e.g.
# fetchGameFeed, fetchContent, getJson) name no Savant once comments are stripped.
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const bodies = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (/;\s*$/.test(lines[i])) continue; // a signature, not a body
    let m = lines[i].match(/^\t(?:(?:public|private|protected|static|async|override)\s+)*(\w+)\s*[(<]/), end = /^\t\}$/;
    if (!m) { m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/); end = /^\}$/; }
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !end.test(lines[j])) j++;
    const body = lines.slice(i, j + 1).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    bodies.set(m[1], (bodies.get(m[1]) ?? "") + body);
  }
  if (!bodies.has("fetchGame")) { console.log("has no fetchGame"); process.exit(1); }
  const seen = new Set(["fetchGame"]), queue = ["fetchGame"], hits = [];
  while (queue.length) {
    const name = queue.shift(), body = bodies.get(name);
    if (/savant/i.test(body)) hits.push(name);
    for (const m of body.matchAll(/\bthis\.(\w+)|\b(\w+)\s*\(/g)) {
      const callee = m[1] ?? m[2];
      if (bodies.has(callee) && !seen.has(callee)) { seen.add(callee); queue.push(callee); }
    }
  }
  if (hits.length) { console.log("asks Savant in the live feed call, in " + hits.join(", ")); process.exit(1); }
' functions/src/adapters/http/mlb.ts >"$TMP/live.txt" 2>&1 || bad 5 "the HTTP client's fetchGame $(cat "$TMP/live.txt")"
grep -qF 'fetchSavantGameFeed' functions/src/game-ingest-object.ts || bad 5 "the ingest object (functions/src/game-ingest-object.ts) never calls fetchSavantGameFeed"
run_tagged_any 5 "S103 AC 5" functions packages/domain

# --- Check 6: the source is optional --------------------------------------------------------------------------
run_tagged 6 functions "S103 AC 6"

# --- Check 7: the terms of use, checked and quoted ------------------------------------------------------------
awk '/^## Terms of use/{f=1; next} f&&/^## /{exit} f{print}' docs/v3/SAVANT-DATA.md >"$TMP/terms.txt"
if [ ! -s "$TMP/terms.txt" ]; then
  bad 7 "docs/v3/SAVANT-DATA.md has no § Terms of use"
else
  grep -qF 'Not yet checked' "$TMP/terms.txt" && bad 7 "§ Terms of use still says 'Not yet checked'"
  grep -qF 'https://' "$TMP/terms.txt" || bad 7 "§ Terms of use links no https:// page"
  grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$TMP/terms.txt" || bad 7 "§ Terms of use gives no date read (YYYY-MM-DD)"
fi

# --- Check 8: Status done, inside the fence -------------------------------------------------------------------
[ "$(story_snapshot_status S103)" = "done" ] || bad 8 "S103's snapshot does not record Status done"
story_own_changed_files S103 "$BASE" . >"$TMP/changed.txt"
grep -vE '^(fixtures/|packages/mlb-api/src/|packages/ports/src/|packages/domain/src/|functions/src/|functions/vitest\.config\.ts$|openapi/|web/src/api/generated/|docs/v3/backlog/|docs/v3/SAVANT-DATA\.md$|docs/v3/AUDIT\.md$|CHANGELOG\.md$|docs/v3/audit/[^/]+/[^/]+-S103-[a-z-]+\.md$|changelog\.d/S103\.md$|scripts/verify-S103\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^(scripts/|test/)' "$TMP/changed.txt" | grep -vE '^scripts/verify-S103\.sh$' >"$TMP/scripts.txt"
[ -s "$TMP/scripts.txt" ] && bad 8 "the story changes files under scripts/ or test/: $(tr '\n' ' ' <"$TMP/scripts.txt")"

report "verify-S103"
exit $?
