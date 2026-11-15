# Search

`src/lib/search/query.ts` normalizes case, whitespace, punctuation, diacritics, and common misspellings, strips conversational filler for retrieval, preserves negation, detects audience/qualifiers, and maps maintained aliases to 38 capability concepts across 37 categories. SQLite's Porter tokenizer handles retrieval stemming; alias forms explicitly cover common plurals. Bare “pipeline” does not expand into a CRM or CI capability.

`worker/catalog.ts` materializes an FTS5 candidate query before joining canonical tables. This is intentional: a direct join allowed SQLite to drive from the publication-status index and repeat FTS scans. The materialized rank scan reduces local synthetic 10,000-record latency from seconds to single-digit milliseconds in the measured run.

FTS weights are name 6, description 1, category 2, verified capabilities 5, audience 2, aliases 3. A maximum of 80 candidates is hydrated in one additional indexed query. Input tokens become quoted FTS terms; the whole expression is a bound SQL parameter.

Reranking is explicit in `src/lib/search/rank.ts`: capability coverage ×100, minus missing capability count ×20, bounded BM25 contribution ×6, exact product name +130, phrase +15, audience +8, category +5, bounded lexical overlap. Products supporting explicitly excluded capabilities are filtered out. Capability evidence quality is separate from lexical score: only verified evidence participates in coverage. Scores are internal ranking weights, never percentages.

Strong labels require full recognized capability coverage and no unresolved explicit qualifier or audience, or an exact product-name lookup. Partial means some evidenced capability coverage. Related means credible lexical relevance with no supported core overlap. Missing functionality is described as “could not be verified,” not as an established absence. Numeric score fields are internal ordering information, not calibrated confidence.

## Evaluation

`data/benchmark.json` contains 60 manually authored cases: straightforward categories, conversational inputs, multi-capability combinations, industries, product names, ambiguous pipelines, misspellings, negation, qualifiers, and unusual uncovered ideas. Judgments were authored separately from ranked outputs. `data/ground-truth-sources.json` records secondary official feature pages for four independently source-checked products. This is a single-author engineering benchmark, not a blind assessment by independent people.

Run `npm run benchmark`; real results and per-query outputs are in `benchmark-results.json`. Precision over returned slots divides by `min(5, returned)`; this avoids calling a single supported niche result imprecise for failing to invent four more. The report states that definition. Recall is limited to manually known relevant products present in the catalog. Missing catalog coverage is reported separately. These results are optimistic for vocabulary represented in the taxonomy and must not be generalized to arbitrary ideas.

Capacity checks insert 1,000 and 10,000 explicitly synthetic lexical copies inside rolled-back transactions. They never enter the published catalog or snapshots. Local SQLite/Node latency and CPU do **not** establish production Worker CPU, network latency, or D1 billable reads. The deployed Worker logs retrieval row reads, bounded result counts, and wall time without raw query text. Use Cloudflare invocation CPU metrics to validate the 10ms free allowance before opening traffic.

## Remaining search limitations

A 45-product catalog cannot represent all 37 categories well. Unsupported industries and unusual requests often have no strong match. Complex mixed negations, unknown audiences outside the maintained list, semantic phrasing not in the dictionary, and requirements such as deployment mode/pricing need more explicit taxonomy support. Evidence extraction recognizes public feature claims, not hands-on functionality. Expansion must stay conservative.

To add synonyms, edit `data/synonyms.json`, add adversarial benchmark cases, and run tests/benchmark. To add a capability, add its taxonomy JSON entry, migrate/seed the vocabulary, add source-backed product evidence, then evaluate. Never add a tag solely to make a benchmark pass.
