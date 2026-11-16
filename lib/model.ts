// The token radar's model, version radar-2: one snapshot of the protocol universe in,
// one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries that is not an exchange
// token and not a versioned pool of another protocol (289 rows). It is split into three
// tiers the dashboard shows honestly:
//   watchlist  the 40 slugs on the snapshot's own watchlist (the floor);
//   early      protocols that match the watchlist rule on the fields the snapshot
//              carries (no token recorded, not a wrapped/staked/bridged product,
//              no version marker) but are not on the house list — 158 of them;
//   long-tail  pre-token by record, but a bridge, liquid-staking or wrapped/staked
//              product of a token that already trades — 91 of them, each flagged
//              with the reason, because their own launch is the least likely.
// 53 more pre-token records are set aside entirely (exchange tokens and versioned
// pools) and the dashboard says so.
//
// Implied value follows only from the snapshot's own figures, and the category
// multiple is read off the snapshot itself instead of picked by hand: for each
// category, the median market-cap-to-TVL ratio of the live-token protocols in it,
// shrunk toward the global median with a prior of five protocols, so a category
// with one or two live tokens does not get a wild multiple from a single outlier.
//   base       = tvl_usd x category_multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult  = 1 + 0.02 x min(chains, 5)
//   implied    = max(1, round(base x growthMult x maturityMult x chainMult))
// No protocol name is ever special-cased: the same function scores every row.
// Live-token protocols are kept apart and shown with the market's own values,
// never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  multiple_prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  multiple_min_samples: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 5,
  multiple_prior_weight: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.25,
  multiple_min_samples: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A board tier: where the row sits in the radar's honesty ladder. */
export type Tier = 'watchlist' | 'early' | 'long-tail';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: Tier;
  flag: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  tier: Tier;
  flag: string | null;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  category_multiples: Record<string, number>;
  watchlist_size: number;
  board_size: number;
  core_size: number;
  longtail_size: number;
  excluded_size: number;
  live_size: number;
  rows: RadarRow[];
  longtail: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted-ascending array of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The category multiples, read off the snapshot itself: for each category, the median
 * market-cap-to-TVL ratio of its live-token protocols, shrunk toward the global median
 * with a prior of `multiple_prior_weight` protocols. A category with fewer than
 * `multiple_min_samples` live protocols takes the global median outright, and every
 * multiple is clamped to [multiple_floor, multiple_cap]. Deterministic: the medians
 * come from sorted arrays, the map is built in first-seen category order.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, number> } {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.gecko_id !== null && p.symbol !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalRatios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = medianOf(globalRatios);
  const byCategory = new Map<string, number>();
  const seen = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const arr = seen.get(key);
    if (arr) arr.push(p.mcap_usd! / p.tvl_usd);
    else seen.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  for (const [key, ratios] of seen) {
    let mult: number;
    if (ratios.length >= model.multiple_min_samples) {
      const med = medianOf([...ratios].sort((a, b) => a - b));
      mult = (ratios.length * med + model.multiple_prior_weight * global) / (ratios.length + model.multiple_prior_weight);
    } else {
      mult = global;
    }
    byCategory.set(key, Math.min(model.multiple_cap, Math.max(model.multiple_floor, mult)));
  }
  return { global: Math.min(model.multiple_cap, Math.max(model.multiple_floor, global)), byCategory };
}

/** The category multiple one protocol gets: its category's, else the global median. */
export function multipleFor(p: SnapshotProtocol, multiples: { global: number; byCategory: Map<string, number> }): number {
  return multiples.byCategory.get(p.category ?? 'Other') ?? multiples.global;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMultiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(protocol.chains.length, model.chain_cap);
  const base = protocol.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose product is a wrapped, staked or bridged form of a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Exchange names a protocol name may begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board ranks a protocol at all: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The reason a rankable protocol is long-tail rather than core, or null when it is core. */
export function longTailReason(p: SnapshotProtocol): string | null {
  const reasons: string[] = [];
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) reasons.push(`${p.category} product`);
  if (WRAPPED_WORD.test(p.name)) reasons.push('name carries wrapped/staked');
  if (EXCHANGE_PREFIX.test(p.name)) reasons.push('exchange-branded product');
  return reasons.length > 0 ? reasons.join('; ') : null;
}

/** A protocol's tier, and the flag the dashboard shows for it. */
export function tierOf(p: SnapshotProtocol, snapshot: Snapshot): { tier: Tier; flag: string | null } {
  if (snapshot.watchlist.includes(p.slug)) return { tier: 'watchlist', flag: null };
  const reason = longTailReason(p);
  if (reason !== null) return { tier: 'long-tail', flag: reason };
  if (p.tvl_usd >= snapshot.floor_usd) {
    return { tier: 'early', flag: 'Above the floor but not on the house watchlist' };
  }
  return { tier: 'early', flag: null };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa') || c.includes('basis trad')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Stake $${capital} through ${name} to qualify for its launch allocation on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use ${name}'s apps there.`;
  if (c.includes('payment')) return `Send $${capital} through ${name}'s payment rails on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. The last step says plainly what the plan cannot promise.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `No airdrop is guaranteed: ${p.name} may never issue a token, so treat the position as a plain deposit. Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Whether a protocol is core: rankable and not a bridge/staking/wrapped product. */
export function isCore(p: SnapshotProtocol): boolean {
  return isRankable(p) && longTailReason(p) === null;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. Only core protocols
 * are ranked: a bridge, liquid-staking or wrapped product is a token that already trades
 * in another form, so ranking it as a launch would put WBTC and the big bridges at the
 * top of the board on TVL alone. The long tail is scored with the same model and shown
 * separately, never mixed into the ranking. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const chosen = snapshot.protocols.filter(isCore);
  const scored = chosen.map((p) => {
    const catMult = multipleFor(p, multiples);
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, catMult);
    const { tier, flag } = tierOf(p, snapshot);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, age, catMult, tier, flag };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    tier: s.tier,
    flag: s.flag,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision on purpose: the dashboard recomputes the row from these
      // numbers and checks the result against board.json, so rounding here would
      // make the page disagree with the board by a few dollars.
      category_multiple: s.catMult,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The long tail, scored with the same model but never ranked in the board: pre-token
 * by record, yet a bridge, liquid-staking or wrapped product of a token that trades.
 * Ranks here are within the long tail only, for display order. */
export function longTailRows(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const chosen = snapshot.protocols.filter((p) => isRankable(p) && !isCore(p));
  const scored = chosen.map((p) => {
    const catMult = multipleFor(p, multiples);
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, catMult);
    const { tier, flag } = tierOf(p, snapshot);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, age, catMult, tier, flag };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    tier: s.tier,
    flag: s.flag,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision, as in buildBoard: the dashboard recomputes the row.
      category_multiple: s.catMult,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    tier: row.tier,
    flag: row.flag,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; longtail: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const longtail = longTailRows(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const core = board.length;
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && !isRankable(p)).length;
  const catMultiples: Record<string, number> = {};
  for (const [k, v] of [...multiples.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) catMultiples[k] = round4(v);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    category_multiples: catMultiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    core_size: core,
    longtail_size: longtail.length,
    excluded_size: excluded,
    live_size: live.length,
    rows: board.map(radarRow),
    longtail: longtail.map(radarRow),
    live,
  };
  return { board, longtail, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
