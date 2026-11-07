# Competitors — a proposal to raise coverage without lowering precision

Status: a proposal, not code (owner, 2026-11-06). To be started after Phase 1.

## Why

The strict rule — a primary source says, in a sentence that links both companies, that they compete — keeps precision high (the tracker: 12 of 13 counted marks correct) and yields almost nothing: 0 competitors in the 30 companies of review run 5, 1 in the four runs before it, 14 names in the 56 golden companies. A field that is empty in practice does not serve a user. The question is where more *true* competitors can be found with the same standard of evidence, and whether a second, honestly weaker tier is worth showing.

## A. More evidence at the same standard ("declared competitor")

1. **"X vs Y" pages on the company's own site.** The company itself names the rival: a page whose title or heading names both ("Port vs Backstage"). Found by `site:<own domain> vs` and the site's sitemap. The standing rule against a row of links stays: the page's own title or heading counts, never a menu.
2. **"X vs Y" pages on the competitor's site.** The rival declares the overlap ("Rippling vs HiBob"). Needs the competitor's domain, which the model's candidate supplies; counted as evidence only when the page's title or heading names both.
3. **"Rival" / "competes with" sentences in the round articles already read.** No new search: the funding articles v2 already fetched hold most such sentences ("a European rival to Anduril"). Today the market extraction reads them but few survive; a pass over the funding articles that asks only for such sentences, kept to the direct-link rule (the company and the rival with a competing word between them), costs one call, not a search.
4. **Public companies' filings.** A 10-K / 20-F "Competition" section names the rivals in the company's own words. Primary, free, and explicit.

Each is judged by the rule that exists (primary source, direct link, not a listing), so the precision bar stays the tracker's: at least 20 marks, at least 90%.

## B. On demand, not in the bulk run

Competitors are a field people look at for one company at a time. Generate them when a company is opened or checked, with a small search budget (3–5 searches, cached for 30 days, the existing search cache), instead of in every bulk run:
- the bulk run stays cheap and its numbers stay comparable;
- the budget goes to the companies users look at;
- a result carries its source and quote like any other field, so the owner's marking applies unchanged.

Cost is per opened company, not per row of the database. To be decided with the owner: whether the result is stored (and refreshed after 30 days) or shown once.

## C. A middle path: the model proposes, a source verifies, two tiers

1. **The model proposes candidates as hints** — from the market section and its knowledge of the sector — never shown as they are.
2. **Each candidate is verified in an allowed source that shows both companies in the same market**: one article of tiers 1–3, one filing, or the company's or the candidate's own pages, naming both in one paragraph with a market or competition word. Listicles, "alternatives" pages, directories and data platforms stay denied.
3. **Two tiers, shown differently:**
   - **Declared competitor** — an explicit statement that they compete (section A's evidence, today's rule). Shown as "Competes with".
   - **Market competitor** — both named in the same market by an allowed source, without a statement that they compete. Shown as "Also in this market", behind the declared ones.
4. **Measured apart.** Two fields in the tracker: `competitor` (declared, bar 90%) and `market_peer` (bar to set with the owner, suggested 80%, since the claim is weaker). A tier opens for writing only when its own field opens; either can stay closed.

## How to know it works

Run each approach on the 56 golden companies and on 30 random ones and count, per company, the competitors found and the share the owner marks right:
- coverage: competitors per company, and the share of companies with at least one;
- precision: marks, as today.

The v1 sample (`eval/v1_competitors_sheet.ts`, 30 random companies, up to 3 competitors each) gives the baseline: v1 wrote competitors from the model's reading of search results with no stored source and no quote check. Its measured precision tells how far candidate hints can be trusted before verification, and what verification must add.

Nothing in this proposal lowers the bar for a competitor to be *written*: the weaker tier is a different, labelled field with its own bar.
