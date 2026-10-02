import {currency_name, search_cycles, quote_recipe, manual_cycle, apply_market_quotes, common_currencies, chaos_id, historical_volume} from './core.mjs?v=chaos-prices-v1';

const by_id = id => document.getElementById(id);
const format_number = value => new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
const format_pct = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const escape_html = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const route_html = path => `<div class="route">${[...path, path[0]].map(currency_name).map(escape_html).join('<span>→</span>')}</div>`;
let analysis;
let catalog;
let fee_catalog;
const format_click_profit = value => value === null ? 'Unavailable' : new Intl.NumberFormat(undefined, {maximumSignificantDigits:6}).format(value);
const format_gold = value => value === null ? 'Unavailable' : format_number(value);
const gold_efficiency_text = (gold, currency) => gold.gold_per_profit === null ? 'Gold efficiency unavailable' : `${format_number(gold.gold_per_profit)} gold per ${currency} earned; ${gold.profit_per_100k === null ? 'no gold required' : `${format_number(gold.profit_per_100k)} ${currency} earned per 100,000 gold`}`;
let ranked = [];
let page_size = 40;
let selected_index = null;
let search_worker;
const market_quotes = new Map();

function current_league() {
  const league = analysis.leagues.find(league => league.name === by_id('league').value);
  return apply_market_quotes(league, market_quotes.get(league.name) ?? []);
}

function render_market_quotes() {
  const league = analysis.leagues.find(league => league.name === by_id('league').value);
  const saved = market_quotes.get(league.name) ?? [];
  by_id('market_quote_rows').innerHTML = common_currencies.filter(id => league.currencies.includes(id)).map(id => {
    const quote = saved.find(quote => quote.currency === id);
    return `<tr><td>${escape_html(currency_name(id))}</td>${['buy', 'sell'].map(direction => {
      const edge = league.edges.find(edge => edge.kind === 'market' && edge.from === (direction === 'buy' ? chaos_id : id) && edge.to === (direction === 'buy' ? id : chaos_id));
      return ['input', 'output'].map(side => `<td><input type="text" inputmode="decimal" data-currency="${escape_html(id)}" data-direction="${direction}" data-side="${side}" aria-label="${escape_html(currency_name(id))} ${direction} ${side === 'input' ? 'give' : 'receive'}" value="${escape_html(quote?.[direction]?.[side] ?? '')}" placeholder="${edge ? format_number(edge[`${side}_volume`]) : 'No pair'}" ${edge ? '' : 'disabled'}></td>`).join('');
    }).join('')}</tr>`;
  }).join('');
  by_id('market_quote_error').hidden = true;
  update_quote_status();
}

function update_quote_status(pending = false) {
  const count = current_league().edges.filter(edge => edge.manual_price).length;
  by_id('market_quote_status').textContent = `${count ? `Search uses ${count} manual directional Chaos quotes; other rates are historical.` : 'Search uses historical prices.'}${pending ? ' Edits pending. Apply prices and search to use them.' : ''}`;
}


function set_error(message) {
  by_id('error').hidden = !message;
  by_id('error').textContent = message;
}

function read_options() {
  if (!by_id('controls').checkValidity()) throw new Error('Enter valid numbers in each field.');
  const options = {max_trades: Number(by_id('max_trades').value), start: by_id('start').value, budget: Number(by_id('budget').value), haircut_bps: Math.round(Number(by_id('haircut').value) * 100), min_stock: Number(by_id('min_stock').value), min_volume: Number(by_id('min_volume').value), min_profit: Number(by_id('min_profit').value), include_vendors: by_id('route_type').value !== 'market', vendor_only: by_id('route_type').value === 'vendor'};
  options.gold_budget = by_id('gold_budget').value === '' ? null : Number(by_id('gold_budget').value);
  options.sort_by = by_id('sort_by').value;
  options.gold_fees = fee_catalog.items;
  if (!Number.isSafeInteger(options.min_volume) || options.min_volume < 1) throw new Error('Minimum volume must be a positive whole number.');
  if (!Number.isSafeInteger(options.min_stock) || options.min_stock < 1) throw new Error('Minimum historical stock must be a positive whole number.');
  return options;
}

function update_currencies() {
  const league = analysis.leagues.find(league => league.name === by_id('league').value);
  const old = by_id('start').value;
  by_id('start').innerHTML = league.currencies.slice().sort((a,b) => currency_name(a).localeCompare(currency_name(b)))
    .map(id => `<option value="${escape_html(id)}">${escape_html(currency_name(id))}</option>`).join('');
  const chaos = league.currencies.find(id => id.endsWith('/CurrencyRerollRare'));
  by_id('start').value = league.currencies.includes(old) ? old : chaos ?? league.currencies[0] ?? '';
}

function render_rows() {
  by_id('rows').innerHTML = ranked.slice(0, page_size).map((cycle, index) => `<tr${index === selected_index ? ' class="selected"' : ''}>
    <td>${route_html(cycle.path)}${cycle.legs.some(leg => leg.manual_price) ? '<span class="secondary">Includes manual prices</span>' : ''}<span class="secondary">${cycle.legs.filter(leg => leg.kind === 'vendor').length} vendor / ${cycle.legs.filter(leg => leg.kind !== 'vendor').length} market trades</span></td>
    <td><span class="profit ${cycle.simulation.profit_pct >= 0 ? 'positive' : 'negative'}">${format_pct(cycle.simulation.profit_pct)}</span><span class="secondary">after rounding &amp; haircut</span></td>
    <td>${format_number(cycle.simulation.end)}</td><td>${cycle.simulation.profit >= 0 ? '+' : ''}${format_number(cycle.simulation.profit)}</td>
    <td>${format_number(cycle.simulation.clicks.total)}<span class="secondary">estimated clicks</span></td>
    <td>${format_click_profit(cycle.simulation.clicks.profit_per_click)}<span class="secondary">${escape_html(currency_name(cycle.path[0]))} per click</span></td>
    <td>${format_gold(cycle.simulation.gold.total)}<span class="secondary">estimated gold</span></td>
    <td>${format_gold(cycle.simulation.gold.gold_per_profit)}<span class="secondary">per ${escape_html(currency_name(cycle.path[0]))} earned</span></td>
    <td>${format_pct(cycle.low_profit_pct)} to ${format_pct(cycle.high_profit_pct)}<span class="secondary">unrounded, before haircut</span></td>
    <td><button type="button" data-cycle="${index}" aria-label="Inspect cycle ${index + 1}">Inspect</button></td></tr>`).join('');
  by_id('empty').hidden = ranked.length !== 0;
  by_id('show_more').hidden = ranked.length <= page_size;
  by_id('result_count').textContent = `${Math.min(page_size, ranked.length)} of ${ranked.length} matching cycles`;
}

function show_details(index, quotes = null) {
  selected_index = index;
  const historical = ranked[index];
  const options = read_options();
  const cycle = quotes ? {...historical, ...manual_cycle(historical.legs, quotes, options.budget, options.haircut_bps, fee_catalog.items)} : historical;
  const displayed_quotes = quotes ?? historical.legs.map(leg => ({input:String(leg.input_volume), output:String(leg.output_volume)}));
  by_id('details').hidden = false;
  by_id('detail_content').innerHTML = `${route_html(cycle.path)}
    <form id="leg_quotes"><div class="quote-editor"><h3>Check current prices</h3><p>Enter the amounts you give and receive for each market trade. Vendor batches stay fixed. Recalculate uses your starting amount and haircut, with whole-unit rounding and updated gold fees.</p>
    ${historical.legs.map((leg, i) => leg.kind === 'vendor' ? `<p>Trade ${i + 1}: fixed vendor batch, ${format_number(leg.input_volume)} ${escape_html(currency_name(leg.from))} → ${format_number(leg.output_volume)} ${escape_html(currency_name(leg.to))}.</p>` : `<div class="quote-row"><span>Trade ${i + 1}</span><label>Give ${escape_html(currency_name(leg.from))}<input data-quote-input="${i}" aria-label="Trade ${i + 1} give ${escape_html(currency_name(leg.from))}" type="text" inputmode="decimal" value="${escape_html(displayed_quotes[i].input)}" required></label><label>Receive ${escape_html(currency_name(leg.to))}<input data-quote-output="${i}" aria-label="Trade ${i + 1} receive ${escape_html(currency_name(leg.to))}" type="text" inputmode="decimal" value="${escape_html(displayed_quotes[i].output)}" required></label></div>`).join('')}
    <div class="quote-actions"><button type="submit">Recalculate cycle</button><button id="reset_quotes" type="button">Reset to search rates</button></div><p id="quote_status" role="status">${quotes ? 'Manual price scenario. Historical stock and volume remain context; the search results above use the applied panel prices.' : 'Search price scenario. Change the quote amounts, then recalculate.'}</p><p id="quote_error" class="error" role="alert" hidden></p></div></form>
    <div class="detail-stats">
    <div><span>Modeled cycle profit</span><strong class="${cycle.simulation.profit_pct >= 0 ? 'positive' : 'negative'}">${format_pct(cycle.simulation.profit_pct)}</strong></div>
    <div><span>Unrounded central return</span><strong>${format_pct(cycle.profit_pct)}</strong></div>
    <div><span>Profit ${escape_html(currency_name(cycle.path[0]))}</span><strong class="${cycle.simulation.profit >= 0 ? 'positive' : 'negative'}">${format_number(cycle.simulation.profit)}</strong></div>
    <div><span>Ending ${escape_html(currency_name(cycle.path[0]))}</span><strong>${format_number(cycle.simulation.end)}</strong></div>
    <div><span>Estimated clicks</span><strong>${format_number(cycle.simulation.clicks.total)}</strong></div>
    <div><span>${escape_html(currency_name(cycle.path[0]))} profit per click</span><strong class="${cycle.simulation.profit >= 0 ? 'positive' : 'negative'}">${format_click_profit(cycle.simulation.clicks.profit_per_click)}</strong></div>
    <div><span>Estimated gold total</span><strong>${format_gold(cycle.simulation.gold.total)}</strong></div>
    <div><span>Gold per ${escape_html(currency_name(cycle.path[0]))} earned</span><strong>${format_gold(cycle.simulation.gold.gold_per_profit)}</strong></div>
    <div><span>${escape_html(currency_name(cycle.path[0]))} earned per 100,000 gold</span><strong>${format_gold(cycle.simulation.gold.profit_per_100k)}</strong></div></div>
    <div class="table-wrap"><table><thead><tr><th>Trade</th><th>Input → output</th><th>Estimated clicks</th><th>Estimated gold</th><th>Applied rate</th><th>Hourly volumes</th><th>Historical output stock</th></tr></thead><tbody>
    ${cycle.legs.map((leg, i) => `<tr><td>${escape_html(currency_name(leg.from))} → ${escape_html(currency_name(leg.to))}<span class="secondary">${escape_html(leg.vendor ?? 'Currency market')}</span></td>
      <td>${format_number(cycle.simulation.amounts[i])} → ${format_number(cycle.simulation.amounts[i + 1])}${cycle.simulation.leftovers[i] ? `<span class="secondary">${cycle.simulation.leftovers[i]} input left over, excluded</span>` : ''}</td>
      <td>${format_number(cycle.simulation.clicks.leg_counts[i])}<span class="secondary">${leg.kind === 'vendor' ? 'One click per completed batch' : 'One Faustus trade'}</span></td>
      <td>${format_gold(cycle.simulation.gold.leg_costs[i])}<span class="secondary">${leg.kind === 'vendor' ? 'No exchange fee' : 'Fee on received currency'}</span></td>
      <td>${leg.rate.toPrecision(6)} per input unit<span class="secondary">${(quotes || leg.manual_price) && leg.kind !== 'vendor' ? 'Manual quote' : leg.kind === 'vendor' ? 'Fixed vendor rate' : 'Historical average'}; historical ${leg.low_rate.toPrecision(5)} to ${leg.high_rate.toPrecision(5)}</span></td>
      <td>${leg.kind === 'vendor' ? 'Fixed batch: ' : 'Hourly: '}${format_number(historical_volume(historical.legs[i], 'input'))} input / ${format_number(historical_volume(historical.legs[i], 'output'))} output</td>
      <td>${leg.kind === 'vendor' ? 'Vendor, no market stock assumption' : `${format_number(leg.historical_low_stock)} to ${format_number(leg.historical_high_stock)}`}</td></tr>`).join('')}</tbody></table></div>
    <p>Profit per click = profit in the starting currency ÷ total estimated clicks. Each market leg with a nonzero input counts as one Faustus trade. Each completed vendor batch counts as one click, regardless of its reward quantity. Setup, inventory movement and travel are excluded. Manual prices also update vendor batch counts and click efficiency.</p>
    <p>Return = (ending amount ÷ starting amount − 1) × 100. Gold efficiency divides the total gold cost by the profit, excluding your starting balance. Gold is a separate expense and does not reduce the displayed currency amount.</p>
    <p>Gold estimates use the ${escape_html(fee_catalog.patch)} fee table, reviewed ${escape_html(fee_catalog.reviewed_at)}, and round each market fee up. ${cycle.simulation.gold.missing.length ? `Missing fees: ${cycle.simulation.gold.missing.map(currency_name).map(escape_html).join(', ')}. The total and efficiency are unavailable.` : 'One listing per market leg is assumed; cancellations and reposting are excluded.'} Rates are historical hourly averages; check each order and its gold fee in game.</p>
    ${cycle.legs.some((leg, i) => leg.kind !== 'vendor' && cycle.simulation.amounts[i] > historical_volume(historical.legs[i], 'input')) ? '<p>Your modeled trade size exceeds the entire observed hourly input volume on at least one leg. This estimate extrapolates beyond the sample and is especially uncertain.</p>' : ''}`;
  by_id('leg_quotes').addEventListener('input', () => {by_id('quote_status').textContent = 'Quote edits pending. Recalculate to update the amounts below.';});
  by_id('leg_quotes').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const values = historical.legs.map((leg, i) => leg.kind === 'vendor' ? null : ({input:document.querySelector(`[data-quote-input="${i}"]`).value, output:document.querySelector(`[data-quote-output="${i}"]`).value}));
      show_details(index, values);
    } catch (error) {by_id('quote_error').hidden = false; by_id('quote_error').textContent = error.message; by_id('quote_status').textContent = 'Invalid quote. The amounts below are from the last successful calculation.';}
  });
  by_id('reset_quotes').addEventListener('click', () => show_details(index));
  render_rows();
}

function finish_render(league, result) {
  ranked = result.cycles;
  update_quote_status();
  by_id('search_status').textContent = result.complete ? `Searched cycles of 2–${by_id('max_trades').value} trades, including the return trade.` : 'Partial results: search limit reached. Lower maximum trades or raise minimum volume. Statistics describe only the cycles found.';
  by_id('cycle_count').textContent = format_number(ranked.length);
  by_id('pair_count').textContent = format_number(league.active_pairs);
  const returns = ranked.map(cycle => cycle.simulation.profit_pct).sort((a,b) => b-a);
  by_id('best_return').textContent = ranked.length ? format_pct(returns[0]) : '—';
  by_id('best_return').className = ranked.length && returns[0] >= 0 ? 'positive' : '';
  const middle = Math.floor(ranked.length / 2);
  const median = ranked.length % 2 ? returns[middle] : (returns[middle - 1] + returns[middle]) / 2;
  by_id('median_return').textContent = ranked.length ? format_pct(median) : '—';
  render_rows();
}

function search_error(error) {
  set_error(error.message);
  by_id('search_status').textContent = 'Search unavailable.';
  ranked = [];
  render_rows();
}

function render() {
  if (!analysis) return;
  search_worker?.terminate();
  search_worker = null;
  ranked = [];
  page_size = 40;
  selected_index = null;
  by_id('details').hidden = true;
  for (const id of ['cycle_count', 'best_return', 'median_return', 'pair_count']) by_id(id).textContent = '—';
  render_rows();
  try {
    const options = read_options();
    const league = current_league();
    render_recipe();
    set_error('');
    by_id('search_status').textContent = `Searching cycles up to ${options.max_trades} trades…`;
    by_id('empty').hidden = true;
    by_id('result_count').textContent = 'Searching…';
    if (typeof Worker === 'undefined') {
      finish_render(league, search_cycles(league, options));
      return;
    }
    const worker = new Worker('./search_worker.mjs?v=chaos-prices-v1', {type: 'module'});
    search_worker = worker;
    worker.onmessage = ({data}) => {
      if (search_worker !== worker) return;
      worker.terminate();
      search_worker = null;
      if (data.error) search_error(new Error(data.error));
      else finish_render(league, data);
    };
    worker.onerror = () => {
      if (search_worker !== worker) return;
      worker.terminate();
      search_worker = null;
      search_error(new Error('Background search failed. Reload the page to retry.'));
    };
    worker.postMessage({league: {edges: league.edges}, options});
  } catch (error) {
    search_error(error);
  }
}

async function load_analysis() {
  try {
    const response = await fetch('./data/analysis.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status}).`);
    analysis = await response.json();
    if (analysis.schema_version !== 1 || !Array.isArray(analysis.leagues)) throw new Error('No supported currency snapshot is available.');
    analysis.leagues = analysis.leagues.filter(league => league.currencies.length);
    if (!analysis.leagues.length) throw new Error('No active currency pairs exist in this snapshot.');
    by_id('league').innerHTML = analysis.leagues.filter(league => league.currencies.length).map(league => `<option value="${escape_html(league.name)}">${escape_html(league.name)}</option>`).join('');
    const preferred = analysis.leagues.find(league => league.name === 'Allflame') ?? analysis.leagues.find(league => league.name === 'Standard') ?? analysis.leagues[0];
    by_id('league').value = preferred.name;
    by_id('league').disabled = false;
    by_id('start').disabled = false;
    update_currencies();
    render_market_quotes();
    const start = new Date(analysis.hour * 1000);
    const end = new Date((analysis.hour + 3600) * 1000);
    const age_hours = (Date.now() / 1000 - analysis.hour - 3600) / 3600;
    by_id('snapshot_time').textContent = `${analysis.realm.toUpperCase()} · ${start.toLocaleString()} – ${end.toLocaleTimeString()} · ${age_hours > 3 ? 'stale snapshot' : 'completed hour'}`;
    by_id('source_link').href = analysis.source_url;
    const catalog_response = await fetch('./vendor_recipes.json', {cache: 'no-cache'});
    if (!catalog_response.ok) throw new Error('Vendor catalogue unavailable.');
    catalog = await catalog_response.json();
    const fee_response = await fetch('./gold_fees.json', {cache:'no-cache'});
    if (!fee_response.ok) throw new Error('Gold fee table unavailable.');
    fee_catalog = await fee_response.json();
    if (fee_catalog.schema_version !== 1 || !fee_catalog.items || typeof fee_catalog.items !== 'object') throw new Error('Unsupported gold fee table.');
    by_id('gold_source').textContent = `Gold fees: PoEDB, patch ${fee_catalog.patch}, reviewed ${fee_catalog.reviewed_at}.`;
    load_recipes();
    render();
  } catch (error) {
    by_id('snapshot_time').textContent = 'Snapshot unavailable';
    by_id('result_count').textContent = 'No data loaded';
    set_error(`${error.message} Run the snapshot fetcher and Rust scanner, then serve the web directory over HTTP.`);
  }
}

function currency_list(values) {
  return Object.entries(values).map(([id, amount]) => `${amount} ${currency_name(id)}`).join(' + ') || 'Item ingredients';
}

function load_recipes() {
  const calculable = catalog.recipes.filter(recipe => ['fixed', 'basket'].includes(recipe.kind));
  by_id('recipe').innerHTML = calculable.map(recipe => `<option value="${escape_html(recipe.id)}">${escape_html(recipe.name)}</option>`).join('');
  by_id('recipe_count').textContent = `${catalog.recipes.length} currency exchanges`;
  by_id('recipe_rules').textContent = `${catalog.ruleset}. Checked ${catalog.checked_at}. ${catalog.verification} Only deterministic currency-to-currency recipes are listed. Quoted adjacent essence upgrades are also included in the cycle scanner.`;
  by_id('recipe_catalogue').innerHTML = catalog.recipes.map(recipe => `<tr><td>${escape_html(recipe.name)}</td><td>${Object.keys(recipe.outputs).length ? escape_html(currency_list(recipe.inputs) + ' → ' + currency_list(recipe.outputs)) : 'Variable or unavailable'}</td><td>${escape_html(recipe.requirements)}<span class="secondary">${escape_html(recipe.vendor)}</span></td><td>${escape_html(recipe.kind + " / 3.29 reviewed")}<span class="secondary"><a href="${escape_html(recipe.source)}" target="_blank" rel="noreferrer">Rate source</a> · <a href="${escape_html(catalog.patch_source)}" target="_blank" rel="noreferrer">Patch notes</a></span></td></tr>`).join('');
  select_recipe();
}

function select_recipe() {
  if (!catalog) return;

  render_recipe();
}

function render_recipe() {
  if (!catalog || !analysis) return;
  const recipe = catalog.recipes.find(recipe => recipe.id === by_id('recipe').value);
  by_id('recipe_requirements').textContent = `${currency_list(recipe.inputs)} → ${currency_list(recipe.outputs)}. ${recipe.requirements} Vendor: ${recipe.vendor}.`;
  try {
    if (by_id('league').value.includes('Ruthless')) throw new Error('This catalogue is for non-Ruthless rules.');
    if (!by_id('recipe_controls').checkValidity()) throw new Error('Enter a valid whole number of batches.');
    const league = current_league();
    const options = read_options();
    const result = quote_recipe(recipe, league.edges ?? [], Number(by_id('recipe_batches').value), 0, options.haircut_bps, fee_catalog.items, options.min_stock);
    by_id('recipe_result').textContent = `Cost: ${format_number(result.cost)} chaos. Return: ${format_number(result.returned)} chaos. Profit: ${format_number(result.profit)} chaos (${result.profit_pct === null ? 'percentage undefined for zero cost' : format_pct(result.profit_pct)}). Estimated clicks: ${format_number(result.clicks.total)} (${format_number(Number(by_id('recipe_batches').value))} vendor batches plus market purchases and sales). Chaos profit per click: ${format_click_profit(result.clicks.profit_per_click)}. Estimated gold: ${format_gold(result.gold.total)}. ${gold_efficiency_text(result.gold, 'Chaos Orb')}. ${result.gold.missing.length ? `Missing fees: ${result.gold.missing.map(currency_name).join(', ')}. ` : ''}${options.gold_budget !== null && (result.gold.total === null || result.gold.total > options.gold_budget) ? 'This recipe does not meet your gold budget. ' : ''}Applied search quotes with haircut and whole-unit rounding; one listing per market quote, time excluded.`;
    by_id('recipe_result').className = result.profit >= 0 ? 'positive' : 'negative';
  } catch (error) {
    by_id('recipe_result').textContent = error.message;
    by_id('recipe_result').className = 'secondary';
  }
}

by_id('market_quotes').addEventListener('input', () => update_quote_status(true));
by_id('market_quotes').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const quotes = common_currencies.map(currency => ({currency, ...Object.fromEntries(['buy', 'sell'].map(direction => [direction, Object.fromEntries(['input', 'output'].map(side => [side, document.querySelector(`[data-currency="${currency}"][data-direction="${direction}"][data-side="${side}"]`)?.value ?? '']))]))}));
    const league = analysis.leagues.find(league => league.name === by_id('league').value);
    apply_market_quotes(league, quotes);
    market_quotes.set(league.name, quotes);
    by_id('market_quote_error').hidden = true;
    render();
  } catch (error) {by_id('market_quote_error').hidden = false; by_id('market_quote_error').textContent = error.message;}
});
by_id('reset_market_quotes').addEventListener('click', () => {market_quotes.delete(by_id('league').value); render_market_quotes(); render();});

by_id('recipe_controls').addEventListener('submit', event => event.preventDefault());
by_id('recipe').addEventListener('change', select_recipe);
for (const id of ['recipe_batches']) by_id(id).addEventListener('input', render_recipe);
by_id('controls').addEventListener('submit', event => event.preventDefault());
by_id('league').addEventListener('change', () => {update_currencies(); render_market_quotes(); render();});
for (const id of ['start', 'budget', 'haircut', 'min_profit', 'min_volume', 'min_stock', 'max_trades', 'route_type', 'gold_budget', 'sort_by']) by_id(id).addEventListener('input', render);
by_id('rows').addEventListener('click', event => {
  const button = event.target.closest('button[data-cycle]');
  if (button) {show_details(Number(button.dataset.cycle)); by_id('details').scrollIntoView({behavior:'smooth', block:'start'});}
});
by_id('show_more').addEventListener('click', () => {page_size += 40; render_rows();});
by_id('close_details').addEventListener('click', () => {selected_index = null; by_id('details').hidden = true; render_rows();});
await load_analysis();
