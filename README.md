# PoE Arbitrage

A currency arbitrage scanner for Path of Exile, built with Rust and a static web dashboard. Uses GGG's hourly Currency Exchange history to find triangular trading cycles and estimate the profit after returning to the starting currency.

Live at [www.melkyway.ca/poe-arbitrage](https://www.melkyway.ca/poe-arbitrage/).

## Overview

The scanner treats currencies as a directed graph, with exchange rates calculated from traded volumes. It looks for three-trade cycles such as chaos → divine → exalted → chaos, keeping leagues separate and removing duplicate rotations of the same route.

The dashboard simulates each cycle using a whole-unit starting balance. It shows the ending balance, profit percentage, historical rate range, and details for each trade. Filters select the league, starting currency, minimum profit, and minimum traded volume. An optional haircut reduces the estimated return on each trade to model slippage.

Only currency items are included. Fragments, scarabs, and divination cards are outside the current scope.

## Usage

Select your league and starting currency on the website, enter a starting amount, and inspect a cycle to see its individual trades. The displayed profit includes rounding and the selected haircut.

To scan a snapshot from the command line:

```fish
cargo run --locked --release -- data/snapshot.json analysis.json Allflame 1000
```

This writes results for all leagues to JSON and prints the ten highest positive central returns for the selected league. The command line uses each cycle's canonical starting currency; the dashboard rotates cycles to your selected currency.

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

`src/lib.rs` builds the currency graph, finds triangular cycles, and simulates integer balances. `src/main.rs` provides the command line interface and writes the analysis JSON.

`scripts/fetch_snapshot.py` fetches an hourly snapshot from GGG. `web/` contains the dashboard and browser calculator, which uses JavaScript BigInt for whole-unit balances.

The GitHub Actions workflow tests the project, fetches a snapshot, scans cycles, and deploys `web/` to GitHub Pages. It runs on pushes, manual dispatch, and hourly at minute 17. Raw snapshots are archived for 30 days. A failed refresh leaves the previous deployment in place.

## Calculations

The central exchange rate from currency A to B is `volume_traded[B] / volume_traded[A]`. Before rounding or haircut, cycle profit is `100 * (product(rates) - 1)`.

The browser applies the following calculation to each trade, where `haircut_bps` is the haircut in hundredths of a percent:

```text
ending_amount = floor(amount * output_volume * (10000 - haircut_bps) / (input_volume * 10000))
profit_percent = 100 * (ending_balance / starting_balance - 1)
```

The historical range uses the two complete ratio vectors reported by GGG. Each vector is converted to a directed rate, then the rates are ordered into low and high values. Multiplying the low rates and high rates across a cycle gives the displayed range before rounding and haircut.

Pairs with zero volume, invalid ratios, or a central rate outside the reported range are skipped. The volume filter applies independently to both sides of every trade.

## Data

Data comes from [GGG's Currency Exchange API](https://www.pathofexile.com/developer/docs/reference#currencyexchange). The fetcher requests the previous completed hour, falling back one hour if the newest snapshot has not been published. No API credentials are required.

To fetch a specific hour:

```fish
python3 scripts/fetch_snapshot.py --realm pc --hour 1790899200 --output data/snapshot.json
```

The hour must be a Unix timestamp on an hourly boundary. Older snapshots may eventually become unavailable.

These are historical aggregates, so the rates and range endpoints may come from trades at different times. The range is not a confidence interval or a set of simultaneous quotes. Order lot sizes and executable liquidity are not available; the calculator assumes whole-unit fills, excludes intermediate leftovers and gold costs, and displays hourly stock only as context. Check current in-game rates before trading.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
