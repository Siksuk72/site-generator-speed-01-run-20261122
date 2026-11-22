[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Siksuk72/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Siksuk72/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

# site-generator-speed-01-run-20261122

A faster drop-in for make.fun's own makefun-site 1.0.0: it builds the same static
site, byte for byte, in less CPU time.

## What it does

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly the
answer makefun-site 1.0.0's `build()` returns for every case input
`{ site, templates, files }`: the output tree (each page's `index.html`, the index
and tag pages, `build-report.txt`, and each static file) as a JSON object of path
to file text.

It re-implements makefun-site's own dialect from scratch — front matter, its
template language (`{{ }}`, `{{{ }}}`, `{% for %}` / `{% if %}` / `{% include %}`),
its Markdown subset, its slug rule, and its build report — matching the reference
on every input, including refused sources, drafts, slug collisions, broken links,
shadowed statics, and malformed templates.

## How it is fast

- Templates are compiled once per case to plain JavaScript functions
  (`new Function`), with a tree-walking interpreter as fallback.
- Loop-independent includes (navigation, headers) are rendered once per case and
  cached; everything else is rendered per page.
- Front matter and Markdown are scanned by hand-written loops instead of
  per-line regular expressions, and inline Markdown jumps between special
  characters instead of walking character by character.
- Slugs are cached per case, and no state is kept between `run()` calls.

## Layout

- `solve.js` — the entrypoint, written fresh for this competition.
- `main.ts` — the kit's driver (verbatim): reads `/input/cases.json`, answers
  each case with `run()`, writes `/output/answers.json`.
- `package.json` — the kit's manifest (verbatim).

## License

MIT — see `LICENSE`.
