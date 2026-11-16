# Token Radar — build the best token launch radar

A program plus the dashboard it writes. `main.ts` (Node 22, standard library only)
reads the sealed DefiLlama snapshot at `/input/snapshot.json`, ranks every pre-token
protocol by an implied value, and writes the board, the dashboard data, the dashboard
itself, three screenshots and the dossier to `/output`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## What it ranks

The snapshot holds 758 protocols at or above $5M of TVL; 40 of them are on the
house watchlist (at least $50M of TVL, no token recorded, not a wrapped, staked or
bridged product of a token that trades). The board ranks 198 rows:

| Tier | Rows | Meaning |
| --- | --- | --- |
| watchlist | 40 | On the snapshot's own watchlist. |
| early | 158 | Matches the watchlist rule on the fields the snapshot carries, but not on the house list (138 below the floor, 20 above it). |

91 more pre-token protocols form a **long tail** that is scored with the same
model and shown below the board, but never ranked in it: each is a bridge,
liquid-staking or wrapped/staked product of a token that already trades, flagged
with the reason. Ranking them would put WBTC and the big bridges at the top of
the board on TVL alone — exactly the confusion the snapshot's own guide warns
against ("a wrapped or staked product of a token that already trades is not a
token that does not exist yet").

53 more pre-token records are set aside entirely (exchange tokens and versioned
pools) and the dashboard says so. Live-token protocols are never ranked; the
dashboard shows the top 40 by market cap in a separate view, with the market's own
values.

## The valuation model (radar-2)

Implied value follows only from the snapshot's own figures. The one number that is
not a constant is the **category multiple**, and it is read off the snapshot itself:

- For each category, take the median market-cap-to-TVL ratio of its live-token
  protocols, then shrink it toward the global median (0.223) with a prior of five
  protocols: `mult = (n × med_cat + 5 × 0.223) / (n + 5)`.
- Categories with fewer than 4 live-token protocols take the global median outright.
- Every multiple is clamped to [0.05, 1.25].

Then, per protocol:

```
growth    = clamp(change_7d, -60, +120) per cent
growthMult   = 1 + (growth / 100) × 0.5            → 0.70 … 1.60
maturityMult = 0.6 + min(age_days, 1095) / 1095 × 0.4   (unknown age: 365 days)
chainMult    = 1 + 0.02 × min(chains, 5)           → 1.00 … 1.10
implied = max(1, round(tvl_usd × category_multiple × growthMult × maturityMult × chainMult))
```

Why this shape:

- **Category multiple from the data, not from a hand-picked constant.** A lending
  protocol's token and a bridge's token do not trade at the same multiple of TVL,
  and the snapshot itself says so (shrunk medians run from 0.106 for liquid staking
  to 1.104 for cross-chain bridges). The starter's flat 0.25 treats them alike.
- **Shrinkage, not raw medians.** The global mean mcap/TVL is 5.0 because a few
  tiny-TVL protocols carry huge ratios (one prediction market at 400×). Medians
  plus a prior keep a category with one live token from inheriting its outlier.
- **Growth is clamped.** The snapshot's 7-day changes run from −73% to +4,448%;
  without the clamp a single week's spike would dominate the board.
- **Maturity is bounded.** A protocol that has run three years with no token gets
  at most 1.0× from age, and a brand-new one at least 0.6× — age is a weak signal,
  not the ranking.
- **Chain breadth is a small bonus.** More chains mean a wider distribution
  surface, worth at most 10%.

No protocol name is special-cased: the same function scores every row, and the
dashboard recomputes each row from the same figures and checks the number
`board.json` carries.

## What the model does not claim

- **No token recorded is not no token.** DefiLlama's record is not proof; a
  protocol on the board may still have a token its record does not carry.
- **A launch is not promised.** Most protocols on this board may never issue a
  token, and no date is implied. Every farm plan's last step says so.
- **Long-tail values are ceilings.** A bridge or liquid-staking product is a token
  that already trades in another form; its implied value is the least certain
  number on the board, and the dashboard flags it as such.
- **The snapshot is frozen** (2026-11-14). Nothing updates until the program runs
  again on a new snapshot.

## Farm plans

Six steps per protocol, all derived from its own record — category, chains, TVL
and age — never from a hand-written list of names. Each step carries what it
costs and how long it takes: a fresh wallet, the category's one action, a weekly
qualifying action, a hold sized to the protocol's age, a points-page check that
warns never to pay to claim, and a log plus the plain statement that no airdrop
is guaranteed.

## The dashboard

A static page with no network: `dashboard/index.html`, `app.css` and `app.js`
read `/output/data.js`, which `main.ts` writes from the same board. Search,
category, chain and tier filters, a watchlist-only toggle, sortable columns, a
detail view for every protocol (the model's arithmetic step by step, the farm
plan, the flags), and a separate live-token view. Source stays under the
dossier's 64 KB text cap.

## Layout

```
main.ts                  the entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts             the radar-2 model, tiers, farm plans, snapshot parsing
vendor/makefun-board.ts  the kit's dossier library, byte for byte
dashboard/               index.html, app.css, app.js (no network)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
LICENSE                  MIT
README.md                this file
```
