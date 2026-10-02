export const known_names = {
  CurrencyRerollRare: 'Chaos Orb', CurrencyModValues: 'Divine Orb', CurrencyRerollMagic: 'Orb of Alteration',
  CurrencyAddModToRare: 'Exalted Orb', CurrencyRemoveMod: 'Orb of Annulment', CurrencyUpgradeToRare: 'Orb of Alchemy',
  CurrencyUpgradeToMagic: 'Orb of Transmutation', CurrencyAddModToMagic: 'Orb of Augmentation',
  CurrencyUpgradeMagicToRare: 'Regal Orb', CurrencyUpgradeRandomly: 'Orb of Chance', CurrencyConvertToNormal: 'Orb of Scouring',
  CurrencyRerollSocketNumbers: "Jeweller’s Orb", CurrencyRerollSocketLinks: 'Orb of Fusing',
  CurrencyRerollSocketColours: 'Chromatic Orb', CurrencyCorrupt: 'Vaal Orb', CurrencyGemQuality: "Gemcutter’s Prism",
  CurrencyWeaponQuality: "Blacksmith’s Whetstone", CurrencyArmourQuality: "Armourer’s Scrap",
  CurrencyFlaskQuality: "Glassblower’s Bauble", CurrencyRerollDefences: 'Sacred Orb', CurrencyDuplicate: 'Mirror of Kalandra',
  CurrencyDuplicateShard: 'Mirror Shard', CurrencyPassiveRefund: 'Orb of Regret', CurrencyPortal: 'Portal Scroll',
  CurrencyIdentification: 'Scroll of Wisdom', CurrencyAtlasPassiveRefund: 'Orb of Unmaking', CurrencyInstillingOrb: 'Instilling Orb', CurrencyEnkindlingOrb: 'Enkindling Orb', CurrencyHinekorasLock: "Hinekora’s Lock",
};
export const currency_name = id => known_names[id.split('/').at(-1)] ?? id.split('/').at(-1).replace(/([a-z])([A-Z])/g, '$1 $2');
export const has_historical_stock = (edge, min_stock = 1) => edge.kind === 'vendor' || [edge.historical_low_stock, edge.historical_high_stock].every(stock => Number.isSafeInteger(stock) && stock >= min_stock);
const validate_min_stock = min_stock => { if (!Number.isSafeInteger(min_stock) || min_stock < 1) throw new Error('Minimum historical stock must be a positive whole number.'); };
export const profit_pct = rates => (rates.reduce((product, rate) => product * rate, 1) - 1) * 100;

export function gold_cost(id, quantity, fees) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid gold fee quantity.');
  if (quantity === 0) return 0;
  const fee = fees?.[id]?.fee;
  if (!fee) return null;
  if (!Array.isArray(fee) || fee.length !== 2 || !fee.every(Number.isSafeInteger) || fee[0] <= 0 || fee[1] <= 0) throw new Error('Invalid gold fee.');
  const numerator = BigInt(quantity) * BigInt(fee[0]), denominator = BigInt(fee[1]);
  const cost = (numerator + denominator - 1n) / denominator;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Gold cost exceeds supported precision.');
  return Number(cost);
}

export function gold_summary(trades, profit, fees) {
  const leg_costs = trades.map(trade => trade.kind === 'vendor' ? 0 : gold_cost(trade.to, trade.quantity, fees));
  const missing = [...new Set(trades.filter((trade, i) => leg_costs[i] === null).map(trade => trade.to))];
  const sum = leg_costs.filter(cost => cost !== null).reduce((sum, cost) => sum + BigInt(cost), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Total gold exceeds supported precision.');
  const total = missing.length ? null : Number(sum);
  return {leg_costs, missing, total, gold_per_profit: total !== null && profit > 0 ? total / profit : null, profit_per_100k: total > 0 && profit > 0 ? profit * 100000 / total : null};
}

export function click_summary(leg_counts, profit) {
  if (!leg_counts.every(count => Number.isSafeInteger(count) && count >= 0)) throw new Error('Invalid click count.');
  const sum = leg_counts.reduce((sum, count) => sum + BigInt(count), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Click total exceeds supported precision.');
  const total = Number(sum);
  return {leg_counts, total, profit_per_click:total > 0 ? profit / total : null};
}

const within_gold_budget = (simulation, options) => options.gold_budget == null || simulation.gold.total !== null && simulation.gold.total <= options.gold_budget;
const compare_cycles = options => (a, b) => (options.sort_by === 'gold_efficiency' ? (b.simulation.gold.profit_per_100k ?? -Infinity) - (a.simulation.gold.profit_per_100k ?? -Infinity) : options.sort_by === 'click_efficiency' ? (b.simulation.clicks.profit_per_click ?? -Infinity) - (a.simulation.clicks.profit_per_click ?? -Infinity) : 0) || b.simulation.profit_pct - a.simulation.profit_pct || b.profit_pct - a.profit_pct;
function validate_gold_options(options) {
  if (options.gold_budget != null && (!Number.isSafeInteger(options.gold_budget) || options.gold_budget < 0)) throw new Error('Gold budget must be a nonnegative whole number.');
  if (options.sort_by != null && !['profit', 'gold_efficiency', 'click_efficiency'].includes(options.sort_by)) throw new Error('Invalid sort order.');
}

export function rotate_cycle(cycle, start) {
  const index = cycle.path.indexOf(start);
  if (index < 0) return null;
  return {...cycle, path: [...cycle.path.slice(index), ...cycle.path.slice(0, index)], legs: [...cycle.legs.slice(index), ...cycle.legs.slice(0, index)]};
}

export function simulate_cycle(legs, budget, haircut_bps, fees = null) {
  if (!Number.isSafeInteger(budget) || budget < 1 || !Number.isInteger(haircut_bps) || haircut_bps < 0 || haircut_bps >= 10000) throw new Error('invalid budget or haircut');
  const amounts = [BigInt(budget)];
  const leftovers = [], leg_clicks = [];
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.input_volume) || !Number.isSafeInteger(leg.output_volume) || leg.input_volume <= 0 || leg.output_volume <= 0) throw new Error('invalid volume');
    const input = BigInt(leg.input_volume), output = BigInt(leg.output_volume);
    const vendor = leg.kind === 'vendor';
    leg_clicks.push(vendor ? Number(amounts.at(-1) / input) : amounts.at(-1) > 0n ? 1 : 0);
    leftovers.push(vendor ? Number(amounts.at(-1) % input) : 0);
    const next = vendor ? amounts.at(-1) / input * output : amounts.at(-1) * output * BigInt(10000 - haircut_bps) / (input * 10000n);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount exceeds supported precision');
    amounts.push(next);
  }
  const end = Number(amounts.at(-1));
  return {clicks:click_summary(leg_clicks, end - budget), amounts: amounts.map(Number), leftovers, end, profit: end - budget, profit_pct: (end / budget - 1) * 100,
    gold: gold_summary(legs.map((leg, i) => ({...leg, quantity:Number(amounts[i + 1])})), end - budget, fees)};
}

function decimal_quantity(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,12})?$/.test(text)) throw new Error('Quote amounts must be positive decimal numbers with at most 12 decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const quantity = BigInt(whole + fraction), scale = 10n ** BigInt(fraction.length);
  if (quantity <= 0n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quote amount is zero or exceeds supported precision.');
  return {quantity, scale};
}

export function manual_cycle(legs, quotes, budget, haircut_bps, fees = null) {
  if (!Array.isArray(quotes) || quotes.length !== legs.length) throw new Error('Enter a quote for each trade.');
  const adjusted = legs.map((leg, i) => {
    if (leg.kind === 'vendor') return {...leg};
    const input = decimal_quantity(quotes[i].input), output = decimal_quantity(quotes[i].output);
    const numerator = output.quantity * input.scale, denominator = input.quantity * output.scale;
    const gcd = (a, b) => b === 0n ? a : gcd(b, a % b);
    const divisor = gcd(numerator, denominator), x = denominator / divisor, y = numerator / divisor;
    if (x > BigInt(Number.MAX_SAFE_INTEGER) || y > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quote ratio exceeds supported precision.');
    return {...leg, input_volume:Number(x), output_volume:Number(y), rate:Number(y) / Number(x)};
  });
  return {legs:adjusted, simulation:simulate_cycle(adjusted, budget, haircut_bps, fees), profit_pct:profit_pct(adjusted.map(leg => leg.rate))};
}

export function rank_cycles(league, options) {
  validate_gold_options(options);
  validate_min_stock(options.min_stock ?? 1);
  return league.cycles.filter(cycle => cycle.path.includes(options.start)).map(cycle => rotate_cycle(cycle, options.start))
    .filter(cycle => options.include_vendors !== false || cycle.legs.every(leg => leg.kind !== 'vendor'))
    .filter(cycle => cycle.legs.every(leg => has_historical_stock(leg, options.min_stock ?? 1)))
    .filter(cycle => !options.vendor_only || cycle.legs.some(leg => leg.kind === 'vendor'))
    .filter(cycle => cycle.legs.every(leg => leg.kind === 'vendor' || leg.input_volume >= options.min_volume && leg.output_volume >= options.min_volume))
    .map(cycle => ({...cycle, simulation: simulate_cycle(cycle.legs, options.budget, options.haircut_bps, options.gold_fees)}))
    .filter(cycle => cycle.simulation.profit_pct >= options.min_profit)
    .filter(cycle => within_gold_budget(cycle.simulation, options))
    .sort(compare_cycles(options));
}

export function quote_recipe(recipe, edges, batches, item_cost, haircut_bps, fees = null, min_stock = 1) {
  validate_min_stock(min_stock);
  if (!Number.isSafeInteger(batches) || batches < 1 || batches > 1000000 || !Number.isFinite(item_cost) || item_cost < 0 || !Number.isInteger(haircut_bps) || haircut_bps < 0 || haircut_bps >= 10000) throw new Error('Enter valid batch, ingredient cost and haircut amounts.');
  if (!['fixed', 'basket', 'item'].includes(recipe.kind)) throw new Error('This recipe has no deterministic currency return.');
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const missing = [];
  const trades = [];
  const quote = (id, quantity, buying) => {
    if (id === chaos) return quantity;
    const edge = edges.find(edge => edge.kind === 'market' && has_historical_stock(edge, min_stock) && edge.from === (buying ? chaos : id) && edge.to === (buying ? id : chaos));
    if (!edge) { missing.push(currency_name(id)); return 0; }
    const amount = BigInt(quantity), input = BigInt(edge.input_volume), output = BigInt(edge.output_volume), factor = BigInt(10000 - haircut_bps);
    const numerator = buying ? amount * input * 10000n : amount * output * factor;
    const denominator = buying ? output * factor : input * 10000n;
    const result = buying ? (numerator + denominator - 1n) / denominator : numerator / denominator;
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds supported precision.');
    trades.push({kind:'market', to:buying ? id : chaos, quantity:buying ? quantity : Number(result)});
    return Number(result);
  };
  const cost = Object.entries(recipe.inputs).reduce((sum, [id, amount]) => sum + quote(id, amount * batches, true), item_cost * batches);
  const returned = Object.entries(recipe.outputs).reduce((sum, [id, amount]) => sum + quote(id, amount * batches, false), 0);
  if (missing.length) throw new Error(`Missing direct Chaos market quote with positive historical stock of at least ${min_stock}: ` + [...new Set(missing)].join(', ') + '. No profit estimate is available.');
  return {cost, returned, profit: returned - cost, profit_pct: cost > 0 ? (returned / cost - 1) * 100 : null, clicks:click_summary([...trades.map(() => 1), batches], returned - cost), gold:gold_summary(trades, returned - cost, fees)};
}

export function search_cycles(league, options) {
  validate_gold_options(options);
  validate_min_stock(options.min_stock ?? 1);
  if (!Number.isInteger(options.max_trades) || options.max_trades < 2 || options.max_trades > 8) throw new Error('Maximum trades must be a whole number from 2 to 8.');
  simulate_cycle([], options.budget, options.haircut_bps);
  if (!Number.isSafeInteger(options.min_volume) || options.min_volume < 1 || !Number.isFinite(options.min_profit)) throw new Error('Invalid volume or profit filter.');
  if (!Array.isArray(league.edges)) throw new Error('The snapshot has no currency graph.');
  const graph = new Map(), reverse = new Map();
  for (const edge of league.edges) {
    if (!has_historical_stock(edge, options.min_stock ?? 1)) continue;
    if (edge.kind === 'vendor' ? options.include_vendors === false : edge.input_volume < options.min_volume || edge.output_volume < options.min_volume) continue;
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    graph.get(edge.from).push(edge);
    if (!reverse.has(edge.to)) reverse.set(edge.to, []);
    reverse.get(edge.to).push(edge.from);
  }
  const distance = new Map([[options.start, 0]]), queue = [options.start];
  for (let i = 0; i < queue.length; i++) {
    for (const from of reverse.get(queue[i]) ?? []) {
      if (distance.has(from)) continue;
      distance.set(from, distance.get(queue[i]) + 1);
      queue.push(from);
    }
  }
  const cycles = [], path = [options.start], legs = [], seen = new Set(path);
  const max_checks = options.max_checks ?? 2000000;
  const max_results = options.max_results ?? 25000;
  if (!Number.isSafeInteger(max_checks) || max_checks < 1 || !Number.isSafeInteger(max_results) || max_results < 1) throw new Error('Invalid search limit.');
  let visited = 0, complete = true;
  function walk(current, has_market, has_vendor) {
    for (const edge of graph.get(current) ?? []) {
      if (visited >= max_checks || cycles.length >= max_results) {complete = false; return;}
      visited++;
      const length = legs.length + 1;
      const market = has_market || edge.kind !== 'vendor';
      const vendor = has_vendor || edge.kind === 'vendor';
      if (edge.to === options.start) {
        if (length < 2 || !market || options.vendor_only && !vendor) continue;
        legs.push(edge);
        const simulation = simulate_cycle(legs, options.budget, options.haircut_bps, options.gold_fees);
        if (simulation.profit_pct >= options.min_profit && within_gold_budget(simulation, options)) cycles.push({
          path: [...path], legs: [...legs], simulation,
          profit_pct: profit_pct(legs.map(leg => leg.rate)),
          low_profit_pct: profit_pct(legs.map(leg => leg.low_rate)),
          high_profit_pct: profit_pct(legs.map(leg => leg.high_rate)),
        });
        legs.pop();
      } else if (length < options.max_trades && !seen.has(edge.to) && length + (distance.get(edge.to) ?? Infinity) <= options.max_trades) {
        legs.push(edge); path.push(edge.to); seen.add(edge.to);
        walk(edge.to, market, vendor);
        seen.delete(edge.to); path.pop(); legs.pop();
        if (!complete) return;
      }
    }
  }
  walk(options.start, false, false);
  cycles.sort(compare_cycles(options));
  return {cycles, complete, visited};
}
