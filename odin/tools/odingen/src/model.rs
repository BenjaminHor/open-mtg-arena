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
    /// Enums: `rename_all_fields`, the rename rule for every struct variant's fields.
    pub rename_all_fields: Option<String>,
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
    /// `#[default]`: the variant `derive(Default)` picks.
    pub is_default: bool,
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

impl TypeDef {
    pub fn derives_serialize(&self) -> bool {
        self.derives.iter().any(|d| d == "Serialize" || d.ends_with("::Serialize"))
    }
    pub fn derives_deserialize(&self) -> bool {
        self.derives.iter().any(|d| d == "Deserialize" || d.ends_with("::Deserialize"))
    }
}

#[derive(Default, Debug)]
pub struct Registry {
    /// By name; a name defined twice keeps every definition (reported as a collision).
    pub types: BTreeMap<String, Vec<TypeDef>>,
    pub aliases: BTreeMap<String, Vec<(Type, PathBuf)>>,
    /// Types with hand-written `impl Serialize`/`impl Deserialize`, by name.
    pub custom_impls: BTreeMap<String, Vec<PathBuf>>,
    /// Functions by (impl type, name); free functions have no impl type. A name defined in several modules keeps
    /// every definition.
    pub fns: BTreeMap<(Option<String>, String), Vec<FnDef>>,
    /// Constants by (impl type, name): free `const`s have no impl type.
    pub consts: BTreeMap<(Option<String>, String), Vec<ConstDef>>,
}

#[derive(Clone, Debug)]
pub struct ConstDef {
    pub ty: syn::Type,
    pub expr: syn::Expr,
    pub file: PathBuf,
}

#[derive(Clone, Debug)]
pub struct FnDef {
    pub sig: syn::Signature,
    pub block: syn::Block,
    pub file: PathBuf,
    pub self_ty: Option<String>,
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
                "rename_all_fields" => s.rename_all_fields = Some(value()?),
                "deny_unknown_fields" => {}
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

/// A `macro_rules!` with one rule whose matcher is `$a:frag, $b:frag, ...`: its parameter names and body.
struct SimpleMacro {
    params: Vec<String>,
    body: String,
}

fn simple_macros(items: &[Item]) -> BTreeMap<String, SimpleMacro> {
    let mut out = BTreeMap::new();
    for item in items {
        let Item::Macro(m) = item else { continue };
        if !m.mac.path.is_ident("macro_rules") {
            continue;
        }
        let Some(name) = &m.ident else { continue };
        let src = m.mac.tokens.to_string();
        // One rule: `( matcher ) => { body }` with nothing after it but an optional `;`.
        let Some(arrow) = src.find("=>") else { continue };
        let matcher = src[..arrow].trim().trim_start_matches('(').trim_end_matches(')');
        let rest = src[arrow + 2..].trim().trim_end_matches(';').trim();
        if !(rest.starts_with('{') && rest.ends_with('}')) || rest[1..rest.len() - 1].contains("=>") {
            continue;
        }
        let params: Option<Vec<String>> = matcher
            .split(',')
            .map(|p| {
                let p = p.trim();
                p.strip_prefix('$').and_then(|q| q.split(':').next()).map(|n| n.trim().to_string())
            })
            .collect();
        let Some(params) = params else { continue };
        out.insert(name.to_string(), SimpleMacro { params, body: rest[1..rest.len() - 1].to_string() });
    }
    out
}

/// Expands `name!(a, b)` with a simple macro by substituting the arguments, and parses the items it makes.
fn expand_simple(mac: &SimpleMacro, args: &str) -> Option<Vec<Item>> {
    let args: Vec<&str> = args.split(',').map(str::trim).filter(|a| !a.is_empty()).collect();
    if args.len() != mac.params.len() {
        return None;
    }
    let mut body = mac.body.clone();
    let mut order: Vec<usize> = (0..mac.params.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(mac.params[i].len()));
    for i in order {
        body = body.replace(&format!("$ {}", mac.params[i]), args[i]);
    }
    syn::parse_file(&body).ok().map(|f| f.items)
}

fn visit_items(items: &[Item], file: &Path, reg: &mut Registry) {
    let macros = simple_macros(items);
    let mut expanded = Vec::new();
    for item in items {
        if let Item::Macro(m) = item {
            if let Some(mac) = m.mac.path.get_ident().and_then(|i| macros.get(&i.to_string())) {
                if let Some(items) = expand_simple(mac, &m.mac.tokens.to_string()) {
                    expanded.extend(items);
                }
            }
        }
    }
    if !expanded.is_empty() {
        visit_items(&expanded, file, reg);
    }
    for item in items {
        match item {
            Item::Struct(s) => {
                let d = derives(&s.attrs);
                if !is_cfg_test(&s.attrs) {
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
                if !is_cfg_test(&e.attrs) {
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
                                    is_default: v.attrs.iter().any(|a| a.path().is_ident("default")),
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
            Item::Const(c) if !is_cfg_test(&c.attrs) => {
                reg.consts.entry((None, c.ident.to_string())).or_default().push(ConstDef {
                    ty: (*c.ty).clone(),
                    expr: (*c.expr).clone(),
                    file: file.to_path_buf(),
                });
            }
            Item::Fn(f) if !is_cfg_test(&f.attrs) => {
                reg.fns.entry((None, f.sig.ident.to_string())).or_default().push(FnDef {
                    sig: f.sig.clone(),
                    block: (*f.block).clone(),
                    file: file.to_path_buf(),
                    self_ty: None,
                });
                register_nested_fns(&f.block, file, reg);
            }
            Item::Impl(i) => {
                if i.trait_.is_none() && !is_cfg_test(&i.attrs) {
                    if let Some(n) = self_type_name(&i.self_ty) {
                        for it in &i.items {
                            if let syn::ImplItem::Const(c) = it {
                                reg.consts.entry((Some(n.clone()), c.ident.to_string())).or_default().push(ConstDef {
                                    ty: c.ty.clone(),
                                    expr: c.expr.clone(),
                                    file: file.to_path_buf(),
                                });
                            }
                            if let syn::ImplItem::Fn(f) = it {
                                reg.fns.entry((Some(n.clone()), f.sig.ident.to_string())).or_default().push(FnDef {
                                    sig: f.sig.clone(),
                                    block: f.block.clone(),
                                    file: file.to_path_buf(),
                                    self_ty: Some(n.clone()),
                                });
                                register_nested_fns(&f.block, file, reg);
                            }
                        }
                    }
                }
                if let Some((_, trait_path, _)) = &i.trait_ {
                    // `impl Default for T`: kept as the function "__Default" on T.
                    if trait_path.segments.last().map(|s| s.ident == "Default").unwrap_or(false) && !is_cfg_test(&i.attrs) {
                        if let Some(n) = self_type_name(&i.self_ty) {
                            for it in &i.items {
                                if let syn::ImplItem::Fn(f) = it {
                                    reg.fns.entry((Some(n.clone()), "__Default".into())).or_default().push(FnDef {
                                        sig: f.sig.clone(),
                                        block: f.block.clone(),
                                        file: file.to_path_buf(),
                                        self_ty: Some(n.clone()),
                                    });
                                }
                            }
                        }
                    }
                    let tname = trait_path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
                    // An engine trait's methods (`impl ObjectIncarnationRefExt for ObjectIncarnationRef`) are
                    // registered on the type like inherent ones; a name an inherent method or another trait also
                    // gives the type is then ambiguous, which resolution refuses. Standard traits stay out: their
                    // methods (`from`, `eq`, `fmt`, ...) are the language's, not engine logic.
                    if !STD_TRAITS.contains(&tname.as_str()) && trait_path.segments.len() == 1 && !is_cfg_test(&i.attrs) {
                        if let Some(n) = self_type_name(&i.self_ty) {
                            for it in &i.items {
                                if let syn::ImplItem::Fn(f) = it {
                                    reg.fns.entry((Some(n.clone()), f.sig.ident.to_string())).or_default().push(FnDef {
                                        sig: f.sig.clone(),
                                        block: f.block.clone(),
                                        file: file.to_path_buf(),
                                        self_ty: Some(n.clone()),
                                    });
                                }
                            }
                        }
                    }
                    if tname == "Serialize" || tname == "Deserialize" {
                        if let Some(n) = self_type_name(&i.self_ty) {
                            reg.custom_impls.entry(n).or_default().push(file.to_path_buf());
                        }
                    }
                }
            }
            // types/game_state.rs declares GameState through `declare_game_state! { fields }`, which expands to
            // `#[derive(Serialize)] pub struct GameState { fields }` (plus a raw mirror with the same fields that
            // loading reads through), so the body is read as that struct's field list.
            Item::Macro(m) if m.mac.path.is_ident("declare_game_state") => {
                let tokens = &m.mac.tokens;
                if let Ok(syn::Item::Struct(st)) = syn::parse2::<syn::Item>(quote::quote!(pub struct GameState { #tokens })) {
                    reg.types.entry("GameState".into()).or_default().push(TypeDef {
                        name: "GameState".into(),
                        file: file.to_path_buf(),
                        generics: vec![],
                        kind: Kind::Struct(fields(&st.fields)),
                        serde: Serde::default(),
                        derives: vec!["Serialize".into(), "Deserialize".into()],
                    });
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
                // Tests and the command-line tools (bin/, whose types repeat the library's names) aren't the model.
                let skip_dir = p.components().any(|c| c.as_os_str() == "tests" || c.as_os_str() == "bin");
                if name.ends_with("_tests.rs") || name == "tests.rs" || skip_dir {
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

/// One struct or enum from a single file, by name (for a type outside the scanned roots, such as the card-data
/// writer in bin/oracle_gen.rs).
pub fn scan_file_type(path: &Path, name: &str) -> Option<TypeDef> {
    let src = std::fs::read_to_string(path).ok()?;
    let f = syn::parse_file(&src).ok()?;
    let mut reg = Registry::default();
    visit_items(&f.items, path, &mut reg);
    reg.types.remove(name)?.into_iter().next()
}

/// Traits of the standard library and serde whose impls aren't engine logic to translate.
const STD_TRAITS: &[&str] = &[
    "Default", "Serialize", "Deserialize", "PartialEq", "Eq", "PartialOrd", "Ord", "Hash", "Debug", "Display",
    "Clone", "Copy", "From", "Into", "TryFrom", "TryInto", "Iterator", "IntoIterator", "DoubleEndedIterator",
    "ExactSizeIterator", "Deref", "DerefMut", "AsRef", "AsMut", "Borrow", "BorrowMut", "FromStr", "Drop", "Add",
    "Sub", "Mul", "Div", "Rem", "Neg", "Not", "BitAnd", "BitOr", "BitXor", "AddAssign", "SubAssign", "MulAssign",
    "Index", "IndexMut", "Extend", "FromIterator", "Error", "Fn", "FnMut", "FnOnce", "Send", "Sync", "Visitor",
    "Sum", "Product",
];

/// Functions declared inside a function body (`fn visit(..)` helpers) can't capture anything, so they are registered
/// as free functions of the file: a bare call resolves to them like to the file's own functions, and two of one name
/// in a file are ambiguous, which resolution refuses.
fn register_nested_fns(block: &syn::Block, file: &std::path::Path, reg: &mut Registry) {
    struct V<'r> {
        file: &'r std::path::Path,
        found: Vec<syn::ItemFn>,
    }
    impl<'ast> syn::visit::Visit<'ast> for V<'_> {
        fn visit_item_fn(&mut self, f: &'ast syn::ItemFn) {
            self.found.push(f.clone());
            syn::visit::visit_item_fn(self, f);
        }
        // Items of a nested impl or module are not this function's helpers.
        fn visit_item_impl(&mut self, _: &'ast syn::ItemImpl) {}
        fn visit_item_mod(&mut self, _: &'ast syn::ItemMod) {}
    }
    let mut v = V { file, found: Vec::new() };
    syn::visit::visit_block(&mut v, block);
    for f in v.found {
        if is_cfg_test(&f.attrs) {
            continue;
        }
        reg.fns.entry((None, f.sig.ident.to_string())).or_default().push(FnDef {
            sig: f.sig.clone(),
            block: (*f.block).clone(),
            file: v.file.to_path_buf(),
            self_ty: None,
        });
    }
}
