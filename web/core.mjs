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
  CurrencyIdentification: 'Scroll of Wisdom', CurrencyHinekorasLock: "Hinekora’s Lock",
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
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.input_volume) || !Number.isSafeInteger(leg.output_volume) || leg.input_volume <= 0 || leg.output_volume <= 0) throw new Error('invalid volume');
    const next = amounts.at(-1) * BigInt(leg.output_volume) * BigInt(10000 - haircut_bps) / (BigInt(leg.input_volume) * 10000n);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount exceeds supported precision');
    amounts.push(next);
  }
  const end = Number(amounts.at(-1));
  return {amounts: amounts.map(Number), end, profit: end - budget, profit_pct: (end / budget - 1) * 100};
}

export function rank_cycles(league, options) {
  return league.cycles.filter(cycle => cycle.path.includes(options.start)).map(cycle => rotate_cycle(cycle, options.start))
    .filter(cycle => cycle.legs.every(leg => leg.input_volume >= options.min_volume && leg.output_volume >= options.min_volume))
    .map(cycle => ({...cycle, simulation: simulate_cycle(cycle.legs, options.budget, options.haircut_bps)}))
    .filter(cycle => cycle.simulation.profit_pct >= options.min_profit)
    .sort((a, b) => b.simulation.profit_pct - a.simulation.profit_pct || b.profit_pct - a.profit_pct);
}
