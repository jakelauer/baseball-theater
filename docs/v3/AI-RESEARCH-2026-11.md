<!-- Committed 2026-11-22 from the research the owner read before deciding how BT builds its AI features (S174 and S176–S185); kept verbatim, prices as of that date. -->

# Do Baseball Theater's AI features need a fine-tuned model?

Researched 2026-11-22. Prices change often, so recheck them before you commit. Every web source was checked on 2026-11-22. Anthropic prices come from the Claude API reference's model table (cached 2026-11-03).

## Short answer

None of the 8 features needs a fine-tuned model to be truly useful.

- **Text features (1–5, 8):** a model that is handed BT's own game data in the prompt does better. A fine-tune can't know tonight's game; it only learns style and format.
- **Clip features (6, 7):** an LLM fine-tune is the wrong tool. Use rules and statistics now, and later a small ranking model BT trains on its own data, the way S90 does.
- **Cost:** fine-tuning wouldn't save money at BT's volume either. Today's cheapest hosted model (Claude Haiku 5.5 at $0.10 / $0.50 per million tokens) already costs less to run than a fine-tuned open model, and the whole precompute bill is about **$6–125 a month in season**, depending on the model.
- **Later:** fine-tuning is worth revisiting only if a quality test shows a cheap model failing a narrow, high-volume job such as inning notes, *and* that job's bill has become material.

## 1. What fine-tuning is

**Fine-tuning** means taking a model that already exists and training it a bit more on a few hundred to a few thousand examples of "input → the output I want." Afterwards it produces outputs like your examples without being told how each time. **LoRA** ("low-rank adapter") is the cheap way to do it: instead of changing the whole model, you train a small add-on file (tens of MB) that sits on top of the base model.

**Good for:**
- A consistent voice, format or length.
- Getting a small, cheap model to do one narrow job as well as a big one.
- Shorter prompts, because the instructions are learned rather than sent each time.
- Classification or labelling tasks.

**Not good for facts that change**, such as tonight's box score or this season's stats. A fine-tune bakes in patterns, not live data, and it will confidently invent numbers in the right style.

**Alternatives, usually tried first:**

| Technique | What it means | BT fit |
|---|---|---|
| **Grounding** | Put the game's structured data (plays, pitches, win probability, clips) in the prompt as JSON, and tell the model to use only that | Core of every text feature |
| **Few-shot examples** | Include 2–5 worked examples of good output in the prompt | Fixes most style and format problems |
| **Prompt caching** | The provider stores the unchanging start of a prompt (instructions, examples, a game's data pack) and bills re-reads at about 10% | Big saving for chat, where every question about one game repeats the same game data |
| **Retrieval (RAG)** | Look up the relevant records first and put only those in the prompt | Chat across many games, the digest with other sites' data (ADR-009) |

**When fine-tuning really beats a well-grounded prompt:**
1. A strict format or voice that examples in the prompt still can't hold.
2. A huge volume of one narrow job, where a smaller model saves real money.
3. Speed (latency), when a small model must answer very fast.
4. Classifying or labelling at scale.

BT has none of these today. Its biggest job is about 4,500 inning notes a month.

## 2. Who offers fine-tuning today

"Worker OK?" means it can be called from a Cloudflare Worker. Every provider is a plain HTTPS API, so all are usable. The differences are in how you sign in: Workers AI is a native binding; Anthropic, OpenAI and Together take an API key; Vertex needs a Google service-account token; Bedrock needs AWS request signing (SigV4).

| Provider | Fine-tunable models | Method | Training price | Per-use price of the tuned model | Notes |
|---|---|---|---|---|---|
| **OpenAI** | gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini | Managed (method not disclosed) | $3–25 per M training tokens | e.g. gpt-4.1-mini $0.80 in / $3.20 out per M | **Closed to new users**; existing users can keep training. ([pricing](https://developers.openai.com/api/docs/pricing)) |
| **Google Vertex (Gemini)** | Gemini 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Pro / Flash / Flash-Lite | Adapter-based ("adapter size" setting) | About $5 per M for 2.5 Flash and $1 per M for older Flash-Lite (secondhand); not found for 3.x | Not confirmed | Google recommends 100–500+ examples. ([tuning docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-use-supervised-tuning); [pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)) |
| **Anthropic, directly** | None | — | — | — | Anthropic's glossary: "The Claude API does not currently offer fine-tuning, but ask your Anthropic contact." ([glossary](https://platform.claude.com/docs/en/about-claude/glossary)) |
| **Anthropic on Amazon Bedrock** | Claude 3 Haiku only (2024 model) | Managed | — | — | Bedrock's table still lists it, but AWS and secondhand sources say it reached end of life on 2026-09-10. Treat it as gone, and far weaker than Haiku 5.5 anyway. ([Bedrock list](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-supported.html), [AWS blog](https://aws.amazon.com/blogs/machine-learning/fine-tune-anthropics-claude-3-haiku-in-amazon-bedrock-to-boost-model-accuracy-and-quality)) |
| **Mistral** | Historically Mistral Small and Ministral | LoRA | Historically $1–4 per M, $4 minimum, $2 a month storage | About $0.10 / $0.30 (Small) | Mistral's docs now mark the self-serve fine-tuning page **deprecated**; it appears to be sales-led now. ([docs](https://docs.mistral.ai/deprecated/finetuning), [pricing](https://mistral.ai/pricing)) |
| **Together AI** | Qwen3.5 0.8–9B, Llama 3.1 8B, and larger | LoRA and full | **$0.34 per M** for small models ($4 minimum); $1.05 per M for 27–35B | Small serverless models about $0.15–0.17 in / $0.25–0.50 out; whether a tuned LoRA bills at the base rate isn't stated | ([pricing](https://www.together.ai/pricing)) |
| **Fireworks AI** | Qwen 3.6 35B, others | LoRA ("serverless training") | About $2–6 per M on the models listed; $8 per GPU-hour dedicated | Not stated for LoRA | ([pricing](https://fireworks.ai/pricing)) |
| **Cloudflare Workers AI** | Gemma 2B/7B, Llama 2 7B, Mistral 7B (2024); Gemma 3 12B, Mistral Small 3.1 24B, Qwen 2.5 Coder 32B, QwQ 32B (added April 2025) | **Runs** LoRA adapters only; you train them elsewhere (e.g. Together, Hugging Face) | — | LoRA hosting is a **free open beta**; base model rates apply, e.g. Gemma 3 12B $0.345 in / $0.556 out | Adapters must be under 300 MB, rank ≤ 8 (up to 32 may work), and at most 100 per account. Only native option inside production. ([LoRA docs](https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [changelog](https://developers.cloudflare.com/changelog/post/2025-04-11-new-models-faster-inference/)) |

**Price per million tokens of models that are not fine-tuned, for comparison:**

| Model | Input | Output | Source |
|---|---|---|---|
| Claude Opus 5.5 (strong) | $4.00 | $20.00 | Claude API model table |
| Claude Sonnet 5.5 (strong, cheaper) | $2.00 | $10.00 | same |
| **Claude Haiku 5.5 (cheap)** | **$0.10** | **$0.50** | same (prompts up to 100K tokens) |
| Gemini 3.1 Pro Preview | $2.00 | $12.00 | [AI Studio pricing](https://aistudio.google.com/docs/pricing) |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | same |
| OpenAI gpt-5-nano (cheapest) | $0.05 | $0.40 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |

The fine-tuned small models people usually host (7–12B, at $0.17–0.35 per M input) now cost **as much as or more than** the cheapest frontier "small" models. That removes most of fine-tuning's usual cost argument.

## 3. Cost at BT's volume

**Volume.** These are ARCHITECTURE §2.1 and ADR-011's numbers:
- About 15 games a day, so about **450 games** in a season month. The season is 2,430 games plus about 40 in the postseason, over about 7 months.
- About **4,500 inning jobs** a month.

**Tokens per job** (input → output). These are ARCHITECTURE's figures plus my estimates for explainers:

| Job | Tokens per job | Jobs per month |
|---|---|---|
| Inning notes | 4k → 0.4k | 4,500 |
| Recap | 8k → 1.5k | 450 |
| Package | 8k → 1.5k | 450 |
| Play explainers (assumed ~10 key plays per game, precomputed) | 2k → 0.3k | 4,500 |
| Ranking and "also interesting" | 4k → 1k | 450 |
| Digest | 20k → 2k | 30 |
| **Total** | **≈ 37M input, 5M output** | |

**Monthly cost in season, all precomputed (Meter A):**

| Option | Monthly cost | Notes |
|---|---|---|
| **(a) Strong model, grounded:** Sonnet 5.5 | **≈ $125**, or ≈ $90 with Batch API (half price) for the postgame jobs | Opus 5.5 is about 2× that |
| **(b) Cheap model, grounded:** Haiku 5.5 | **≈ $6** | Gemini 3.5 Flash-Lite ≈ $24; gpt-5-nano ≈ $4 |
| **Hybrid (recommended):** Haiku 5.5 for inning notes and explainers, Sonnet 5.5 (batched) for recap, package, ranking and digest | **≈ $25–40** | |
| **(c) Fine-tuned small model** | Inference **≈ $8–15**: Gemma 3 12B with LoRA on Workers AI ≈ $15; Qwen3.5 9B on Together ≈ $8 if LoRA bills at the base rate | Training: 1,000 examples × ~6k tokens × 3 passes ≈ 18M training tokens ≈ **$6 per task on Together**, or ≈ $90 per task on Gemini 2.5 Flash. Re-training (each season, or when the format changes) costs the same again. The real cost is people-time: about 20–60 hours per task to build and check the examples (section 4), plus an evaluation harness and an adapter pipeline to maintain |

Thinking ("reasoning") tokens are billed as output. Run these jobs at low effort, or output can roughly double. Off-season, Meter A falls to near zero.

**Chat (Meter B)**, one grounded turn ≈ 6k in → 0.5k out:

| Model | Per turn | 2,000 turns a month | 20,000 turns a month |
|---|---|---|---|
| Sonnet 5.5 | ≈ $0.017; ≈ $0.008 with the game pack cached | $34 | $340, or ≈ $150 cached |
| Haiku 5.5 | ≈ $0.001 | $2 | $17 |

A fine-tune doesn't help chat. Chat needs the game's live facts in the prompt either way, and the cheap hosted model is already about $0.001 a turn. The cost lever for chat is caps and caching, as ARCHITECTURE already says.

## 4. Training data: where examples would come from

| Source | Work | Quality | Risk |
|---|---|---|---|
| **Hand-written by the owner** | Highest: about 5–15 minutes each, so 300 examples ≈ 25–75 hours | Best voice match | Burnout. Too few examples. |
| **Written by a strong model from BT's data, then corrected by the owner** | Medium: 2–5 minutes per review, so 500–1,000 examples ≈ 20–80 hours. Generating them costs very little (1,000 recaps on Opus 5.5 ≈ $60) | Good, if every number is checked against the data | Copies the strong model's mistakes unless reviewed |
| **Free by-product of shipping a prompted version first:** log every output plus any edit the owner makes | Near zero extra work. The dataset grows while the feature is live | Real outputs from real games | Needs logging built in from day one |
| **MLB's editorial recaps** | Low effort to collect | Professional voice | **Don't.** MLB's [Terms of Use](https://www.mlb.com/official-information/terms-of-use) forbid reproducing or making "derivative works" of MLB content, and forbid "automated scripts to collect information." Third-party material inside them (e.g. AP) "shall not be published… rewritten." Training a model to imitate them, and then showing its output *next to* MLB's recap, is exactly the derivative-work risk. The visible terms have no explicit AI-training clause (the page was cut off at 100k characters), but that doesn't make it safe. Get a lawyer's view before using any of it, even as inspiration for prompts. |

## 5. Feature by feature

| # | Feature | Needs a fine-tune? | Better tool | What a fine-tune would add | Effort | Main risk and how to prevent it |
|---|---|---|---|---|---|---|
| 1 | AI game recap | **No**. Later, maybe for voice | Strong model (Sonnet) grounded on the game package JSON, with 2–3 example recaps in the prompt; batch after the final | A steadier "BT voice" on a cheaper model | Prompted: ~1–2 stories. Fine-tuned: weeks | **Wrong facts** (score, names, stats). Generate from a list of facts BT computes. Then a validator checks every number and player name in the output against the data, and the recap is regenerated or dropped if one is wrong |
| 2 | Play and inning explainers | **No** | Rules decide *what* happened (BT already has the event data); a cheap model only phrases it, with a fixed rules glossary in the prompt | Little | ~1 story | Misexplaining a rule. Fixed glossary; templates for rare plays |
| 3 | Q&A / chat (Meter B) | **No**. A fine-tune is actively the wrong tool here | Cheap model by default, the game's data pack cached, retrieval or tools for anything beyond one game; patron caps | None: answers depend on fresh facts | ~2–3 stories | **Cost per request** (caps, caching, cheap model by default) and wrong facts (answer only from the data; say "I don't have that") |
| 4 | End-of-inning insight items | **No**. **Later, as an optimization**: this is the only plausible candidate (highest volume, narrow format) | Rules compute candidate notes (streaks, velocity changes, win-probability swings); a cheap model picks and phrases 1–3; quiet innings skip the model (ADR-011) | Maybe 20–40% cheaper prompts and a steadier format; worth a few dollars a month at most | Prompted: ~2 stories. Fine-tuned: 2–4 weeks | Bland or repeated notes, invented stats. Only facts the rules computed reach the model |
| 5 | Postgame game package | **No** | Mostly deterministic selection (key moments by win probability added, standout lines, milestones); a strong model writes only the headline and the narrative beats | Little | ~2 stories | Wrong facts in the narrative. Same validator as #1 |
| 6 | Model-assisted highlight ranking (Phase B) | **No LLM fine-tune** | Keep the Phase A heuristic. Next, a **small learning-to-rank model BT trains itself** (like S90) on its own play and clip features, with labels from what fans actually watch (clip starts and completions, which BT would need to start logging) or a one-off batch of LLM-judged labels | n/a | Logging: ~1 story. Ranker: ~2–3 stories once enough data exists (a season) | No labels yet. Start logging engagement now |
| 7 | "Also interesting" clips | **No** | Statistics and rules: percentile outliers versus league distributions (velocity, spin, exit velocity, catch probability, xBA), milestone lookups, rare event types for "bizarre." Optionally a cheap model writes the one-line "why." Later a small classifier BT trains on owner-tagged examples | n/a | ~2–3 stories | False "interesting" picks. Thresholds tuned on past games |
| 8 | Day digest | **No** | A strong model once a day reading the game packages (≈ $0.06 a day on Sonnet). Other sites' data later via connectors and retrieval (ADR-009), never a fine-tune, because those facts change daily | None | ~1–2 stories | Cross-game factual mix-ups. Cite each item's game and validate the facts |

## 6. Recommendation

1. **Don't fine-tune now.** Build every text feature as "BT computes the facts → a model writes from only those facts → a validator checks them." That pipeline, not the model, is what prevents wrong facts.
2. **Provider:** start with Claude behind the existing AI port (ADR-012).
   - Haiku 5.5 for high-volume and live jobs (inning notes, explainers, chat by default).
   - Sonnet 5.5 for recap, package and digest, using the Batch API after games end.
   - Expected bill ≈ **$25–40 a month in season** plus capped chat.
   - The port keeps Gemini Flash-Lite or gpt-5-nano a config swap away. Let a quality test, not a few dollars, decide.
   - Anthropic offers no fine-tuning, so if one is ever needed, it would be an open model trained on Together and served as a LoRA on **Workers AI**, which stays inside production's Cloudflare.
3. **Build order:**
   - **5 (package)** first: 1, 8 and later 6 read it.
   - Then **1 (recap)**, **8 (digest)**, **4 (inning notes)** and **2 (explainers)**.
   - **3 (chat)** last, gated and capped.
   - For **6 and 7**: rules and statistics now; start logging clip engagement now so an S90-style ranker can be trained after a season.
4. **Log every AI output and every owner correction from day one.** That is a free fine-tuning dataset if one is ever needed.
5. **Revisit fine-tuning only when all three hold:**
   - A written quality test (about 30–50 past games, scored) shows a cheap model failing a specific criterion that prompt examples can't fix, while a strong model passes.
   - That one task costs enough on the strong model to matter. At today's prices that would take far more traffic than BT has, roughly **$300+ a month on one narrow task**, and inning notes are the only candidate.
   - At least **500 vetted examples** exist, which the logging in step 4 provides.

   Until then, fine-tuning adds weeks of work and a model to re-train every season, for close to zero benefit.

---

# Addendum (2026-11-22): which provider? Cost and likely effectiveness

The owner chose no fine-tune and asked for "a cost comparison as well as an evaluation as to which is likely to be most effective at this category of work". All prices and pages were checked on 2026-11-22.

## A. Cost comparison

**Workload.** This is the same in-season month as above: about 450 games and about 4,500 innings. I split it by when each job runs:

| Group | Jobs | Batch? | Cache? | Tokens a month |
|---|---|---|---|---|
| **Live** | Inning notes (#4) and play explainers (#2) | No, they must be fast | Yes. About half of each prompt is the same fixed instructions and examples on every call, billed at the cache price | 27M in (13.5M of them cached), 3.15M out |
| **Postgame** | Recap (#1), package (#5), ranking and "also interesting" (#6, #7), digest (#8) | Yes, half price | No (not counted) | 9.6M in, 1.9M out |
| **Chat (#3)** | Per turn | No | Yes. The 5k-token game data pack is cached; 1k new tokens and 0.5k out per turn | Shown per turn |

Explainers (#2) are counted as live because they are written as plays finish.

**Prices used (per million tokens).** These are next season's prices. Google has announced increases: Gemini 4 Carbon and Argon double on **2026-12-01**, and Gemini 3.8 Flash doubles on **2027-01-01**. The cache column is the price of re-reading a cached prompt.

| Provider | Model | Tier | Input | Cache | Output | Batch in / out |
|---|---|---|---|---|---|---|
| Anthropic | Claude Haiku 5.5 | cheap | 0.10 | 0.01 | 0.50 | 0.05 / 0.25 |
| Anthropic | Claude Sonnet 5.5 | strong | 2.00 | 0.10 | 10.00 | 1.00 / 5.00 |
| Anthropic | Claude Opus 5.5 | top | 4.00 | 0.20 | 20.00 | 2.00 / 10.00 |
| OpenAI | gpt-6-luna | cheap | 0.10 | 0.01 | 0.50 | 0.05 / 0.25 |
| OpenAI | gpt-5.4-nano | cheap | 0.20 | 0.02 | 1.25 | 0.10 / 0.625 |
| OpenAI | gpt-6.2-sol | strong | 2.00 | 0.10 | 10.00 | 1.00 / 5.00 |
| OpenAI | gpt-6.2-astra | top | 8.00 | 0.40 | 40.00 | 4.00 / 20.00 |
| Google | Gemini 3.5 Flash-Lite | cheap | 0.30 | 0.03 | 2.50 | 0.15 / 1.25 |
| Google | Gemini 3.1 Pro (preview) | strong | 2.00 | 0.20 | 12.00 | 1.00 / 6.00 |
| Google | Gemini 4 Carbon (from Dec 2026) | top | 4.00 | 0.20 | 20.00 | 2.00 / 10.00 |
| Cloudflare Workers AI | Gemma 4 26B | cheap | 0.10 | — | 0.30 | none |

Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gemini pricing](https://aistudio.google.com/docs/pricing), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

**Discount and caching rules:**
- **Batch:** half price at all three.
- **Anthropic caching:** you opt in. A cached read costs 0.1× input (0.05× on Sonnet and Opus 5.5); writing the cache costs 1.25× for a 5-minute cache.
- **OpenAI caching:** automatic on prefixes of at least 1,024 tokens. Reads cost 0.1×; on GPT-5.6 and later, writes cost 1.25× for a 30-minute cache ([caching docs](https://developers.openai.com/api/docs/guides/prompt-caching)).
- **Google caching:** Gemini 4 caches automatically only. Older models also offer explicit caches billed for storage per hour.
- **Workers AI:** no batch or cache discount listed. The free 10,000 "neurons" a day are worth about $3 a month.

**Monthly cost in season (precompute only; chat is in the next table):**

| Provider | Cheap tier for everything | Strong tier for everything | **Best mix:** cheap for live, strong batched for postgame | Mix with the top model for postgame |
|---|---|---|---|---|
| **Anthropic** | Haiku 5.5: **$4** | Sonnet 5.5: **$79** (Opus 5.5: $158) | Haiku + Sonnet: **$22** | Haiku + Opus: $41 |
| **OpenAI** | gpt-6-luna: **$4** (gpt-5.4-nano: $9) | gpt-6.2-sol: **$79** (Astra: $315) | luna + sol: **$22** | luna + Astra: $79 |
| **Google** | 3.5 Flash-Lite: **$16** | 3.1 Pro: **$88** (4 Carbon: $158) | Flash-Lite + 3.1 Pro: **$33** | Flash-Lite + 4 Carbon: $50 |
| **Workers AI** | Gemma 4 26B: **$5** (about $2 after the free allowance) | — | Gemma for live + another provider's strong model for postgame: about $23 | — |

**Chat cost per turn, with the game data cached:**

| Model | Per turn | 2,000 turns a month | 20,000 turns a month |
|---|---|---|---|
| Haiku 5.5 / gpt-6-luna | $0.0004 | $1 | $8 |
| Gemma 4 26B (Workers AI) | $0.0008 | $2 | $15 |
| Gemini 3.5 Flash-Lite | $0.0017 | $3 | $34 |
| Sonnet 5.5 / gpt-6.2-sol | $0.0075 | $15 | $150 |
| Gemini 3.1 Pro | $0.0089 | $18 | $178 |
| Opus 5.5 / Gemini 4 Carbon | $0.015 | $30 | $300 |
| gpt-6.2-astra | $0.030 | $60 | $600 |

**Off-season** (November–February): the precompute jobs run only when games are played, so they cost $0. That leaves chat on past games, if it stays open.

**Fit with the owner's $100-a-month cap.** This assumes the best mix plus 2,000 chat turns a month on the cheap model, with hard caps on chat:

| Mix | Total | Under $100? |
|---|---|---|
| Anthropic | **≈ $23** | Yes |
| OpenAI | **≈ $23** | Yes |
| Google | **≈ $36** | Yes |
| Any "strong for everything" option | $80–90 | Only barely, and with chat on the strong model at 20,000 turns it is **over** |
| Any "top model for everything" option | $158–315 | **No** |

**Caveats:**
- **Token counts differ by provider.** Anthropic says its newer tokenizer produces about 30% more tokens for the same text, so Claude's real cost may run up to about 30% above these figures.
- **Thinking costs extra.** Reasoning or "thinking" tokens are billed as output on all three. Run these jobs at low effort, or output costs can double. Even doubled, every mix stays under the cap.

## B. Likely effectiveness for this kind of work

What BT needs: short sports text that keeps to the numbers given, follows a fixed format, picks out what mattered, reads like a beat writer, answers chat questions, and gets baseball right.

| Need | Best current evidence | What it suggests | How much weight it deserves |
|---|---|---|---|
| **Stays faithful to the source** | [Vectara hallucination leaderboard](https://github.com/vectara/hallucination-leaderboard), updated 2026-10-22: 7,700 short articles summarized, judged by Vectara's own HHEM model | Lowest error rates: gpt-5.4-nano 3.1%, Gemini 2.5 Flash-Lite 3.3%, Gemma 3 12B 4.4%, Gemma 4 26B 5.2%, gpt-6-sol 6.5%, Gemini 3.1 Flash-Lite 8.2%, gpt-6-astra 8.7%, Claude Haiku 4.5 9.8%, Claude Opus 5.5 9.9%, Gemini 3.1 Pro 10.4%, Gemini 4 Argon 12.1%. **Not tested:** Haiku 5.5, Sonnet 5.5, gpt-6-luna, gpt-6.2-sol, Gemini 3.5 Flash-Lite, Gemini 4 Carbon | **Medium.** Closest public match to the task, but the sources are news prose, not tables, and longer summaries make more claims and so score worse (Opus wrote 192 words on average, nano far fewer) |
| Faithfulness, second source | Google DeepMind's [FACTS Grounding](https://www.kaggle.com/benchmarks/google/facts) suite (launched Dec 2025) | A March 2026 newsletter reports GPT-5.2 leading the Grounding part at 76%. I couldn't read the live leaderboard and found no Claude scores | **Low.** Secondhand and incomplete, and Google runs it |
| **Fixed format** | All three providers can force output to match a JSON schema (structured output) | Format can be enforced mechanically, so it barely separates them. Public instruction-following leaderboards (IFEval/IFBench) don't list these cheap models and are close to saturated | Low as a differentiator |
| **Reads well** | Two rankings, below | Claude and GPT top models lead; Gemini 4 trails on the AI-judged ranking but ties on the human-vote one. **No cheap model appears in either** | **Low–medium.** Fiction and general chat, not sports prose |
| ↳ AI-judged short fiction | [Lech Mazur's writing benchmark](https://github.com/lechmazur/writing), updated 2026-11-17 | GPT-6.2 Astra 1st, Claude Fable 5.2 2nd, Opus 5.5 6th, Gemini 4 Carbon 19th, Argon 27th, Gemini 3.8 Flash 34th, Gemma 4 31B 55th of 67 | |
| ↳ Human votes | LMArena creative writing (reported for 2026-10-27; [arena.ai](https://arena.ai/leaderboard/text/creative-writing)) | Claude Opus 5.5 1st (1520), Gemini 4 Argon a statistical tie in 2nd | Secondhand; the official page I reached showed an August snapshot |
| **Picks what mattered; sports data-to-text** | Academic only: [Sundararajan et al., INLG 2025](https://arxiv.org/html/2510.21034v2) (NBA play-by-play summaries); SportsMetrics (2024) | Feeding *structured* data improves factual accuracy, but errors remain common and need checking. **No study compares current models on baseball** | **Thin.** It supports BT's design (computed facts, then a checker) more than any provider |
| **Chat over a game** | No game-specific public benchmark. Inputs are 2–20k tokens, which every model here handles easily | Not a differentiator | — |
| **Baseball rules and situations** | No benchmark found | Unknown. Only BT's own test can show it | **None** |

**Plain summary:**
- **Faithfulness:** OpenAI's small models and Google's older Flash-Lite line have the best *measured* faithfulness scores. Anthropic's current small and mid models simply haven't been measured.
- **Writing:** OpenAI's and Anthropic's top models lead.
- **Google 4.x:** neither measurement favors it, and its prices double before next season.
- **Workers AI's Gemma:** faithful in short summaries but ranks low as a writer, so at most it is a candidate for terse inning notes.
- **Overall:** most public evidence is about models or tasks next to BT's rather than BT's own, and none of it covers baseball.

## C. Ranking for BT (cost and effectiveness together)

| Rank | Mix | In-season cost | Why | Confidence |
|---|---|---|---|---|
| 1 (tie) | **OpenAI:** gpt-6-luna live, gpt-6.2-sol postgame (gpt-5.4-nano as a live alternative) | ≈ $22 + chat | Same price as Anthropic. Best measured faithfulness among strong models (gpt-6-sol 6.5%) and at the cheap tier (nano 3.1%). Astra is the top writer if ever needed, but too costly for the cap | Low–medium |
| 1 (tie) | **Anthropic:** Haiku 5.5 live, Sonnet 5.5 postgame | ≈ $22 + chat (up to ~30% more, tokenizer) | Same price. Opus 5.5 is at or near the top for writing by human vote. Measured faithfulness for Claude is mid-pack (Opus 9.9%, with long summaries), and Haiku and Sonnet 5.5 are unmeasured. BT's planning and code tools are already Claude-based, though that doesn't matter at runtime | Low–medium |
| 3 | **Google:** 3.5 Flash-Lite live, 3.1 Pro postgame | ≈ $33 + chat | Costs more. Gemini 4 is weaker on the writing ranking and has the worst measured faithfulness of the strong models (Argon 12.1%). Prices are rising. 3.1 Pro is still a preview | Medium |
| 4 | **Workers AI Gemma 4 26B**, live jobs only | ≈ $2–5 | Cheapest, runs inside Cloudflare, good short-summary faithfulness. Weak writer, so worth testing only for inning notes | Medium for "only as a live-job helper" |

**Bottom line:** on public evidence, OpenAI and Anthropic can't be told apart, and Google is a step behind for this work. The cost difference between the top two is zero. **BT's own test should decide.** In fairness: this report was written by a Claude model, which is another reason the owner's preference test must be blind.

## D. The quality test that settles it (for the first AI story)

**Games.** Use 40 finished games, BT-stored or recorded:
- A deliberate mix: blowouts, one-run games, walk-offs, extra innings, a no-hit or perfect-game bid, a rain-shortened game, 5 postseason games, and games with ABS challenges.
- Recording: the repo's `fixtures/` holds only 3–4 games today, so the story records the rest (`BT_USE_LIVE_MLB=1`) or exports them from the stage database. Each saved game pack stays frozen, so every model sees byte-identical input.

**Candidates.** Up to 9 models: Haiku 5.5, Sonnet 5.5, Opus 5.5, gpt-6-luna, gpt-5.4-nano, gpt-6.2-sol, Gemini 3.5 Flash-Lite, Gemini 3.1 Pro, and Gemma 4 26B on Workers AI.
- One shared prompt and one JSON output schema per job, sent through the AI port, with only the provider adapter changing.
- Low effort or thinking, and temperature at its default.

**Jobs per game:** 1 recap, 1 package headline and narrative, 3 inning-notes calls (chosen innings), 3 play explainers, and 5 chat questions from a fixed set. Plus 5 day digests.

The chat set:
- 3 with answers BT can compute exactly (e.g. "How many pitches did the starter throw?")
- 1 rules or situation question (e.g. "Why was that run unearned?")
- 1 the data can't answer, where the correct reply is "I don't have that"

**Scoring.** Every item is mechanical except owner preference.

| # | Measure | How | Bar a model must clear |
|---|---|---|---|
| 1 | **Factual errors** | The automatic checker pulls out every number, player name, team, inning and count from each output and compares it with the game pack. Claims it can't check by rule (e.g. "the go-ahead hit") go to a judge model from a provider *other than* the one being tested, and the owner spot-checks 10% | ≤ 1 unsupported claim per 100 claims, and ≥ 95% of outputs with zero |
| 2 | **Format** | Output matches the schema and length limits (one retry allowed) | 100% after retry |
| 3 | **Picked what mattered** | The recap or package mentions the game's top 3 plays by win probability added | ≥ 90% of games |
| 4 | **Chat accuracy** | Exact match on the computed answers; correct "don't know" on the unanswerable one | ≥ 90% correct, ≥ 90% correct "don't know" |
| 5 | **Baseball correctness** | Rule questions, plus owner flags during the blind review | No rule error the owner flags in more than 1 of 40 games |
| 6 | **Owner's blind preference** | Only models that pass measures 1–5, up to 4 finalists. 20 games' recaps shown in pairs, labels hidden, order random; record each model's win rate | Highest win rate wins |
| 7 | **Projected cost and speed** | From each call's reported usage, scaled to BT's season volume plus 2,000 chat turns | Projected month ≤ $100; live jobs ≤ 10 s |

**Decision rule.** Pick the model with the highest blind win rate that passes measures 1–5 and 7. If a cheap model passes and loses to a strong one by less than 10 points of win rate, use the cheap one for that job.

**Cost to run:**
- **Models:** each makes about 2.6M input and 0.3M output tokens. That is under $1 for the cheap tier, about $8 for the strong tier, about $16 for Opus, and about $32 for Astra.
- **Judges:** cross-provider judging of every output is about $30–50.
- **Total: about $100–150 in API fees.**
- **Owner time:** about 2–4 hours for 20 games × up to 6 finalist pairs.

**Make it repeatable.** Make it one script with frozen inputs, so the same test can be re-run for about $10–50 whenever a new model or price change comes out.
