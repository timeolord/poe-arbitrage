use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Snapshot {
    pub hour: u64,
    pub realm: String,
    pub fetched_at: u64,
    pub source_url: String,
    pub next_change_id: u64,
    pub markets: Vec<Market>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Market {
    pub league: String,
    pub market_pair: Vec<String>,
    pub volume_traded: BTreeMap<String, u64>,
    pub lowest_ratio: BTreeMap<String, u64>,
    pub highest_ratio: BTreeMap<String, u64>,
    pub lowest_stock: BTreeMap<String, u64>,
    pub highest_stock: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub input_volume: u64,
    pub output_volume: u64,
    pub rate: f64,
    pub low_rate: f64,
    pub high_rate: f64,
    pub historical_low_stock: u64,
    pub historical_high_stock: u64,
}

#[derive(Debug, Serialize)]
pub struct Cycle {
    pub path: Vec<String>,
    pub legs: Vec<Edge>,
    pub profit_pct: f64,
    pub low_profit_pct: f64,
    pub high_profit_pct: f64,
}

#[derive(Debug, Serialize)]
pub struct League {
    pub name: String,
    pub currencies: Vec<String>,
    pub active_pairs: usize,
    pub skipped_pairs: usize,
    pub cycles: Vec<Cycle>,
}

#[derive(Debug, Serialize)]
pub struct Analysis {
    pub schema_version: u8,
    pub hour: u64,
    pub realm: String,
    pub fetched_at: u64,
    pub source_url: String,
    pub next_change_id: u64,
    pub leagues: Vec<League>,
}

fn ratio(values: &BTreeMap<String, u64>, from: &str, to: &str) -> Option<f64> {
    let input = *values.get(from)?;
    let output = *values.get(to)?;
    (input > 0 && output > 0).then_some(output as f64 / input as f64)
}

pub fn make_edge(market: &Market, from: &str, to: &str) -> Option<Edge> {
    let rate = ratio(&market.volume_traded, from, to)?;
    let first = ratio(&market.lowest_ratio, from, to)?;
    let second = ratio(&market.highest_ratio, from, to)?;
    let low_rate = first.min(second);
    let high_rate = first.max(second);
    if rate < low_rate * (1.0 - 1e-9) || rate > high_rate * (1.0 + 1e-9) {
        return None;
    }
    Some(Edge {
        from: from.to_owned(),
        to: to.to_owned(),
        input_volume: market.volume_traded[from],
        output_volume: market.volume_traded[to],
        rate,
        low_rate,
        high_rate,
        historical_low_stock: *market.lowest_stock.get(to).unwrap_or(&0),
        historical_high_stock: *market.highest_stock.get(to).unwrap_or(&0),
    })
}

pub fn cycle_profit(rates: impl IntoIterator<Item = f64>) -> f64 {
    (rates.into_iter().product::<f64>() - 1.0) * 100.0
}

pub fn simulate_cycle(legs: &[Edge], budget: u64, haircut_pct: u64) -> Option<u64> {
    if haircut_pct >= 100 {
        return None;
    }
    legs.iter().try_fold(budget, |amount, leg| {
        if leg.input_volume == 0 || leg.output_volume == 0 {
            return None;
        }
        let output = (amount as u128)
            .checked_mul(leg.output_volume as u128)?
            .checked_mul((100 - haircut_pct) as u128)?
            / (leg.input_volume as u128).checked_mul(100)?;
        u64::try_from(output).ok()
    })
}

pub fn analyze(snapshot: &Snapshot) -> Analysis {
    let names: BTreeSet<_> = snapshot.markets.iter().map(|m| m.league.clone()).collect();
    let leagues = names
        .into_iter()
        .map(|name| {
            let mut graph = BTreeMap::<String, BTreeMap<String, Edge>>::new();
            let mut active_pairs = 0;
            let mut skipped_pairs = 0;
            for market in snapshot.markets.iter().filter(|m| m.league == name) {
                if market.market_pair.len() != 2
                    || market
                        .market_pair
                        .iter()
                        .any(|id| !id.starts_with("Metadata/Items/Currency/"))
                {
                    continue;
                }
                let a = &market.market_pair[0];
                let b = &market.market_pair[1];
                match (make_edge(market, a, b), make_edge(market, b, a)) {
                    (Some(forward), Some(reverse)) if a != b => {
                        graph
                            .entry(a.clone())
                            .or_default()
                            .insert(b.clone(), forward);
                        graph
                            .entry(b.clone())
                            .or_default()
                            .insert(a.clone(), reverse);
                        active_pairs += 1;
                    }
                    _ => skipped_pairs += 1,
                }
            }
            let mut cycles = Vec::new();
            for (a, neighbors) in &graph {
                for (b, ab) in neighbors {
                    for (c, bc) in &graph[b] {
                        if c == a || a > b || a > c {
                            continue;
                        }
                        if let Some(ca) = graph[c].get(a) {
                            let legs = vec![ab.clone(), bc.clone(), ca.clone()];
                            cycles.push(Cycle {
                                path: vec![a.clone(), b.clone(), c.clone()],
                                profit_pct: cycle_profit(legs.iter().map(|e| e.rate)),
                                low_profit_pct: cycle_profit(legs.iter().map(|e| e.low_rate)),
                                high_profit_pct: cycle_profit(legs.iter().map(|e| e.high_rate)),
                                legs,
                            });
                        }
                    }
                }
            }
            cycles.sort_by(|a, b| b.profit_pct.total_cmp(&a.profit_pct));
            League {
                name,
                currencies: graph.keys().cloned().collect(),
                active_pairs,
                skipped_pairs,
                cycles,
            }
        })
        .collect();
    Analysis {
        schema_version: 1,
        hour: snapshot.hour,
        realm: snapshot.realm.clone(),
        fetched_at: snapshot.fetched_at,
        source_url: snapshot.source_url.clone(),
        next_change_id: snapshot.next_change_id,
        leagues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn edge(input_volume: u64, output_volume: u64) -> Edge {
        Edge {
            from: "a".into(),
            to: "b".into(),
            input_volume,
            output_volume,
            rate: output_volume as f64 / input_volume as f64,
            low_rate: 1.0,
            high_rate: 2.0,
            historical_low_stock: 0,
            historical_high_stock: 0,
        }
    }
    #[test]
    fn full_cycle_percentage() {
        assert!((cycle_profit([2.0, 3.0, 0.2]) - 20.0).abs() < 1e-10);
        assert!((cycle_profit([2.0, 0.5])).abs() < 1e-10);
    }
    #[test]
    fn integer_rounding_and_haircut() {
        let legs = [edge(1, 2), edge(1, 3), edge(5, 1)];
        assert_eq!(simulate_cycle(&legs, 100, 0), Some(120));
        assert_eq!(simulate_cycle(&legs, 100, 1), Some(116));
        assert_eq!(simulate_cycle(&[edge(3, 1)], 2, 0), Some(0));
        assert_eq!(simulate_cycle(&legs, 100, 100), None);
        assert_eq!(simulate_cycle(&[edge(0, 1)], 100, 0), None);
    }
    #[test]
    fn ignores_zero_volume_and_separates_leagues() {
        let market = |a: &str, b: &str, x: u64, y: u64, league: &str| {
            let a = format!("Metadata/Items/Currency/{a}");
            let b = format!("Metadata/Items/Currency/{b}");
            let values = BTreeMap::from([(a.clone(), x), (b.clone(), y)]);
            Market {
                league: league.into(),
                market_pair: vec![a, b],
                volume_traded: values.clone(),
                lowest_ratio: values.clone(),
                highest_ratio: values,
                lowest_stock: BTreeMap::new(),
                highest_stock: BTreeMap::new(),
            }
        };
        let mut snapshot = Snapshot {
            hour: 1,
            realm: "pc".into(),
            fetched_at: 2,
            source_url: "fixture".into(),
            next_change_id: 3601,
            markets: vec![
                market("a", "b", 1, 2, "one"),
                market("b", "c", 1, 3, "one"),
                market("c", "a", 5, 1, "two"),
            ],
        };
        assert!(analyze(&snapshot)
            .leagues
            .iter()
            .all(|l| l.cycles.is_empty()));
        snapshot.markets[2].league = "one".into();
        assert_eq!(analyze(&snapshot).leagues[0].cycles.len(), 2);
        snapshot.markets[2]
            .volume_traded
            .values_mut()
            .for_each(|v| *v = 0);
        assert!(analyze(&snapshot).leagues[0].cycles.is_empty());
    }
}
