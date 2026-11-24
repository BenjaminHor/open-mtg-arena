//! odingen: the Odin engine's data model, generated from the Rust engine's serde types (O-1, docs/odin-port.md).
//!
//! `odingen report <crates-dir>` lists what the generator sees: serialized types, name collisions, hand-written serde
//! impls and the type names fields use that nothing defines.

mod emit;
mod translate;
mod model;

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("report") => {
            let crates = PathBuf::from(&args[2]);
            report(&[crates.join("phase-ast/src"), crates.join("engine/src")]);
        }
        Some("gen") => {
            let crates = PathBuf::from(&args[2]);
            let out_dir = PathBuf::from(&args[3]);
            let roots: Vec<&str> = args[4..].iter().map(String::as_str).collect();
            generate(&[crates.join("phase-ast/src"), crates.join("engine/src")], &out_dir, &roots);
        }
        _ => eprintln!("usage: odingen report <crates-dir> | odingen gen <crates-dir> <out-dir> <root type>..."),
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
    let codecs = format!(
        "{HEADER}import \"core:slice\"\nimport \"core:strings\"\nimport \"../json\"\n\n_ :: slice\n_ :: strings\n\n{}\n{}",
        e.codec_out,
        e.helpers_out,
    );
    std::fs::write(out_dir.join("generated_codecs.odin"), codecs).unwrap();

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
    for (n, users) in &e.unknown_shapes {
        println!("  unknown type {n} (in {})", users.iter().cloned().collect::<Vec<_>>().join(", "));
    }
}
