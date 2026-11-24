//! odingen: the Odin engine's data model, generated from the Rust engine's serde types (O-1, docs/odin-port.md).
//!
//! `odingen report <crates-dir>` lists what the generator sees: serialized types, name collisions, hand-written serde
//! impls and the type names fields use that nothing defines.

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
        _ => eprintln!("usage: odingen report <crates-dir>"),
    }
}
