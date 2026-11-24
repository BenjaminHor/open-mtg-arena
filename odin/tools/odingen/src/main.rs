//! odingen: the Odin engine's data model, generated from the Rust engine's serde types (O-1, docs/odin-port.md).
//!
//! `odingen report <crates-dir>` lists what the generator sees: serialized types, name collisions, hand-written serde
//! impls and the type names fields use that nothing defines.

mod body;
mod census;
mod emit;
mod translate;
mod vectors;
mod model;
mod pattern;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use syn::{GenericArgument, PathArguments, Type};

/// Types the generator maps directly instead of looking them up.
pub const BUILTIN: &[&str] = &[
    "bool", "u8", "u16", "u32", "u64", "u128", "usize", "i8", "i16", "i32", "i64", "i128", "isize", "f32", "f64",
    "char", "str", "String", "Option", "Vec", "Box", "Arc", "Rc", "HashMap", "HashSet", "BTreeMap", "BTreeSet",
    "IndexMap", "IndexSet", "VecDeque", "SmallVec", "Vector", "OrdMap", "OrdSet", "Cow", "PhantomData", "Self",
    "NonZeroU32", "NonZeroU64", "Value", "FxHashMap", "FxHashSet",
];

/// Collects every type name a type mentions, in path segments and generic arguments.
pub fn type_names(ty: &Type, out: &mut Vec<String>) {
    match ty {
        Type::Path(p) => {
            if let Some(seg) = p.path.segments.last() {
                out.push(seg.ident.to_string());
                if let PathArguments::AngleBracketed(a) = &seg.arguments {
                    for arg in &a.args {
                        if let GenericArgument::Type(t) = arg {
                            type_names(t, out);
                        }
                    }
                }
            }
        }
        Type::Reference(r) => type_names(&r.elem, out),
        Type::Tuple(t) => t.elems.iter().for_each(|e| type_names(e, out)),
        Type::Array(a) => type_names(&a.elem, out),
        Type::Slice(s) => type_names(&s.elem, out),
        Type::Paren(p) => type_names(&p.elem, out),
        Type::Group(g) => type_names(&g.elem, out),
        _ => out.push(format!("<{}>", quote::quote!(#ty))),
    }
}

fn field_types(def: &model::TypeDef) -> Vec<&Type> {
    fn push<'a>(f: &'a model::Fields, out: &mut Vec<&'a Type>) {
        if let model::Fields::Named(v) | model::Fields::Tuple(v) = f {
            v.iter().for_each(|x| out.push(&x.ty));
        }
    }
    let mut out = Vec::new();
    match &def.kind {
        model::Kind::Struct(f) => push(f, &mut out),
        model::Kind::Enum(vs) => vs.iter().for_each(|v| push(&v.fields, &mut out)),
    }
    out
}

fn report(roots: &[PathBuf]) {
    let reg = model::scan(roots);
    let n_defs: usize = reg.types.values().map(|v| v.len()).sum();
    let (mut structs, mut enums, mut variants) = (0, 0, 0);
    for defs in reg.types.values() {
        for d in defs {
            match &d.kind {
                model::Kind::Struct(_) => structs += 1,
                model::Kind::Enum(v) => {
                    enums += 1;
                    variants += v.len()
                }
            }
        }
    }
    println!("serde types: {n_defs} ({structs} structs, {enums} enums, {variants} variants), {} names", reg.types.len());
    println!("aliases: {}", reg.aliases.len());

    let collisions: Vec<_> = reg.types.iter().filter(|(_, v)| v.len() > 1).collect();
    println!("\nname collisions: {}", collisions.len());
    for (n, defs) in &collisions {
        let files: Vec<_> = defs.iter().map(|d| d.file.display().to_string()).collect();
        println!("  {n}: {}", files.join(", "));
    }

    println!("\nhand-written serde impls: {}", reg.custom_impls.len());
    for (n, files) in &reg.custom_impls {
        let defined = if reg.types.contains_key(n) { "" } else { " (no derive)" };
        println!("  {n}{defined}: {}", files.iter().map(|f| f.display().to_string()).collect::<Vec<_>>().join(", "));
    }

    let generic: Vec<_> = reg.types.values().flatten().filter(|d| !d.generics.is_empty()).collect();
    println!("\ngeneric types: {}", generic.len());
    for d in &generic {
        println!("  {}<{}> {}", d.name, d.generics.join(","), d.file.display());
    }

    let mut unknown_attrs: BTreeMap<String, usize> = BTreeMap::new();
    let mut unresolved: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for defs in reg.types.values() {
        for d in defs {
            d.serde.unknown.iter().for_each(|u| *unknown_attrs.entry(u.clone()).or_default() += 1);
            for ty in field_types(d) {
                let mut names = Vec::new();
                type_names(ty, &mut names);
                for n in names {
                    let known = BUILTIN.contains(&n.as_str())
                        || reg.types.contains_key(&n)
                        || reg.aliases.contains_key(&n)
                        || d.generics.contains(&n);
                    if !known {
                        unresolved.entry(n).or_default().insert(d.name.clone());
                    }
                }
            }
        }
    }
    println!("\nunknown serde attributes: {unknown_attrs:?}");
    println!("\nunresolved type names: {}", unresolved.len());
    for (n, users) in &unresolved {
        let users: Vec<_> = users.iter().take(4).cloned().collect();
        println!("  {n}  (used by {})", users.join(", "));
    }
}

thread_local! {
    /// Set by `translate-report`: after generating, translate the functions of files matching this filter.
    static TRANSLATE_REPORT: std::cell::RefCell<Option<Option<String>>> = const { std::cell::RefCell::new(None) };
}

const DEFAULT_ROOTS: &[&str] = &["CardExportEntry", "GameState", "GameAction", "WaitingFor", "GameEvent", "ReplayLog"];

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("report") => {
            let crates = PathBuf::from(&args[2]);
            report(&[crates.join("phase-ast/src"), crates.join("engine/src")]);
        }
        Some("vector-patch") => {
            // In a scratch copy of the crates only: wraps engine functions to log their calls (vectors.rs).
            let only = args.get(3).map(|f| std::fs::read_to_string(f).expect("names file").lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect());
            vectors::patch(&PathBuf::from(&args[2]), only.as_ref());
        }
        Some("census") => {
            let crates = PathBuf::from(&args[2]);
            let reg = model::scan(&[crates.join("phase-ast/src"), crates.join("engine/src")]);
            census::census(&reg, args.get(3).map(String::as_str));
        }
        Some("translate-report") => {
            // Generates the model (as `gen` does, into the given directory), then tries every function of the
            // files matching the filter and writes the translated ones to <out-dir>/translated.odin.
            let crates = PathBuf::from(&args[2]);
            let out_dir = PathBuf::from(&args[3]);
            let filter = args.get(4).cloned();
            TRANSLATE_REPORT.with(|t| *t.borrow_mut() = Some(filter));
            generate(&[crates.join("phase-ast/src"), crates.join("engine/src")], &out_dir, DEFAULT_ROOTS);
        }
        Some("gen") => {
            let crates = PathBuf::from(&args[2]);
            let out_dir = PathBuf::from(&args[3]);
            // The model's roots: what the engine reads and writes (states, actions, decisions, events, replays) and the
            // card data. Other roots are for experiments; the committed model and CI use these.
            let mut roots: Vec<&str> = args[4..].iter().map(String::as_str).collect();
            if roots.is_empty() {
                roots = DEFAULT_ROOTS.to_vec();
            }
            generate(&[crates.join("phase-ast/src"), crates.join("engine/src")], &out_dir, &roots);
        }
        _ => eprintln!("usage: odingen report <crates-dir> | odingen gen <crates-dir> <out-dir> [root type...]"),
    }
}

const HEADER: &str = "// GENERATED by odin/tools/odingen from the Rust engine's serde types. Do not edit; regenerate.\n\
// docs/odin-port.md, \"O-1 data model design\".\npackage types\n\n";

fn generate(roots_dirs: &[PathBuf], out_dir: &PathBuf, roots: &[&str]) {
    let mut reg = model::scan(roots_dirs);
    // card-data.json is written by bin/oracle_gen.rs's own CardExportEntry (its skip rules differ from the
    // reader's in database/card_db.rs), so CardExportEntry encodes with the writer's attributes.
    if let Some(mut w) = model::scan_file_type(&roots_dirs[1].join("bin/oracle_gen.rs"), "CardExportEntry") {
        w.name = "OracleGenCardExportEntry".into();
        reg.types.insert(w.name.clone(), vec![w]);
    }
    // ManaPool's runtime form (entries by shape, a slot index) is a cache over its wire form, the units in pool
    // order (`from/into = "ManaPoolWire"`); the Odin model holds the wire form and the ported logic works on it.
    if let Some(mut w) = reg.types.get("ManaPoolWire").map(|d| d[0].clone()) {
        w.name = "ManaPool".into();
        reg.types.insert("ManaPool".into(), vec![w]);
    }
    // ObjectMap serializes exactly as its inner map (`impl Serialize`: `self.inner.serialize`).
    if let Some(d) = reg.types.get_mut("ObjectMap") {
        d[0].serde.transparent = true;
        d[0].derives.extend(["Serialize".to_string(), "Deserialize".to_string()]);
    }
    // Types whose serialized form isn't derived get hand-written Odin codecs.
    let hand: BTreeSet<String> = reg
        .types
        .iter()
        .filter(|(_, defs)| {
            let d = defs.iter().find(|d| d.derives_serialize() || d.derives_deserialize()).unwrap_or(&defs[0]);
            // `into` conversions are hand-written too (SearchFoundVisibility writes a bool). `from`-only types write
            // the derived form and read it plus legacy forms; the generated decoder reads the derived form.
            !d.derives_serialize() || d.serde.into.is_some()
        })
        .map(|(n, _)| n.clone())
        .collect();
    let mut hand = hand;
    // Overrides, each checked against the Rust impl it stands for (docs/odin-port.md, "O-1 data model design").
    // AbilityDefinition: `impl Serialize` writes AbilityDefinitionRepr (same fields) flattened, then the computed
    // `consumes_source` and `is_mana_ability` (hand-written encode_AbilityDefinition_computed); reading takes the
    // same field set.
    hand.remove("AbilityDefinition");
    // ZoneOwner: `into = "ZoneOwnerRepr"`, whose written variants are ZoneOwner's own (the extra ones are legacy,
    // read-only).
    hand.remove("ZoneOwner");
    let mut e = emit::Emitter::new(&reg, hand);
    e.codec_as.insert("AbilityDefinition".into(), "AbilityDefinitionRepr".into());
    // Reading goes through AbilityDefinitionDe (`impl Deserialize`), whose defaults differ from the Repr's.
    e.decode_as.insert("AbilityDefinition".into(), "AbilityDefinitionDe".into());
    e.computed.insert("AbilityDefinition".into());
    e.ignore_into.insert("ZoneOwner".into());
    e.codec_as.insert("CardExportEntry".into(), "OracleGenCardExportEntry".into());
    // ResolvedRulesJournal writes ResolvedRulesJournalWire (the same fields less the runtime `index`, which reading
    // rebuilds).
    e.hand.remove("ResolvedRulesJournal");
    e.codec_as.insert("ResolvedRulesJournal".into(), "ResolvedRulesJournalWire".into());
    // What each hand-written codec (hand_codecs.odin) calls through generated codecs.
    for (t, deps) in [
        ("CostPaidObjectRecord", &["CostPaidObjectSnapshot", "ObjectId"][..]),
        ("PendingCoinFlip", &["ObjectId", "PlayerId", "ResolvedAbility", "ResolvedCoinBranches", "PendingCoinFlipKind", "TargetRef", "FlipBranchContext", "ResolvingTriggerContext"][..]),
        ("LiminalEntrant", &["GameObject"][..]),
        ("PeriodSignature", &["PeriodicDelta"][..]),
        ("GameFormat", &["CustomFormatId"][..]),
        ("SacrificeCost", &["SacrificeRequirement"][..]),
        ("ChoiceType", &["NameDistinctness", "NumberDistinctness", "CardPredicateChoice", "PlayerChoiceDistinctness"][..]),
    ] {
        e.hand_deps.insert(t.into(), deps.iter().map(|d| d.to_string()).collect());
    }
    // PeriodSignature's hand codec writes its period's members flattened (SignatureWire).
    e.flattened.insert("PeriodicDelta".into());
    e.run(roots);
    std::fs::create_dir_all(out_dir).unwrap();
    let types = format!("{HEADER}import \"../json\"\nimport \"../rng\"\n\n_ :: json\n_ :: rng\n\n{}", e.types_out);
    std::fs::write(out_dir.join("generated_types.odin"), types).unwrap();
    let (codec_out, coverage_keys) = add_coverage_hooks(&e.codec_out);
    let keys: Vec<String> = coverage_keys.iter().map(|k| format!("\t\"{k}\",")).collect();
    let codecs = format!(
        "{HEADER}import \"core:slice\"\nimport \"core:strings\"\nimport \"../json\"\n\n_ :: slice\n_ :: strings\n\n// Every coverage key the generated decoders count (`-define:COVERAGE=true`): one per type, one per variant.\nCOVERAGE_KEYS := []string{{\n{}\n}}\n\n{}\n{}",
        keys.join("\n"),
        codec_out,
        e.helpers_out,
    );
    std::fs::write(out_dir.join("generated_codecs.odin"), codecs).unwrap();
    std::fs::write(out_dir.join("generated_clone.odin"), format!("{HEADER}import \"../json\"\n\n_ :: json\n\n{}", e.clone_out)).unwrap();

    for (n, path) in &e.with_reqs {
        println!("  with adapter: {n} ({path})");
    }
    let hand_used: Vec<&String> = e.emitted.iter().filter(|n| e.hand.contains(*n) && e.wire.contains(*n)).collect();
    let wire_count = e.emitted.iter().filter(|n| e.wire.contains(*n)).count();
    println!("emitted {} types ({} serialized, {} of those with hand-written codecs)", e.emitted.len(), wire_count, hand_used.len());
    for n in &hand_used {
        println!("  hand: {n}");
    }
    let (fns, failed) = translate::defaults_and_skips(&mut e);
    // Fields written but never read (`skip_deserializing`): values the Rust engine derives (available_mana_pips,
    // allows_cancel_cast). The model reads none of them; the round-trip tests leave them out of the comparison
    // until the logic that derives them is ported.
    let mut write_only = BTreeSet::new();
    for n in e.wire.iter().filter(|n| e.emitted.contains(*n)) {
        for d in reg.types.get(n).into_iter().flatten().filter(|d| d.derives_serialize()) {
            if let model::Kind::Struct(model::Fields::Named(fs)) = &d.kind {
                for f in fs.iter().filter(|f| f.serde.skip_deserializing && !f.serde.skip_serializing && !f.serde.skip) {
                    write_only.insert(f.serde.rename.clone().unwrap_or_else(|| f.name.clone().unwrap()));
                }
            }
        }
    }
    // The round trips strip these keys wherever they appear, so a name some read field also uses would hide that
    // field from the comparison: such a name is left out (its mismatches show) and reported.
    let mut read_names = BTreeSet::new();
    for n in e.wire.iter().filter(|n| e.emitted.contains(*n)) {
        for d in reg.types.get(n).into_iter().flatten() {
            let mut add = |fs: &model::Fields| {
                if let model::Fields::Named(v) = fs {
                    for f in v.iter().filter(|f| !f.serde.skip && !f.serde.skip_deserializing) {
                        read_names.insert(f.serde.rename.clone().unwrap_or_else(|| f.name.clone().unwrap()));
                    }
                }
            };
            match &d.kind {
                model::Kind::Struct(fs) => add(fs),
                model::Kind::Enum(vs) => vs.iter().for_each(|v| add(&v.fields)),
            }
        }
    }
    for clash in write_only.intersection(&read_names) {
        println!("  write-only name also read elsewhere, not stripped: {clash}");
    }
    let write_only: BTreeSet<String> = write_only.difference(&read_names).cloned().collect();
    let write_only_list: Vec<String> = write_only.iter().map(|n| format!("\t\"{n}\",")).collect();
    std::fs::write(
        out_dir.join("generated_defaults.odin"),
        format!(
            "{HEADER}import \"../json\"\n\n_ :: json\n\n// Serialized fields the Rust engine writes but never reads (`skip_deserializing`).\nWRITE_ONLY_FIELDS := []string{{\n{}\n}}\n\n{fns}\n{}",
            write_only_list.join("\n"),
            e.defaults_out
        ),
    )
    .unwrap();
    println!("defaults and skip predicates: {} translated, {} to write by hand", e.default_reqs.len() + e.skip_reqs.len() - failed.len(), failed.len());
    for f in &failed {
        println!("  hand: {f}");
    }
    if let Some(filter) = TRANSLATE_REPORT.with(|t| t.borrow().clone()) {
        // Every non-generic engine type, so translated logic finds the types saves never hold.
        let all: Vec<String> = reg
            .types
            .iter()
            .filter(|(_, d)| d[0].generics.is_empty())
            .map(|(n, _)| n.clone())
            .collect();
        // Types with codecs, before the logic-only types join: the vector harness decodes only these.
        let codecs: std::collections::BTreeSet<String> = e.wire.intersection(&e.emitted).cloned().collect();
        let before = e.types_out.len();
        e.emit_more(&all);
        let more_types = e.types_out[before..].to_string();
        std::fs::write(out_dir.join("generated_types_logic.odin"), format!("{HEADER}import \"../json\"\nimport \"../rng\"\n\n_ :: json\n_ :: rng\n\n{more_types}")).unwrap();
        body::report(&mut e, filter.as_deref(), Some(&out_dir.join("translated.odin")), &codecs);
        // Translation asked for more clone helpers; the clone file is written again with them.
        std::fs::write(out_dir.join("generated_clone.odin"), format!("{HEADER}import \"../json\"\n\n_ :: json\n\n{}", e.clone_out)).unwrap();
    }
    for (n, users) in &e.unknown_shapes {
        println!("  unknown type {n} (in {})", users.iter().cloned().collect::<Vec<_>>().join(", "));
    }
}

/// Adds coverage counting to the generated decoders: a hit per decoded type (`T`) and per enum variant read by its
/// tag (`T::V`), compiled in only with `-define:COVERAGE=true` (codec_runtime.odin). Returns the code and the keys.
fn add_coverage_hooks(code: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(code.len() + code.len() / 8);
    let mut keys = Vec::new();
    let mut current: Option<String> = None;
    for line in code.lines() {
        if let Some(rest) = line.strip_prefix("decode_") {
            if let Some((name, tail)) = rest.split_once(" :: proc(v: json.Value, out: ^") {
                if tail.ends_with(") -> bool {") {
                    out.push_str(line);
                    out.push_str(&format!("\n\twhen COVERAGE do cov_hit(\"{name}\")\n"));
                    keys.push(name.to_string());
                    current = Some(name.to_string());
                    continue;
                }
            }
        }
        if line.starts_with('}') {
            current = None;
        }
        // A tag dispatch: `\tcase "A", "B": ...` (the variant's JSON names; the first is enough to name it).
        if let (Some(t), Some(rest)) = (&current, line.strip_prefix("\tcase \"")) {
            if let Some((tag, _)) = rest.split_once('"') {
                if let Some(colon) = line.find("\":").or_else(|| line.find("\", ")) {
                    let _ = colon;
                    let key = format!("{t}::{tag}");
                    let at = line.find(':').unwrap();
                    // Insert right after the case label's colon.
                    let label_end = line[..].char_indices().skip_while(|(i, _)| *i < at).find(|(_, c)| *c == ':').map(|(i, _)| i).unwrap();
                    out.push_str(&line[..=label_end]);
                    out.push_str(&format!(" when COVERAGE do cov_hit(\"{key}\");"));
                    out.push_str(&line[label_end + 1..]);
                    out.push('\n');
                    keys.push(key);
                    continue;
                }
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    keys.sort();
    keys.dedup();
    (out, keys)
}
