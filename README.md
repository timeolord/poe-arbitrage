# PoE Arbitrage

A Rust scanner and static dashboard for triangular currency cycles using GGG's public hourly Currency Exchange history. Profit percentage, budget simulation, per-trade haircut, historical ranges, volumes, and stock are visible for each cycle. The website uses relative URLs and can be served at `/poe-arbitrage/` by GitHub Pages.

## Development

Enter the environment with `direnv allow` or `nix develop`. The flake includes Rust, Node, Python, Git, and GitHub CLI. Python uses only its standard library; the dashboard has no npm dependencies.

```fish
python3 scripts/fetch_snapshot.py
cargo test --locked
node --test tests/core.test.mjs
cargo run --locked --release -- data/snapshot.json web/data/analysis.json
python3 -m http.server 8080 --directory web
```

Open `http://localhost:8080`. Select your league and starting currency, enter a whole-unit budget, and inspect a cycle. Only currencies under `Metadata/Items/Currency/` are included; fragments, scarabs, and divination cards are outside this first draft.

## Command line

```fish
cargo run --locked --release -- data/snapshot.json analysis.json Allflame 1000
```

The program writes all league results to JSON and prints the ten highest positive central returns for the selected league. CLI cycles start at their canonical internal identifier, shown explicitly in each route. The web calculator rotates the cycle to your selected starting currency.

```fish
python3 scripts/fetch_snapshot.py --realm pc --hour 1790899200 --output data/snapshot.json
```

The optional hour is a Unix timestamp exactly on an hourly boundary. The fetcher requests the previous completed hour, falling back by one hour only if the newest hour has not been published. Network failures stop the refresh, preserving the last deployed website. It does not poll aggressively or bypass caches.

## Calculations

For a pair A/B, the central rate from A to B is `volume_traded[B] / volume_traded[A]`. This is an aggregate traded-volume ratio, not a live bid or ask. It gives the reciprocal rate in the reverse direction. Cycles can still show discrepancies because different pairs traded at different times and with different volume weights.

Unrounded cycle profit is `100 * (product(rates) - 1)`. The web profit applies `floor(amount * output_volume * (10000 - haircut_bps) / (input_volume * 10000))` to every leg, then reports `100 * (ending_amount / starting_amount - 1)`. The haircut is a user assumption, not a measured exchange fee. Integer amounts use Rust integer arithmetic or JavaScript BigInt. Percentage display uses floating point. Rust's library simulator accepts whole-percent haircuts; the browser supports hundredths of a percent.

The low and high ratio dictionaries each describe one ratio vector. The scanner divides the output component by the input component for each vector, then orders the resulting rates. It never divides a component from the low vector by a component from the high vector. Multiplying the three low rates and three high rates yields an illustrative historical scenario range before haircut and rounding. This is not a confidence interval or simultaneous quote.

Zero-volume, zero-ratio, and malformed currency pairs are skipped. A central rate outside the reported ratio range is also skipped. Graphs are separated by league and snapshot. Cycles are deduplicated by rotation, preserving both trade directions. The minimum-volume filter applies to each side of each leg independently and is not a common-value liquidity measure.

The unit-fill calculator is synthetic: aggregate ratios do not expose order lot sizes. Intermediate remainders are excluded. Hourly stock extrema are displayed only as context; no maximum executable budget is inferred. Gold costs are excluded. Historical price extrema may have occurred at different times, so all routes require current in-game verification.

## GitHub Pages

The `Refresh and publish` workflow tests the program, fetches one GGG hour, scans cycles, archives the raw snapshot for 30 days, and publishes only `web/`. It runs on pushes, manual dispatch, and an hourly schedule at minute 17. GitHub schedules can be delayed. A failed refresh leaves the previous deployment intact. No credentials or OAuth keys are required for GGG's public endpoint.

Run the publishing helper in fish after authenticating GitHub CLI, or create the public repository through GitHub and push the sources yourself.

```fish
gh auth login
fish scripts/publish.fish
```

GitHub Pages is available for this public repository on GitHub Free. Both source code and generated website data will be public. If publishing is interrupted, inspect the existing repository before rerunning the helper; it deliberately will not overwrite an existing remote.

The account's existing user-site repository, `timeolord.github.io`, is configured for `www.melkyway.ca`. This project has no separate custom domain or CNAME file, so its Pages site inherits that domain and is served at `https://www.melkyway.ca/poe-arbitrage/`. The existing user-site domain and DNS do not need to change.

## Sources

GGG's API documentation is at https://www.pathofexile.com/developer/docs/reference#currencyexchange. The public endpoint is `https://web.poecdn.com/api/currency-exchange[/realm][/id]`. It provides historical hourly aggregates, excludes current-hour data, and can eventually remove old history.

GitHub's domain inheritance documentation is at https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
