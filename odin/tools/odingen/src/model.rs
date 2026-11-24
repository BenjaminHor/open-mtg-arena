//! Reads the Rust sources into a registry of serde types: every struct and enum that derives Serialize or
//! Deserialize, with the serde attributes that decide its JSON shape, plus type aliases.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use syn::{Attribute, Fields as SynFields, Item, LitStr, Type};

/// The serde attributes the engine's types use (survey in docs/odin-port.md). Container, variant and field
/// attributes share this struct; each place reads the ones that apply to it.
#[derive(Default, Clone, Debug)]
pub struct Serde {
    pub rename: Option<String>,
    pub rename_all: Option<String>,
    pub tag: Option<String>,
    pub content: Option<String>,
    pub untagged: bool,
    pub transparent: bool,
    /// `default` (None inside = Default::default) or `default = "path"`.
    pub default: Option<Option<String>>,
    pub skip: bool,
    pub skip_serializing: bool,
    pub skip_deserializing: bool,
    pub skip_serializing_if: Option<String>,
    pub flatten: bool,
    pub aliases: Vec<String>,
    pub with: Option<String>,
    pub serialize_with: Option<String>,
    pub deserialize_with: Option<String>,
    pub from: Option<String>,
    pub try_from: Option<String>,
    pub into: Option<String>,
    pub other: bool,
    pub remote: Option<String>,
    pub unknown: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Field {
    /// None for tuple fields.
    pub name: Option<String>,
    pub ty: Type,
    pub serde: Serde,
}

#[derive(Clone, Debug)]
pub enum Fields {
    Named(Vec<Field>),
    Tuple(Vec<Field>),
    Unit,
}

#[derive(Clone, Debug)]
pub struct Variant {
    pub name: String,
    pub fields: Fields,
    pub serde: Serde,
}

#[derive(Clone, Debug)]
pub enum Kind {
    Struct(Fields),
    Enum(Vec<Variant>),
}

#[derive(Clone, Debug)]
pub struct TypeDef {
    pub name: String,
    pub file: PathBuf,
    /// Generic type parameters (lifetimes and consts left out).
    pub generics: Vec<String>,
    pub kind: Kind,
    pub serde: Serde,
    pub derives: Vec<String>,
}

#[derive(Default, Debug)]
pub struct Registry {
    /// By name; a name defined twice keeps every definition (reported as a collision).
    pub types: BTreeMap<String, Vec<TypeDef>>,
    pub aliases: BTreeMap<String, Vec<(Type, PathBuf)>>,
    /// Types with hand-written `impl Serialize`/`impl Deserialize`, by name.
    pub custom_impls: BTreeMap<String, Vec<PathBuf>>,
}

pub fn lit(s: &LitStr) -> String {
    s.value()
}

fn is_cfg_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|a| {
        a.path().is_ident("cfg") && a.meta.require_list().map(|l| l.tokens.to_string().contains("test")).unwrap_or(false)
    })
}

fn derives(attrs: &[Attribute]) -> Vec<String> {
    let mut out = Vec::new();
    for a in attrs {
        if a.path().is_ident("derive") {
            let _ = a.parse_nested_meta(|m| {
                if let Some(seg) = m.path.segments.last() {
                    out.push(seg.ident.to_string());
                }
                Ok(())
            });
        }
    }
    out
}

pub fn parse_serde(attrs: &[Attribute]) -> Serde {
    let mut s = Serde::default();
    for a in attrs {
        if !a.path().is_ident("serde") {
            continue;
        }
        let _ = a.parse_nested_meta(|m| {
            let key = m.path.get_ident().map(|i| i.to_string()).unwrap_or_default();
            let value = || -> syn::Result<String> { Ok(lit(&m.value()?.parse::<LitStr>()?)) };
            match key.as_str() {
                "rename" => {
                    if m.input.peek(syn::Token![=]) {
                        s.rename = Some(value()?);
                    } else {
                        // rename(serialize = "..", deserialize = "..")
                        m.parse_nested_meta(|n| {
                            let v = lit(&n.value()?.parse::<LitStr>()?);
                            if n.path.is_ident("serialize") {
                                s.rename = Some(v);
                            }
                            Ok(())
                        })?;
                    }
                }
                "rename_all" => {
                    if m.input.peek(syn::Token![=]) {
                        s.rename_all = Some(value()?);
                    } else {
                        m.parse_nested_meta(|n| {
                            let v = lit(&n.value()?.parse::<LitStr>()?);
                            if n.path.is_ident("serialize") {
                                s.rename_all = Some(v);
                            }
                            Ok(())
                        })?;
                    }
                }
                "tag" => s.tag = Some(value()?),
                "content" => s.content = Some(value()?),
                "untagged" => s.untagged = true,
                "transparent" => s.transparent = true,
                "default" => {
                    s.default = Some(if m.input.peek(syn::Token![=]) { Some(value()?) } else { None });
                }
                "skip" => s.skip = true,
                "skip_serializing" => s.skip_serializing = true,
                "skip_deserializing" => s.skip_deserializing = true,
                "skip_serializing_if" => s.skip_serializing_if = Some(value()?),
                "flatten" => s.flatten = true,
                "alias" => s.aliases.push(value()?),
                "with" => s.with = Some(value()?),
                "serialize_with" => s.serialize_with = Some(value()?),
                "deserialize_with" => s.deserialize_with = Some(value()?),
                "from" => s.from = Some(value()?),
                "try_from" => s.try_from = Some(value()?),
                "into" => s.into = Some(value()?),
                "other" => s.other = true,
                "remote" => s.remote = Some(value()?),
                other => {
                    s.unknown.push(other.to_string());
                    // Consume any `= value` so parsing continues.
                    if m.input.peek(syn::Token![=]) {
                        let _ = m.value()?.parse::<syn::Expr>();
                    }
                }
            }
            Ok(())
        });
    }
    s
}

fn fields(f: &SynFields) -> Fields {
    match f {
        SynFields::Named(n) => Fields::Named(
            n.named
                .iter()
                .map(|f| Field {
                    name: Some(f.ident.as_ref().unwrap().to_string()),
                    ty: f.ty.clone(),
                    serde: parse_serde(&f.attrs),
                })
                .collect(),
        ),
        SynFields::Unnamed(u) => Fields::Tuple(
            u.unnamed.iter().map(|f| Field { name: None, ty: f.ty.clone(), serde: parse_serde(&f.attrs) }).collect(),
        ),
        SynFields::Unit => Fields::Unit,
    }
}

fn generics(g: &syn::Generics) -> Vec<String> {
    g.type_params().map(|p| p.ident.to_string()).collect()
}

fn self_type_name(ty: &Type) -> Option<String> {
    if let Type::Path(p) = ty {
        return p.path.segments.last().map(|s| s.ident.to_string());
    }
    None
}

fn visit_items(items: &[Item], file: &Path, reg: &mut Registry) {
    for item in items {
        match item {
            Item::Struct(s) => {
                let d = derives(&s.attrs);
                if d.iter().any(|x| x == "Serialize" || x == "Deserialize") && !is_cfg_test(&s.attrs) {
                    reg.types.entry(s.ident.to_string()).or_default().push(TypeDef {
                        name: s.ident.to_string(),
                        file: file.to_path_buf(),
                        generics: generics(&s.generics),
                        kind: Kind::Struct(fields(&s.fields)),
                        serde: parse_serde(&s.attrs),
                        derives: d,
                    });
                }
            }
            Item::Enum(e) => {
                let d = derives(&e.attrs);
                if d.iter().any(|x| x == "Serialize" || x == "Deserialize") && !is_cfg_test(&e.attrs) {
                    reg.types.entry(e.ident.to_string()).or_default().push(TypeDef {
                        name: e.ident.to_string(),
                        file: file.to_path_buf(),
                        generics: generics(&e.generics),
                        kind: Kind::Enum(
                            e.variants
                                .iter()
                                .map(|v| Variant {
                                    name: v.ident.to_string(),
                                    fields: fields(&v.fields),
                                    serde: parse_serde(&v.attrs),
                                })
                                .collect(),
                        ),
                        serde: parse_serde(&e.attrs),
                        derives: d,
                    });
                }
            }
            Item::Type(t) if !is_cfg_test(&t.attrs) => {
                reg.aliases.entry(t.ident.to_string()).or_default().push(((*t.ty).clone(), file.to_path_buf()));
            }
            Item::Impl(i) => {
                if let Some((_, trait_path, _)) = &i.trait_ {
                    let tname = trait_path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
                    if tname == "Serialize" || tname == "Deserialize" {
                        if let Some(n) = self_type_name(&i.self_ty) {
                            reg.custom_impls.entry(n).or_default().push(file.to_path_buf());
                        }
                    }
                }
            }
            Item::Mod(m) if !is_cfg_test(&m.attrs) => {
                if let Some((_, inner)) = &m.content {
                    visit_items(inner, file, reg);
                }
            }
            _ => {}
        }
    }
}

pub fn scan(roots: &[PathBuf]) -> Registry {
    let mut reg = Registry::default();
    for root in roots {
        for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
            let p = entry.path();
            if p.extension().map(|e| e == "rs").unwrap_or(false) {
                let name = p.file_name().unwrap().to_string_lossy();
                if name.ends_with("_tests.rs") || name == "tests.rs" || p.components().any(|c| c.as_os_str() == "tests") {
                    continue;
                }
                let src = std::fs::read_to_string(p).unwrap();
                match syn::parse_file(&src) {
                    Ok(f) => visit_items(&f.items, p, &mut reg),
                    Err(e) => eprintln!("parse error {}: {e}", p.display()),
                }
            }
        }
    }
    reg
}
