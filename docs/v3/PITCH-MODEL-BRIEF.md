<!-- Committed 2026-11-22 from the owner's brief, pasted into the session that wrote S90's phases (S90, S186–S190); kept verbatim. -->

# Baseball Predictive Modeling System — Project Brief, Technical Direction, and Research Handoff

(The owner's brief, pasted into the session on 2026-11-22 as "a summary of a conversation I had with ChatGPT for a more robust AI training project". Kept verbatim in substance; headings as given.)

## 1. Project Overview

I want to develop a machine-learning system capable of learning from approximately ten years of detailed historical baseball data and predicting what is likely to happen next during an active game.

The initial application is probabilistic, pitch-by-pitch prediction. Given the current state of a baseball game and the sequence of events preceding it, the system should predict the next pitch and potentially several characteristics and outcomes associated with it.

My longer-term ambition is a system that discovers subtle predictive relationships in baseball data, including relationships that human analysts might not have anticipated.

I am an experienced software engineer but am relatively unfamiliar with machine-learning training architectures and workflows. I want to develop the system experimentally, starting with a simple, inexpensive implementation and progressively introducing more sophisticated approaches.

I do not want to commit prematurely to a particular model architecture, representation of historical context, or set of manually engineered features.

The system should be designed to accommodate experimentation and comparison between fundamentally different modeling strategies.

## 2. Available Data

I have approximately ten years of baseball data, potentially covering every pitch and many additional events in every game.

The pitch-level information is extremely detailed and includes measurements such as: pitch type and classification; pitch velocity; initial pitch location or release position; final pitch location, including precise coordinates; horizontal and vertical pitch movement or break; batter strike-zone dimensions; the results of pitches and associated game events; historical game states and accumulated statistics.

Additional contextual information, such as pitcher identity, batter identity, handedness, inning, count, and other game circumstances, may be available in the reconstructed game state.

The exact schema and completeness of individual fields still need to be inspected.

### Data representation

An important characteristic is that the source data may not consist of one discrete record per baseball event. Instead, it appears to represent evolving game states and updates over time.

The historical data includes final accumulated game state and the changes that occurred throughout the game. These changes may take the form of patches, batched updates, state differences, or similar structures. For example, a period containing several pitches and other events might be represented by one update containing multiple changes, rather than separate updates for every occurrence.

The goal is to reconstruct historical game states and extract as much ordered event history as the source data actually preserves.

Do not assume that raw update boundaries correspond to individual baseball events.

A critical early investigation is determining whether the update format preserves individual events and their ordering, even when multiple events arrive in a single batch.

If intermediate events are genuinely lost, the training pipeline must account for that uncertainty rather than inventing missing history.

### Data scale

If the dataset covers the full MLB schedule, ten years represents roughly 6–7 million pitches, with additional non-pitch events. The raw dataset may be considerably larger depending on how game states, updates, and measurements are represented. This is substantial but manageable for conventional machine-learning techniques.

## 3. Core Prediction Objective

The system should learn a probability distribution for the next observable event, conditioned on the current game state and relevant historical context. Conceptually: P(next event | current state, historical events).

For example, a pitcher throws a fastball down and inside. Given everything known at that moment, the system might conclude that the next pitch is most likely to be a fastball up and away, with a curveball down and away as another plausible possibility. However, those probabilities should depend on much more than the immediately preceding pitch. Potentially relevant information includes the pitcher's repertoire, historical tendencies, the batter, handedness, count, game situation, earlier sequences, and previous encounters between those players.

The system should learn these relationships statistically wherever possible instead of relying on explicitly programmed baseball heuristics.

### Observed versus intended behavior

The historical data describes what actually happened, not necessarily what the players intended. A pitcher might attempt to throw one type of pitch in one location but execute it differently. Therefore, the initial prediction target is the actual observed pitch, including execution variability, rather than an unobserved intended pitch. The model does not need to infer intention to be useful.

## 4. Training Examples and Sequential State

The historical data should be processed chronologically. For each recoverable pitch:

1. Reconstruct the game state immediately before the pitch.
2. Capture the historical context available at that point.
3. Use the pitch that actually followed as the training target.
4. Apply the resulting event or events to advance the game state.
5. Repeat for the next pitch.

An individual training example therefore consists of a pre-pitch state, historical context, and known subsequent outcome. Neighboring examples will often be extremely similar because only a small amount of information changes between pitches. This is expected and appropriate for sequential prediction. The model is learning how the probability of the next event changes as the game evolves. Training records are not statistically independent, so both model design and evaluation need to account for their temporal relationships.

### State reconstruction

A replay-based preprocessing pipeline is desirable. It should maintain game state while consuming historical updates and produce training examples at valid prediction points. Where possible, the same state-reconstruction logic should support both historical training and live inference. This reduces discrepancies between what the model encounters during training and what it receives during actual use.

## 5. Historical Context: An Essential Design Goal

A central objective is to let the model discover which earlier events are relevant to the next prediction. I do not want to assume that only the most recent events matter. For example, the probability of a particular pitch might depend on: the immediately preceding pitch; a sequence from earlier in the current at-bat; something that happened three innings ago; the pitcher's behavior against a particular batter earlier in the game; a tendency established across previous appearances or games; interactions among several events separated by considerable time.

An event that occurred hours ago could conceivably be more predictive than something that happened ten seconds ago. Historical relevance is not necessarily the same as recency. This is one reason I am interested in models capable of learning from ordered sequences rather than relying exclusively on manually calculated statistics.

### Multiple historical windows

An interesting extension is providing several different historical contexts simultaneously, e.g.: the previous 5 events in the current game; the previous 25 events; the previous 100 events; previous events involving the current pitcher; previous encounters between the pitcher and batter; a longer record of the pitcher's historical behavior. These are conceptual examples, not predetermined window sizes.

Importantly, I am interested in providing the actual ordered events within these windows, including their underlying measurements and circumstances, rather than only summary statistics such as fastball percentages. The model could then learn which relationships and historical timescales are predictive. The windows need not be mutually exclusive. Some may overlap, while others may select events according to relationships such as shared pitcher or batter identity.

An initial prototype should use one simple historical window. Multiple contexts can be introduced later as experiments.

### Possible sequence-model architectures

Transformer-based sequence models are particularly interesting because attention mechanisms can learn dependencies between events at different positions in a sequence. A possible future architecture could combine: detailed recent event history; broader current-game event history; relevant historical events from prior games; current game-state information. A hierarchical or multi-context architecture could be useful if processing large amounts of event history in one sequence becomes computationally inefficient. However, attention mechanisms do not guarantee that distant dependencies will be discovered. Architecture, data representation, training scale, and evaluation still matter. These are research directions, not requirements for the first version.

## 6. Predicting Multiple Targets

Potential targets: pitch type (categorical probability distribution); pitch location (continuous spatial distribution); pitch velocity (continuous distribution); horizontal and vertical movement (continuous or joint distribution); pitch result (categorical probability distribution); subsequent game outcome (possible longer-term extension). The system should ideally support probabilistic predictions rather than only point estimates.

### Multi-output approaches

- Independent models: separate predictors per target using shared inputs. Straightforward, but predictions might be mutually inconsistent.
- Multi-task models: a shared learned representation of state and history, with separate prediction heads.
- Conditional or joint probabilistic models: predict related characteristics conditionally so generated outcomes remain plausible — e.g. (1) distribution of pitch types, (2) condition on a type, (3) predict location, velocity and movement preserving their relationships, (4) potentially predict the result conditioned on those and batter context. The precise factorization should be evaluated rather than assumed.

One longer-term possibility is sampling from these distributions to generate a coherent simulated next pitch, then advancing the state and continuing — eventually simulating at-bats or games, though reliable multi-step simulation introduces additional challenges. The initial implementation should focus on a small number of well-defined targets.

## 7. Learning Individual Player Tendencies

The model should account for individual pitchers' and batters' capabilities and tendencies — e.g. learn that a pitcher predominantly throws fastballs, sliders and changeups, and which selections are likelier in which situations — without manually encoding every repertoire as rules. Approaches: player identifiers, historical player-specific sequences, learned player representations, contextual features derived from previous observations.

Generalization: some pitchers have thousands of pitches, rookies very few. A useful model combines individual tendencies with broader patterns across players, and accommodates pitchers adding pitches or changing repertoire over time. Hard restrictions against historically unseen pitch types may be undesirable; a probabilistic approach with handling of rare or unknown possibilities is preferable. Player histories must always be constructed using information available before the prediction point.

## 8. Raw Data Versus Feature Engineering

Engineered features (e.g. a pitcher's recent fastball velocity vs. long-term average) can improve data efficiency but introduce human assumptions and change what the model learns, potentially steering it toward anticipated relationships rather than subtle unforeseen ones. The goal is to investigate how much predictive structure can be discovered directly from the underlying event sequences. Extensive manual feature engineering is not a mandatory prerequisite.

Preferred approach: maintain a raw-sequence-based modeling approach as an ongoing experimental baseline — the original ordered event measurements and context encoded into a model-compatible representation, rather than preselected statistical summaries. Basic preprocessing (missing values, categorical encoding, scaling, order, temporal relationships) is unavoidable and distinct from choosing baseball-derived statistics in advance. Feature engineering should be introduced as an experiment. Comparisons: raw inputs only; raw inputs augmented with engineered features; engineered-feature-oriented models — accounting for differences in capacity, compute and representation (a raw sequence model and a gradient-boosted tree are not automatically controlled comparisons). The goal is not to reject feature engineering but to evaluate whether it materially improves prediction without prematurely constraining the search.

## 9. Automated Feature Discovery

A system could: inspect schema and targets; generate candidate transformations, aggregations, comparisons and temporal relationships; compute them; train with different candidate sets; evaluate contribution; keep promising ones. Tools: Featuretools, tsfresh, other AutoML. An LLM-based agent could propose transformations, generate code, run experiments and interpret results — a good use of an LLM in the workflow, though not as the core numerical predictor. Must be rigorously constrained against future information; hundreds or thousands of candidates create overfitting, excessive experimentation and selection-bias risks. The raw-data baseline should remain available for comparison.

## 10. Candidate Model Architectures

- **A. Gradient-boosted trees** (LightGBM, XGBoost): cheap to train, strong on structured data, millions of examples, usually no GPU, good initial benchmarks; limitations: fixed-dimensional inputs, no inherent understanding of arbitrary-length sequences (history via fixed positional inputs or aggregates). A simple implementation could flatten the previous few events alongside current state — a reasonable initial baseline.
- **B. Sequence models** (causal Transformers, RNNs, other temporal architectures): represent ordered histories directly, learn relationships at different positions, reduce reliance on handcrafted summaries, shared representations for multiple targets; challenges: more complex pipelines, GPU needs, sequence-length compute and memory, no guarantee of learning every relationship, overfitting risk.
- **C. Hybrid and conditional approaches**: sequence encoders + current-state feature models + player representations + conditional heads. An extension, not an initial requirement.
- **D. Large language models**: fine-tuning a text LLM is not the preferred initial approach. LLMs may help propose features, design experiments, write code, analyze results, or orchestrate an automated research workflow.

## 11. Experimental Development Strategy

- **Phase 1 — Understand and reconstruct the data:** inspect samples; determine how states, changes, batches, timestamps and ordered events are represented; build a replay mechanism that reconstructs state and extracts valid pre-pitch observations; verify against final results and consistency checks; identify incomplete or ambiguous portions.
- **Phase 2 — Minimal training pipeline:** current state + one short window of recent ordered pitches/events + one target (next pitch type); chronological examples; a straightforward baseline and a practical first ML implementation. Purpose: an end-to-end working system.
- **Phase 3 — Reliable evaluation:** a consistent benchmark on later, unseen games; measure predictive quality and calibration, not only top-1 accuracy; compare against league-wide and pitcher-specific frequencies; preserve evaluation datasets and experiment configurations.
- **Phase 4 — Richer history:** longer windows, multiple windows, overlapping contexts, relationship-selected events; do sequence models beat simpler approaches.
- **Phase 5 — More targets:** location, velocity, movement, outcomes; independent vs multi-task vs conditional/joint; coherence and calibration.
- **Phase 6 — Feature discovery:** automated candidate generation; raw-sequence vs augmented, under controlled experiments.
- **Phase 7 — Live prediction and possible simulation:** run on an active game, evolving state as updates arrive, predictions at valid pitch boundaries using only current information; later sampled next-event generation and multi-step simulation if quality justifies it.

The roadmap is deliberately flexible; phases can overlap and experiments may be abandoned.

## 12. Evaluation and Technical Risks

Temporal data leakage (only information available at the prediction moment); train/test contamination (hold out whole games chronologically); probability quality (log loss, calibration, distributional metrics — accuracy is insufficient); sequence representation (longer history must justify its cost); player sparsity and changing behavior; dataset consistency across ten years (pitch classification, tracking technology, rules, measurements); reconstruction uncertainty (only generate examples at points the data supports); multi-target consistency; model complexity justified by measured improvement; evaluation overfitting (a development validation process and a final untouched evaluation period).

## 13. Compute Requirements and Budget

No dependence on local computing hardware; cloud preprocessing, training and inference should be supported. Conventional ML should be affordable at this scale. A CPU baseline of ~8 vCPUs / 32 GB RAM is a plausible start. A small initial experimentation budget of perhaps $25–$50 is reasonable to investigate (a planning estimate). Free hosted notebooks may suit smaller experiments. Preprocessing, data movement, repeated experiments and memory may be bigger constraints than training compact GBMs. Transformers could need GPUs and materially more compute. Training cost and inference cost may differ substantially. Accurate estimates should follow inspection of actual dataset size, representation, architecture, batch size and hardware. Begin inexpensively; scale only when experiments justify it.

## 14. Software Architecture Principles

Clear separation between: (1) raw data ingestion (not assuming updates are individual events); (2) state reconstruction; (3) event extraction; (4) training example generation; (5) input representation per architecture; (6) model training with reproducible configurations; (7) evaluation against fixed benchmarks and baselines; (8) live inference with the same causal state and history representations. Feature engineering is an optional, configurable part of input preparation. Historical window definitions are configurable. Different architectures train against the same underlying history without rewriting reconstruction; new targets don't require redesigning ingestion.

## 15. Important Open Questions

Exact update format and how reliably individual events can be recovered; which state fields are available before each pitch; how to encode event histories for raw-sequence models; the simplest fair baseline; how much ordered history improves over current state alone; benefit of longer histories and multiple contexts; whether a sequence model can discover long-range relationships without engineered summaries; how to combine pitcher-specific, batter-specific and league patterns; which multi-target architecture best preserves coherent distributions; whether automated feature discovery beats a raw-sequence baseline; actual training time, memory and cloud costs per approach. To be answered through inspection, prototyping and measured experiments.

## 16. Guiding Philosophy

Learn predictive relationships from baseball history, not encode an existing human interpretation of baseball. Give the ML process the opportunity to discover non-obvious relationships — not rejecting domain knowledge or feature engineering, but treating them as tools whose value is demonstrated experimentally. Start small, preserve access to the original event data, develop through reproducible experiments. The final architecture may be a sequence model, a structured-data model, a hybrid or something else; performance, generalization, calibration, complexity and cost decide.

## 17. Instructions for the Next Agent

Assume research and early-architecture phase; nothing finalized. Prioritize practical, incremental implementation. Do not default to fine-tuning a conventional LLM. Do not assume manually engineered statistics are required before training can begin. Do not assume raw updates correspond one-to-one with pitches. Keep raw-sequence learning and discovery of unexpected temporal relationships central. When recommending an architecture, explain what it can learn directly, what representation it needs, what it costs, and how its value can be tested. The next concrete step: inspect representative source data, confirm how ordered pitch histories and game states can be recovered, and design the smallest useful training experiment. Build a flexible foundation that lets increasingly sophisticated approaches compete on measured predictive performance.
