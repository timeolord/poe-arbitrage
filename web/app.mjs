import {currency_name, rank_cycles} from './core.mjs';

const by_id = id => document.getElementById(id);
const format_number = value => new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
const format_pct = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const escape_html = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const route_html = path => `<div class="route">${[...path, path[0]].map(currency_name).map(escape_html).join('<span>→</span>')}</div>`;
let analysis;
let ranked = [];
let page_size = 40;
let selected_index = null;

function set_error(message) {
  by_id('error').hidden = !message;
  by_id('error').textContent = message;
}

function read_options() {
  if (!by_id('controls').checkValidity()) throw new Error('Enter valid numbers in each field.');
  const options = {start: by_id('start').value, budget: Number(by_id('budget').value), haircut_bps: Math.round(Number(by_id('haircut').value) * 100), min_volume: Number(by_id('min_volume').value), min_profit: Number(by_id('min_profit').value)};
  if (!Number.isSafeInteger(options.min_volume) || options.min_volume < 1) throw new Error('Minimum volume must be a positive whole number.');
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
    <td>${route_html(cycle.path)}</td>
    <td><span class="profit ${cycle.simulation.profit_pct >= 0 ? 'positive' : 'negative'}">${format_pct(cycle.simulation.profit_pct)}</span><span class="secondary">after rounding &amp; haircut</span></td>
    <td>${format_number(cycle.simulation.end)}</td><td>${cycle.simulation.profit >= 0 ? '+' : ''}${format_number(cycle.simulation.profit)}</td>
    <td>${format_pct(cycle.low_profit_pct)} to ${format_pct(cycle.high_profit_pct)}<span class="secondary">unrounded, before haircut</span></td>
    <td><button type="button" data-cycle="${index}" aria-label="Inspect cycle ${index + 1}">Inspect</button></td></tr>`).join('');
  by_id('empty').hidden = ranked.length !== 0;
  by_id('show_more').hidden = ranked.length <= page_size;
  by_id('result_count').textContent = `${Math.min(page_size, ranked.length)} of ${ranked.length} matching cycles`;
}

function show_details(index) {
  selected_index = index;
  const cycle = ranked[index];
  by_id('details').hidden = false;
  by_id('detail_content').innerHTML = `${route_html(cycle.path)}<div class="detail-stats">
    <div><span>Modeled cycle profit</span><strong class="${cycle.simulation.profit_pct >= 0 ? 'positive' : 'negative'}">${format_pct(cycle.simulation.profit_pct)}</strong></div>
    <div><span>Unrounded central return</span><strong>${format_pct(cycle.profit_pct)}</strong></div>
    <div><span>Ending ${escape_html(currency_name(cycle.path[0]))}</span><strong>${format_number(cycle.simulation.end)}</strong></div></div>
    <div class="table-wrap"><table><thead><tr><th>Trade</th><th>Input → output</th><th>Average rate</th><th>Hourly volumes</th><th>Historical output stock</th></tr></thead><tbody>
    ${cycle.legs.map((leg, i) => `<tr><td>${escape_html(currency_name(leg.from))} → ${escape_html(currency_name(leg.to))}</td>
      <td>${format_number(cycle.simulation.amounts[i])} → ${format_number(cycle.simulation.amounts[i + 1])}</td>
      <td>${leg.rate.toPrecision(6)} per input unit<span class="secondary">${leg.low_rate.toPrecision(5)} to ${leg.high_rate.toPrecision(5)}</span></td>
      <td>${format_number(leg.input_volume)} input / ${format_number(leg.output_volume)} output</td>
      <td>${format_number(leg.historical_low_stock)} to ${format_number(leg.historical_high_stock)}</td></tr>`).join('')}</tbody></table></div>
    <p>Return = (ending amount ÷ starting amount − 1) × 100. Gold is excluded. Rates are historical hourly averages; check every leg and its available quantity in game before using this route.</p>
    ${cycle.legs.some((leg, i) => cycle.simulation.amounts[i] > leg.input_volume) ? '<p>Your modeled trade size exceeds the entire observed hourly input volume on at least one leg. This estimate extrapolates beyond the sample and is especially uncertain.</p>' : ''}`;
  render_rows();
}

function render() {
  if (!analysis) return;
  try {
    const options = read_options();
    const league = analysis.leagues.find(league => league.name === by_id('league').value);
    ranked = rank_cycles(league, options);
    page_size = 40;
    selected_index = null;
    by_id('details').hidden = true;
    by_id('cycle_count').textContent = format_number(ranked.length);
    by_id('pair_count').textContent = format_number(league.active_pairs);
    by_id('best_return').textContent = ranked.length ? format_pct(ranked[0].simulation.profit_pct) : '—';
    by_id('best_return').className = ranked.length && ranked[0].simulation.profit_pct >= 0 ? 'positive' : '';
    const middle = Math.floor(ranked.length / 2);
    const median = ranked.length % 2 ? ranked[middle]?.simulation.profit_pct : (ranked[middle - 1]?.simulation.profit_pct + ranked[middle]?.simulation.profit_pct) / 2;
    by_id('median_return').textContent = ranked.length ? format_pct(median) : '—';
    render_rows();
    set_error('');
  } catch (error) {
    set_error(error.message);
    ranked = [];
    selected_index = null;
    by_id('details').hidden = true;
    for (const id of ['cycle_count', 'best_return', 'median_return', 'pair_count']) by_id(id).textContent = '—';
    render_rows();
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
    const start = new Date(analysis.hour * 1000);
    const end = new Date((analysis.hour + 3600) * 1000);
    const age_hours = (Date.now() / 1000 - analysis.hour - 3600) / 3600;
    by_id('snapshot_time').textContent = `${analysis.realm.toUpperCase()} · ${start.toLocaleString()} – ${end.toLocaleTimeString()} · ${age_hours > 3 ? 'stale snapshot' : 'completed hour'}`;
    by_id('source_link').href = analysis.source_url;
    render();
  } catch (error) {
    by_id('snapshot_time').textContent = 'Snapshot unavailable';
    by_id('result_count').textContent = 'No data loaded';
    set_error(`${error.message} Run the snapshot fetcher and Rust scanner, then serve the web directory over HTTP.`);
  }
}

by_id('controls').addEventListener('submit', event => event.preventDefault());
by_id('league').addEventListener('change', () => {update_currencies(); render();});
for (const id of ['start', 'budget', 'haircut', 'min_profit', 'min_volume']) by_id(id).addEventListener('input', render);
by_id('rows').addEventListener('click', event => {
  const button = event.target.closest('button[data-cycle]');
  if (button) {show_details(Number(button.dataset.cycle)); by_id('details').scrollIntoView({behavior:'smooth', block:'start'});}
});
by_id('show_more').addEventListener('click', () => {page_size += 40; render_rows();});
by_id('close_details').addEventListener('click', () => {selected_index = null; by_id('details').hidden = true; render_rows();});
await load_analysis();
