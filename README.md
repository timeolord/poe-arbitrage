# PoE Arbitrage

A currency arbitrage scanner for Path of Exile, built with Rust and a static web dashboard. Uses GGG's hourly Currency Exchange history to find market and vendor trading cycles and estimate the profit after returning to the starting currency.

Live at [www.melkyway.ca/poe-arbitrage](https://www.melkyway.ca/poe-arbitrage/).

## Overview

The scanner treats currencies as a directed graph, with exchange rates calculated from traded volumes. The dashboard searches market and vendor cycles from two trades up to the user’s maximum (2–8), including the return trade. Each currency appears once before returning to the starting currency, and leagues remain separate.

The dashboard simulates each cycle using a whole-unit starting balance. It shows the ending balance, profit percentage, historical rate range, estimated gold fees, gold per unit of profit, and details for each trade. Filters select the league, starting currency, minimum profit, minimum traded volume, minimum historical output stock, maximum trades, and an optional gold budget. Cycles can be sorted by profit percentage, profit per 100,000 gold, or profit per click. An optional haircut reduces the estimated return on each market trade to model slippage. Fixed vendor trades use exact whole batches without a haircut.

Only quoted currency items enter the cycle graph. Currency recipes have a separate calculator that values every input and reward against direct historical Chaos market quotes. The catalogue contains only deterministic currency exchanges.

## Usage

Select your league and starting currency on the website, enter a starting amount, and inspect a cycle to see its individual trades. The displayed profit includes rounding and the selected haircut. In an inspected cycle, enter the give and receive quantities for each market leg and choose Recalculate cycle to test current prices. Decimal quantities are accepted with up to 12 decimal places using exact rational arithmetic. Vendor batches stay fixed. Manual scenarios update the ending balance, profit and gold costs without changing the historical search results, stock or volume. Reset historical rates restores the original scenario.

To scan a snapshot from the command line:

```fish
cargo run --locked --release -- data/snapshot.json analysis.json Allflame 1000
```

This writes results for all leagues to JSON and prints the ten highest positive central returns for the selected league. The command line uses each cycle's canonical starting currency; the dashboard searches directly from your selected currency.

## Development

This project uses Nix flakes. Enter the dev shell with:

```fish
direnv allow
```

Or enter it manually with `nix develop`. The shell provides Rust, Python, Node, Git, and GitHub CLI. Python uses only its standard library, and the dashboard has no npm dependencies.

Fetch a snapshot, run the scanner, and serve the dashboard:

```fish
python3 scripts/fetch_snapshot.py
cargo run --locked --release -- data/snapshot.json web/data/analysis.json
python3 -m http.server 8080 --directory web
```

Open [localhost:8080](http://localhost:8080).

Run the tests with:

```fish
cargo test --locked
node --test tests/core.test.mjs
```

## Architecture

`src/lib.rs` builds the currency graph, finds market and vendor cycles, and simulates integer balances. `src/main.rs` provides the command line interface and writes the analysis JSON.

`scripts/fetch_snapshot.py` fetches an hourly snapshot from GGG. `web/` contains the dashboard and browser calculator, which uses JavaScript BigInt for whole-unit balances.

Browser searches run in a cancellable web worker using the full edge graph, independently of the Rust precomputed cycles. Searches stop after two million edge checks or 25,000 matching cycles. The dashboard explicitly labels partial results; counts, best returns and medians then describe only the cycles found. Lower the maximum trades or increase minimum volume for a complete search.

The GitHub Actions workflow tests the project, fetches a snapshot, scans cycles, and deploys `web/` to GitHub Pages. It runs on pushes, manual dispatch, and hourly at minute 17. Raw snapshots are archived for 30 days. A failed refresh leaves the previous deployment in place.

## Calculations

The central exchange rate from currency A to B is `volume_traded[B] / volume_traded[A]`. Before rounding or haircut, cycle profit is `100 * (product(rates) - 1)`.

The browser applies the following calculation to each market trade, where `haircut_bps` is the haircut in hundredths of a percent:

```text
ending_amount = floor(amount * output_volume * (10000 - haircut_bps) / (input_volume * 10000))
profit_percent = 100 * (ending_balance / starting_balance - 1)
```

The historical range uses the two complete ratio vectors reported by GGG. Each vector is converted to a directed rate, then the rates are ordered into low and high values. Multiplying the low rates and high rates across a cycle gives the displayed range before rounding and haircut.

Pairs with zero volume, invalid ratios, or a central rate outside the reported range are skipped. The volume filter applies independently to both sides of every market trade. Every market leg must meet the selected minimum historical output stock threshold in cycle searches and recipe quotes. Both reported stock endpoints must be at least the threshold, which counts units of the receiving currency. The default is 1, retaining the exclusion of zero or missing stock. Equal stock passes the threshold. Fixed vendor trades are exempt. A zero minimum means stock reached zero at some point during the hour, not necessarily that nobody traded. Positive historical stock does not establish current liquidity. Vendor quantities are recipe batch sizes, not observed liquidity.

## Vendor recipes

`web/vendor_recipes.json` contains the sourced currency recipe catalogue. The scanner adds fixed one-input, one-output vendor exchanges alongside market edges, retaining both when they connect the same currencies. This includes the directional Portal and Wisdom scroll trades, the normal currency purchase chain, Kirac's Unmaking exchange, currency sales for Wisdom Scrolls, and quoted adjacent essence upgrades. Vendor-only cycles are excluded.

A vendor leg returns `floor(amount / input_batch) * output_batch`. Unspent inputs are displayed but excluded from the ending balance. The catalogue uses documented 3.29 non-Ruthless rules against the historical snapshot; it does not reconstruct vendor rules from the snapshot's patch date. Vendor scanning and recipe estimates are disabled for Ruthless leagues.

The recipe calculator buys each currency ingredient with Chaos Orbs using a direct quote, rounding the required Chaos up. It then sells every currency reward back to Chaos and rounds down. Profit percentage is `100 * (return / total_cost - 1)`. Missing quotes suppress estimates, and a zero cost has no defined percentage. Gold estimates include purchases of currency ingredients and sales of currency rewards. Direct Chaos inputs and outputs need no additional market order. Available orders, travel time and gold fees are not supplied by GGG's hourly feed; fees come from the separate table described below.

The catalogue contains 16 fixed exchanges and two currency baskets: Fusing plus Chromatic to Jeweller, and the Mirror sale with multiple currency rewards. Equipment, gem, flask, quest-item and map recipes, random exchanges, retired recipes and unused references are excluded. Quoted adjacent essence upgrades remain in the scanner. Each catalogue entry links its rate reference and the 3.29 patch notes. The review checks documented rates against patch changes; it is not an in-game verification. [GGG removed Jeweller’s-to-Chromatic purchases in 3.29](https://www.pathofexile.com/forum/view-thread/3985332), so that exchange is excluded.

## Manual market prices

The Manual Chaos prices panel accepts separate buying and selling quotes for common crafting currencies and scrolls. Enter the amounts given and received, then choose Apply prices and search to scan the full graph with those rates. Leave both amounts blank to retain the snapshot quote for that direction. No reciprocal quote is inferred. Reset restores historical prices. Applied quotes are kept separately for each league during the page session.

Only existing market pairs can be edited. Their historical stock and hourly volume remain unchanged for filters and context; the entered amounts set the conversion ratio, not the observed liquidity. Vendor rates and unedited pairs stay fixed. Search balances, profit, gold, clicks and recipe estimates use the applied prices, haircut and rounding. Results mark cycles that include manual prices; historical ranges continue to describe the original snapshot. Recalculating an inspected cycle shares its edited market pairs with all cycle listings and recipe estimates in that league, including pairs outside the Chaos panel. The full graph is searched again, so cycles can appear, disappear or change order. The inspector stays open even if the edited cycle no longer meets the filters. Buying and selling directions remain independent, and unchanged rates create no new override. The Chaos panel reflects shared quotes for its currencies; resetting inspected pairs restores their historical rates everywhere. The panel reset clears all manual pairs for the selected league.

## Click efficiency

The browser estimates one click for each Faustus market leg with a nonzero input. A vendor leg requires `floor(input_amount / input_batch)` clicks, one for each completed recipe batch, even when the batch returns multiple items. Leftovers add no clicks. Total clicks include the closing trade, and profit per click is `(ending_balance - starting_balance) / total_clicks` in the selected starting currency. Losses have negative efficiency; zero clicks leave it undefined. Setup, inventory movement, travel, cancellations and reposting are excluded from this model.

Cycle results show total clicks and profit per click, with per-leg counts in the inspector. Manual price scenarios recalculate the vendor batches as balances change. Recipe estimates count each requested vendor batch plus one click per market ingredient purchase or reward sale. Choose Profit per click to rank cycles by this estimate. The Rust command line continues to report currency returns.

## Gold costs

`web/gold_fees.json` contains receiving item fees from [PoEDB's Currency Exchange table](https://poedb.tw/us/Currency_Exchange), matched to full GGG item IDs using [RePoE's game data export](https://repoe-fork.github.io/base_items.json). The table records its patch, review date and source URLs. It uses 3.29 fees against the selected historical prices; it does not reconstruct past patch fees. The browser and worker use this table; the Rust command line continues to report currency returns.

Each market leg costs `ceil(received_quantity * fee_numerator / fee_denominator)` gold. Quantities are the simulated whole item outputs after haircut and rounding. Vendor legs cost no exchange gold. Fractions use exact integer arithmetic and conservative upward rounding per leg, which has not been verified in game. The estimate assumes one listing per market leg without cancellations, partial fill refunds or reposting. Check the displayed gold fee in game before placing an order.

Total gold is the sum of all market fees, including the closing trade. Gold per currency earned is `total_gold / (ending_balance - starting_balance)`. Profit per 100,000 gold is `(ending_balance - starting_balance) * 100000 / total_gold`. Efficiency requires positive profit, and the second ratio requires positive gold. Gold remains a separate expense and is not subtracted from the currency balance. Recipe estimates use the same calculation for buying ingredients and selling rewards.

Unknown item fees leave the total and efficiency unavailable. Entering a gold budget excludes cycles with unknown fees or totals above the budget; leaving the field blank removes that constraint. Unknown or undefined efficiencies sort after defined efficiencies, with profit percentage breaking ties. Best and median returns are calculated independently of the selected sort order. Update the fee table when game patches change fees, retaining the full item IDs and rational fee pairs.

## Data

Data comes from [GGG's Currency Exchange API](https://www.pathofexile.com/developer/docs/reference#currencyexchange). The fetcher requests the previous completed hour, falling back one hour if the newest snapshot has not been published. No API credentials are required.

To fetch a specific hour:

```fish
python3 scripts/fetch_snapshot.py --realm pc --hour 1790899200 --output data/snapshot.json
```

The hour must be a Unix timestamp on an hourly boundary. Older snapshots may eventually become unavailable.

These are historical aggregates, so the rates and range endpoints may come from trades at different times. The range is not a confidence interval or a set of simultaneous quotes. Order lot sizes and executable liquidity are not available; the calculator assumes whole-unit fills, excludes intermediate leftovers, accounts for gold separately, and displays hourly stock only as context. Check current in-game rates before trading.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
