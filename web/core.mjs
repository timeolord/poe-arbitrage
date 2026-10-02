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
export const profit_pct = rates => (rates.reduce((product, rate) => product * rate, 1) - 1) * 100;

export function rotate_cycle(cycle, start) {
  const index = cycle.path.indexOf(start);
  if (index < 0) return null;
  return {...cycle, path: [...cycle.path.slice(index), ...cycle.path.slice(0, index)], legs: [...cycle.legs.slice(index), ...cycle.legs.slice(0, index)]};
}

export function simulate_cycle(legs, budget, haircut_bps) {
  if (!Number.isSafeInteger(budget) || budget < 1 || !Number.isInteger(haircut_bps) || haircut_bps < 0 || haircut_bps >= 10000) throw new Error('invalid budget or haircut');
  const amounts = [BigInt(budget)];
  const leftovers = [];
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.input_volume) || !Number.isSafeInteger(leg.output_volume) || leg.input_volume <= 0 || leg.output_volume <= 0) throw new Error('invalid volume');
    const input = BigInt(leg.input_volume), output = BigInt(leg.output_volume);
    const vendor = leg.kind === 'vendor';
    leftovers.push(vendor ? Number(amounts.at(-1) % input) : 0);
    const next = vendor ? amounts.at(-1) / input * output : amounts.at(-1) * output * BigInt(10000 - haircut_bps) / (input * 10000n);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount exceeds supported precision');
    amounts.push(next);
  }
  const end = Number(amounts.at(-1));
  return {amounts: amounts.map(Number), leftovers, end, profit: end - budget, profit_pct: (end / budget - 1) * 100};
}

export function rank_cycles(league, options) {
  return league.cycles.filter(cycle => cycle.path.includes(options.start)).map(cycle => rotate_cycle(cycle, options.start))
    .filter(cycle => options.include_vendors !== false || cycle.legs.every(leg => leg.kind !== 'vendor'))
    .filter(cycle => !options.vendor_only || cycle.legs.some(leg => leg.kind === 'vendor'))
    .filter(cycle => cycle.legs.every(leg => leg.kind === 'vendor' || leg.input_volume >= options.min_volume && leg.output_volume >= options.min_volume))
    .map(cycle => ({...cycle, simulation: simulate_cycle(cycle.legs, options.budget, options.haircut_bps)}))
    .filter(cycle => cycle.simulation.profit_pct >= options.min_profit)
    .sort((a, b) => b.simulation.profit_pct - a.simulation.profit_pct || b.profit_pct - a.profit_pct);
}

export function quote_recipe(recipe, edges, batches, item_cost, haircut_bps) {
  if (!Number.isSafeInteger(batches) || batches < 1 || batches > 1000000 || !Number.isFinite(item_cost) || item_cost < 0 || !Number.isInteger(haircut_bps) || haircut_bps < 0 || haircut_bps >= 10000) throw new Error('Enter valid batch, ingredient cost and haircut amounts.');
  if (!['fixed', 'basket', 'item'].includes(recipe.kind)) throw new Error('This recipe has no deterministic currency return.');
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const missing = [];
  const quote = (id, quantity, buying) => {
    if (id === chaos) return quantity;
    const edge = edges.find(edge => edge.kind === 'market' && edge.from === (buying ? chaos : id) && edge.to === (buying ? id : chaos));
    if (!edge) { missing.push(currency_name(id)); return 0; }
    const amount = BigInt(quantity), input = BigInt(edge.input_volume), output = BigInt(edge.output_volume), factor = BigInt(10000 - haircut_bps);
    const numerator = buying ? amount * input * 10000n : amount * output * factor;
    const denominator = buying ? output * factor : input * 10000n;
    const result = buying ? (numerator + denominator - 1n) / denominator : numerator / denominator;
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds supported precision.');
    return Number(result);
  };
  const cost = Object.entries(recipe.inputs).reduce((sum, [id, amount]) => sum + quote(id, amount * batches, true), item_cost * batches);
  const returned = Object.entries(recipe.outputs).reduce((sum, [id, amount]) => sum + quote(id, amount * batches, false), 0);
  if (missing.length) throw new Error('Missing direct Chaos market quote: ' + [...new Set(missing)].join(', ') + '. No profit estimate is available.');
  return {cost, returned, profit: returned - cost, profit_pct: cost > 0 ? (returned / cost - 1) * 100 : null};
}
