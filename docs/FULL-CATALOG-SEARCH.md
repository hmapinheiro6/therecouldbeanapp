# Search checks against the exported catalog

The earlier benchmark restores 45 curated seeds. It remains useful for its original judgments, but it does not describe search across the expanded catalog. This additional suite restores all **2,785 published products** from the 16 November public export, applies the normal migrations, rebuilds FTS5, and runs the deployed 80-candidate retrieval SQL locally. It separately exercises the browser's saved-catalog search.

Run it without contacting production:

```sh
node --import tsx scripts/benchmark-full-catalog.ts
npm test -- tests/search/full-catalog.test.ts
```

The reusable `fullCatalogDatabase()` helper uses `scripts/restore-snapshot.py`, a private temporary SQL file and an in-memory database. It restores real source associations, aliases, evidence and verification scopes. No synthetic records or production writes are involved.

## Judgments and results

`data/full-catalog-search.json` contains 40 engineering regression judgments: 15 names/aliases, 10 capability or misspelling queries, eight description-based discovery queries, five unsupported requirements and two no-match ideas. Names and aliases are judged against the saved names/aliases. Feature expectations use saved verified claims. Discovery expectations use licensed directory descriptions and must remain related products; those descriptions do not establish verified capabilities.

| Measure | SQLite before | SQLite after | Saved catalog before | Saved catalog after |
| --- | ---: | ---: | ---: | ---: |
| Passing query cases | 37/40 | 40/40 | 33/40 | 40/40 |
| Name or alias first | 13/15 | 15/15 | 9/15 | 15/15 |
| Cases with a judged expected result in top ten | 32/33 | 33/33 | 27/33 | 33/33 |

Before/after records, individual results and local timings are in `full-catalog-search-baseline.json` and `full-catalog-search-results.json`. These are **a small, single-author regression sample**, not comprehensive catalog precision, market recall, a blind relevance study, provider-billed reads or deployed Worker CPU measurements. Expected-product lists deliberately remain incomplete. Passing all cases must not be advertised as 100% relevance.

## Fixes supported by these checks

- Preserve Unicode letters and numbers during normalization so the catalog's Chinese product name can be found.
- Include saved public name aliases in ranking. Alias-only results such as P4Merge, WaveTerm, PixCake and KekaDefaultApp previously disappeared in saved-catalog search because retrieval found them but ranking assigned zero. Alias phrase matches now outrank incidental words such as “desktop edition.” Alias matches remain related unless independent verified capabilities support a stronger classification.
- Require at least two lexical words for unrecognized ideas with three or more tokens, unless a catalog name/alias or verified feature matches. A translator sharing one word with “quantum telepathy dolphin translator” is no longer presented as a useful related product. The five unsupported-requirement cases still withhold strong matches.

The saved catalog and SQLite intentionally use different candidate retrieval methods. They share conservative evidence-aware ranking. The benchmark covers both instead of assuming their results are identical. Most published entries still have identity evidence only; better ranking cannot replace additional verified feature evidence. Broader independent judgments, live post-reset measurements and review of more long-tail queries remain useful next steps.
