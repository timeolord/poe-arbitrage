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
    pub kind: String,
    pub vendor: Option<String>,
    pub recipe_id: Option<String>,
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
    pub edges: Vec<Edge>,
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
        kind: "market".into(),
        vendor: None,
        recipe_id: None,
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
        if leg.kind == "vendor" {
            return u64::try_from((amount / leg.input_volume) as u128 * leg.output_volume as u128)
                .ok();
        }
        let output = (amount as u128)
            .checked_mul(leg.output_volume as u128)?
            .checked_mul((100 - haircut_pct) as u128)?
            / (leg.input_volume as u128).checked_mul(100)?;
        u64::try_from(output).ok()
    })
}

#[derive(Deserialize)]
struct VendorCatalog {
    recipes: Vec<VendorRecipe>,
}
#[derive(Deserialize)]
struct VendorRecipe {
    id: String,
    kind: String,
    vendor: String,
    inputs: BTreeMap<String, u64>,
    outputs: BTreeMap<String, u64>,
}

fn add_vendor_edges(graph: &mut BTreeMap<String, Vec<Edge>>) {
    let catalog: VendorCatalog = serde_json::from_str(include_str!("../web/vendor_recipes.json"))
        .expect("valid vendor catalogue");
    let mut recipes: Vec<_> = catalog
        .recipes
        .into_iter()
        .filter(|r| r.kind == "fixed")
        .collect();
    for from in graph.keys() {
        let suffix = from.rsplit('/').next().unwrap_or(from);
        if suffix.starts_with("CurrencyEssence") {
            if let Some(tier) = suffix.chars().last().and_then(|c| c.to_digit(10)) {
                let to = format!("{}{}", &from[..from.len() - 1], tier + 1);
                if graph.contains_key(&to) {
                    recipes.push(VendorRecipe {
                        id: format!("upgrade_{suffix}"),
                        kind: "fixed".into(),
                        vendor: "Any town vendor, three matching essences".into(),
                        inputs: BTreeMap::from([(from.clone(), 3)]),
                        outputs: BTreeMap::from([(to, 1)]),
                    });
                }
            }
        }
    }
    for recipe in recipes {
        let (from, input) = recipe.inputs.into_iter().next().expect("vendor input");
        let (to, output) = recipe.outputs.into_iter().next().expect("vendor output");
        if !graph.contains_key(&from) || !graph.contains_key(&to) {
            continue;
        }
        let rate = output as f64 / input as f64;
        graph.get_mut(&from).unwrap().push(Edge {
            from,
            to,
            input_volume: input,
            output_volume: output,
            rate,
            low_rate: rate,
            high_rate: rate,
            historical_low_stock: 0,
            historical_high_stock: 0,
            kind: "vendor".into(),
            vendor: Some(recipe.vendor),
            recipe_id: Some(recipe.id),
        });
    }
}

fn find_cycles(
    graph: &BTreeMap<String, Vec<Edge>>,
    start: &str,
    path: &mut Vec<String>,
    legs: &mut Vec<Edge>,
    cycles: &mut Vec<Cycle>,
) {
    for edge in &graph[path.last().unwrap()] {
        let has_vendor = edge.kind == "vendor" || legs.iter().any(|e| e.kind == "vendor");
        if edge.to == start && legs.len() >= 1 {
            let length = legs.len() + 1;
            if (!has_vendor && length != 3)
                || (edge.kind != "market" && !legs.iter().any(|e| e.kind == "market"))
            {
                continue;
            }
            legs.push(edge.clone());
            cycles.push(Cycle {
                path: path.clone(),
                profit_pct: cycle_profit(legs.iter().map(|e| e.rate)),
                low_profit_pct: cycle_profit(legs.iter().map(|e| e.low_rate)),
                high_profit_pct: cycle_profit(legs.iter().map(|e| e.high_rate)),
                legs: legs.clone(),
            });
            legs.pop();
        } else if edge.to.as_str() > start && !path.contains(&edge.to) && path.len() < 4 {
            path.push(edge.to.clone());
            legs.push(edge.clone());
            find_cycles(graph, start, path, legs, cycles);
            legs.pop();
            path.pop();
        }
    }
}

pub fn analyze(snapshot: &Snapshot) -> Analysis {
    let names: BTreeSet<_> = snapshot.markets.iter().map(|m| m.league.clone()).collect();
    let leagues = names
        .into_iter()
        .map(|name| {
            let mut graph = BTreeMap::<String, Vec<Edge>>::new();
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
                        graph.entry(a.clone()).or_default().push(forward);
                        graph.entry(b.clone()).or_default().push(reverse);
                        active_pairs += 1;
                    }
                    _ => skipped_pairs += 1,
                }
            }
            if !name.contains("Ruthless") {
                add_vendor_edges(&mut graph);
            }
            let edges: Vec<_> = graph.values().flatten().cloned().collect();
            let mut cycles = Vec::new();
            for a in graph.keys() {
                find_cycles(
                    &graph,
                    a,
                    &mut vec![a.clone()],
                    &mut Vec::new(),
                    &mut cycles,
                );
            }
            cycles.sort_by(|a, b| b.profit_pct.total_cmp(&a.profit_pct));
            League {
                name,
                currencies: graph.keys().cloned().collect(),
                active_pairs,
                skipped_pairs,
                cycles,
                edges,
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
            kind: "market".into(),
            vendor: None,
            recipe_id: None,
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
    fn vendor_batches_have_no_haircut() {
        let mut vendor = edge(8, 20);
        vendor.kind = "vendor".into();
        assert_eq!(simulate_cycle(&[vendor], 25, 5), Some(60));
    }
    #[test]
    fn parallel_vendor_edges_create_mixed_cycles() {
        let a = "Metadata/Items/Currency/CurrencyIdentification".to_string();
        let b = "Metadata/Items/Currency/CurrencyPortal".to_string();
        let mut market = edge(1, 2);
        market.from = a.clone();
        market.to = b.clone();
        let mut reverse = edge(2, 1);
        reverse.from = b.clone();
        reverse.to = a.clone();
        let mut graph = BTreeMap::from([(a.clone(), vec![market]), (b.clone(), vec![reverse])]);
        add_vendor_edges(&mut graph);
        assert_eq!(graph[&a].len(), 2);
        assert_eq!(graph[&b].len(), 2);
        let mut cycles = Vec::new();
        find_cycles(
            &graph,
            &a,
            &mut vec![a.clone()],
            &mut Vec::new(),
            &mut cycles,
        );
        assert_eq!(cycles.len(), 2);
        assert!(cycles
            .iter()
            .all(|c| c.legs.iter().filter(|e| e.kind == "vendor").count() == 1));
        assert!(cycles
            .iter()
            .any(|c| simulate_cycle(&c.legs, 30, 0) == Some(60)));
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
