# Subscription-backed scoring: research status

The `--local-provider` modes in this fork are an experiment. They are not
transport replacements for Jev. Jev's evaluation model returns boolean
probabilities; the local modes ask a general coding model to write numeric
scores. Retrieval uses the Jev-tuned `> 0.5`, `>= 0.6`, and `> 0.7` boundaries
for navigation and source selection. A syntactically valid local score does not
establish that those boundaries mean the same thing. `jg doctor` checks only one
synthetic response. Do not install this branch as the default toolbox command or
use the upstream benchmark claims for it.

## What the first pilot established

One dashboard question was run with `jg` backed by Kilo's
`openai/gpt-6-luna-fast` model and with a normal Codex CLI search. The search
roots, models, output contracts, and measurement boundaries differed. The fork
also changed during the pilot. Its timings and token counts diagnose the
adapter but cannot establish a product comparison. In that run, local scoring
omitted question IDs, sometimes emitted more than one text answer, and exhausted
a 24-call limit before retrieving the main policy builder. Batching and final
answer parsing now have regression tests; relevance quality is still unknown.

## Provider contract to resolve

Choose one explicit design before another paid evaluation:

1. Keep Jev's probability-based retrieval and use only a backend that supplies
   comparable probabilities. A subscription CLI prompt has not demonstrated
   this contract.
2. Build a separate generative-model retrieval policy with explicit categorical
   decisions (`yes`, `no`, `unknown`), failure handling, and thresholds tested
   for those decisions. Keep its cache identity and benchmark claims separate
   from Jev's. A direct subscription API can remove agent-harness overhead, but
   it does not itself solve relevance calibration.

The current branch is option 2's transport and parsing probe, not a complete
implementation of that policy.

## Next evaluation

First validate a frozen scorer on saved, labeled navigation and source packets,
including relevant files, misleading filenames, negative examples, and large
question groups. Report every malformed or incomplete answer, provider call,
token count, and missed relevant source. Do not tune on the confirmation set.

Then follow [the product evaluation protocol](../evals/README.md): one frozen
repository snapshot, task, Codex model, harness, and answer or patch contract.
Compare the same Codex workflow with and without initial Jevgrep use, allowing
ordinary follow-up search in both arms. Keep the first baseline; do not rerun it
to improve a comparison. Report task completion, source evidence, total Codex
usage, local-scorer usage, known charges, and incomplete searches separately.
One personal-repository question is a pilot, not an acceptance result.
