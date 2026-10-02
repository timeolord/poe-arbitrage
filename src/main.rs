use poe_arbitrage::{analyze, simulate_cycle, Snapshot};
use std::{env, error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        return Err("usage: poe-arbitrage snapshot.json analysis.json [league] [budget]".into());
    }
    let snapshot: Snapshot = serde_json::from_slice(&fs::read(&args[1])?)?;
    let analysis = analyze(&snapshot);
    if let Some(parent) = Path::new(&args[2])
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }
    fs::write(&args[2], serde_json::to_vec(&analysis)?)?;
    let budget: u64 = args.get(4).map(|s| s.parse()).transpose()?.unwrap_or(1000);
    if budget == 0 {
        return Err("budget must be positive".into());
    }
    for league in analysis
        .leagues
        .iter()
        .filter(|l| args.get(3).is_none_or(|name| name == &l.name))
    {
        println!(
            "{}: {} active pairs, {} cycles, {} skipped pairs",
            league.name,
            league.active_pairs,
            league.cycles.len(),
            league.skipped_pairs
        );
        for cycle in league
            .cycles
            .iter()
            .filter(|c| c.profit_pct > 0.001)
            .take(10)
        {
            let end = simulate_cycle(&cycle.legs, budget, 0).ok_or("simulation overflow")?;
            println!("{} → {}: model {:+.3}%, rounded {:+.3}% ({budget} → {end}), range {:+.3}% to {:+.3}%",
                cycle.path.iter().map(|id| id.rsplit('/').next().unwrap_or(id)).collect::<Vec<_>>().join(" → "),
                cycle.path[0].rsplit('/').next().unwrap_or(&cycle.path[0]), cycle.profit_pct,
                (end as f64 / budget as f64 - 1.0) * 100.0, cycle.low_profit_pct, cycle.high_profit_pct);
        }
    }
    Ok(())
}
