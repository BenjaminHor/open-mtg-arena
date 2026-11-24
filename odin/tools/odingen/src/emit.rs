//! Emits the Odin data model: for every Rust type reachable from the roots, an Odin type, a `decode_<T>` and an
//! `encode_<T>` (plus `encode_<T>_members` for types that can be flattened into a parent object). Types whose serde
//! is hand-written in Rust get hand-written Odin codecs (odin/engine/types/hand_*.odin); the generator only emits
//! their Odin type. Mapping and rules: docs/odin-port.md, "O-1 data model design".

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt::Write;

use syn::{GenericArgument, PathArguments, Type};

use crate::model::{Fields, Kind, Registry, Serde, TypeDef, Variant};

/// How a Rust type is represented, resolved through aliases.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Bool,
    Int(&'static str),
    Float(&'static str),
    Str,
    Char,
    Unit,
    Json,
    Option(Box<Shape>),
    /// `Option<Box<T>>`: a nil-able pointer. The flag: shared (`Arc`/`Rc`, cloned by sharing and copied on write)
    /// rather than owned (`Box`, cloned deeply). Both are `^T` in Odin.
    OptPtr(Box<Shape>, bool),
    Ptr(Box<Shape>, bool),
    Vec(Box<Shape>),
    /// `im::Vector<T>`: a persistent chunked vector (`PVec(T)`, pvec.odin).
    PVec(Box<Shape>),
    /// `Result<T, E>` in translated logic: `Result(T, E)` (codec_runtime.odin), a value and a maybe-error.
    Result(Box<Shape>, Box<Shape>),
    Map(Box<Shape>, Box<Shape>),
    Tuple(Vec<Shape>),
    Array(Box<Shape>, String),
    Named(String, Vec<Shape>),
    /// A `&mut T` a translated function returns (`get_mut`): an Odin `^T` into the place, never owned or cloned.
    MutRef(Box<Shape>),
    Param(String),
    /// A type defined by hand outside the generated model (the RNG), named as Odin knows it.
    Extern(String),
    Unknown(String),
}

const ODIN_KEYWORDS: &[&str] = &[
    "import", "foreign", "package", "typeid", "when", "where", "if", "else", "for", "switch", "in", "not_in", "do",
    "case", "break", "continue", "fallthrough", "defer", "return", "proc", "struct", "union", "enum", "bit_set",
    "bit_field", "map", "dynamic", "auto_cast", "cast", "transmute", "distinct", "using", "context", "or_else",
    "or_return", "or_break", "or_continue", "asm", "matrix", "string", "int", "uint", "bool", "rune", "any",
    "rawptr", "b", "x", "v", "out", "first", "ok", "f",
];

/// An Odin identifier for a Rust field name (keywords and names the generated code uses get a trailing `_`).
pub fn field_ident(name: &str) -> String {
    let name = name.strip_prefix("r#").unwrap_or(name);
    if ODIN_KEYWORDS.contains(&name) {
        format!("{name}_")
    } else {
        name.to_string()
    }
}

/// serde_derive's RenameRule, for variants (written in PascalCase in Rust) and fields (snake_case).
pub fn rename(rule: &str, name: &str, is_variant: bool) -> String {
    let words: Vec<String> = if is_variant {
        // Split PascalCase into lowercase words, as serde does (each uppercase letter starts a word).
        let mut words = Vec::new();
        let mut cur = String::new();
        for (i, ch) in name.char_indices() {
            if ch.is_uppercase() && i > 0 {
                words.push(cur.clone());
                cur.clear();
            }
            cur.extend(ch.to_lowercase());
        }
        words.push(cur);
        words
    } else {
        name.split('_').map(|s| s.to_string()).collect()
    };
    match rule {
        "lowercase" => {
            if is_variant { name.to_ascii_lowercase() } else { name.to_string() }
        }
        "UPPERCASE" => name.to_ascii_uppercase(),
        "PascalCase" => {
            if is_variant {
                name.to_string()
            } else {
                words.iter().map(|w| capitalize(w)).collect()
            }
        }
        "camelCase" => {
            let pascal: String = if is_variant { name.to_string() } else { words.iter().map(|w| capitalize(w)).collect() };
            let mut c = pascal.chars();
            match c.next() {
                Some(f) => f.to_lowercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        }
        "snake_case" => {
            if is_variant { words.join("_") } else { name.to_string() }
        }
        "SCREAMING_SNAKE_CASE" => {
            if is_variant { words.join("_").to_ascii_uppercase() } else { name.to_ascii_uppercase() }
        }
        "kebab-case" => {
            if is_variant { words.join("-") } else { name.replace('_', "-") }
        }
        "SCREAMING-KEBAB-CASE" => {
            if is_variant { words.join("-").to_ascii_uppercase() } else { name.replace('_', "-").to_ascii_uppercase() }
        }
        other => panic!("unknown rename rule {other}"),
    }
}

/// An Odin type as part of an identifier: `[dynamic]Maybe(u32)` becomes `dyn_opt_u32`.
pub fn mangle(ty: &str) -> String {
    let t = ty.replace("[dynamic]", "dyn_").replace("Maybe(", "opt_").replace('^', "ptr_").replace("map[", "map_")
        .replace("Tuple2(", "t2_").replace("Tuple3(", "t3_").replace("Tuple4(", "t4_");
    let mut out = String::new();
    for c in t.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_end_matches('_').to_string()
}

/// A Rust path as part of an Odin identifier.
pub fn sanitize(path: &str) -> String {
    path.rsplit("::").take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("_")
}

fn capitalize(w: &str) -> String {
    let mut c = w.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Whether a type path names one of the `im` crate's persistent collections (`im::Vector`, `im::HashMap`, ...).
/// The engine always writes them qualified (`im::...`; checked: no `use im::` imports).
fn is_im_collection(ty: &Type) -> bool {
    let Type::Path(p) = ty else { return false };
    let segs: Vec<String> = p.path.segments.iter().map(|s| s.ident.to_string()).collect();
    segs.len() >= 2
        && segs[segs.len() - 2] == "im"
        && matches!(segs[segs.len() - 1].as_str(), "Vector" | "HashMap" | "HashSet" | "OrdMap" | "OrdSet")
}

fn last_ident(ty: &Type) -> Option<(String, Vec<Type>)> {
    if let Type::Path(p) = ty {
        let seg = p.path.segments.last()?;
        let mut args = Vec::new();
        if let PathArguments::AngleBracketed(a) = &seg.arguments {
            for arg in &a.args {
                if let GenericArgument::Type(t) = arg {
                    args.push(t.clone());
                }
            }
        }
        return Some((seg.ident.to_string(), args));
    }
    None
}

pub struct Emitter<'a> {
    pub reg: &'a Registry,
    /// Types whose codecs are hand-written in Odin.
    pub hand: BTreeSet<String>,
    /// Types written wholly by hand in Odin (type, codecs and `clone_<T>`), such as ObjectMap (object_map.odin), whose
    /// layout is the state's copy speed. The generator emits nothing for them and calls theirs by name; their
    /// `hand_deps` are emitted for them.
    pub hand_types: BTreeSet<String>,
    /// Types whose codec is generated from another type's serde attributes (a Rust "repr" struct the hand-written
    /// impl delegates to, with the same fields).
    pub codec_as: BTreeMap<String, String>,
    /// Types whose writer appends computed members after the fields (`encode_<T>_computed`, hand-written).
    pub computed: BTreeSet<String>,
    /// Types with `into = "..."` whose repr has the same shape, so the derived codec is right.
    pub ignore_into: BTreeSet<String>,
    /// What each hand-written codec reads and writes through generated codecs (its fields aren't walked: a hand
    /// type's runtime fields, like ManaPool's slot index, aren't serialized).
    pub hand_deps: BTreeMap<String, Vec<String>>,
    /// Types read by another type's serde attributes (a Rust "De" struct with the same fields).
    pub decode_as: BTreeMap<String, String>,
    /// Per-shape helper procedures for containers (decode/encode of Maybe, ^T, [dynamic], maps, tuples), so the
    /// generated code calls procedures directly instead of resolving the `decode`/`encode` overload groups (which
    /// cost most of the type-check time). Keyed by (is_decode, Odin type).
    pub helper_names: BTreeMap<(u8, String), String>,
    pub helpers_out: String,
    /// Generic types are emitted per instantiation (`Definitions<TriggerDefinition>` becomes
    /// `Definitions_TriggerDefinition`), so no Odin code is polymorphic and nothing needs overload groups.
    pub instances: BTreeMap<String, (String, Vec<Shape>)>,
    pub subst: BTreeMap<String, Shape>,
    /// Field adapters (`#[serde(with = "...")]`) that change the wire form, written by hand.
    pub with_reqs: BTreeMap<String, String>,
    /// Types whose `Default::default()` isn't Odin's zero value, given a `default_<T>()` procedure: derived
    /// (generated here, in `defaults_out`) or from `impl Default` (translated, see translate.rs).
    pub default_kind: BTreeMap<String, Option<String>>,
    pub defaults_out: String,
    pub manual_default_reqs: BTreeSet<String>,
    /// Types reachable from the roots through serialized fields: only these get codecs. The others are reached
    /// through `#[serde(skip)]` fields (runtime caches and indexes) and get an Odin type only.
    pub wire: BTreeSet<String>,
    pub types_out: String,
    pub codec_out: String,
    /// Generated `clone_<T>` procedures and their per-shape helpers (generated_clone.odin).
    pub clone_out: String,
    clone_names: BTreeMap<String, String>,
    /// `drop_<T>` procedures (in generated_clone.odin beside the clones): Rust's Drop as far as counts go.
    drop_names: BTreeMap<String, Option<String>>,
    drop_pending: Vec<(TypeDef, BTreeMap<String, Shape>)>,
    /// Generated `eq_<T>` procedures (Rust's derived PartialEq, for `==` on values Odin can't compare itself).
    pub eq_out: String,
    eq_names: BTreeMap<String, Result<Option<String>, String>>,
    plain_memo: BTreeMap<String, bool>,
    counts_memo: BTreeMap<String, bool>,
    pub emitted: BTreeSet<String>,
    queue: VecDeque<String>,
    /// Named skip predicates and default functions the codecs call, by Odin procedure name: the Rust path, the
    /// field's shape, and the type whose field it is (to find the function in the right module).
    pub skip_reqs: BTreeMap<String, (String, Shape, String)>,
    pub default_reqs: BTreeMap<String, (String, Shape, String)>,
    pub unknown_shapes: BTreeMap<String, BTreeSet<String>>,
    /// Types that some field flattens into its parent object (they need `_members` encoders).
    pub flattened: BTreeSet<String>,
    current: String,
}

impl<'a> Emitter<'a> {
    pub fn new(reg: &'a Registry, hand: BTreeSet<String>) -> Self {
        Emitter {
            reg,
            hand,
            hand_types: BTreeSet::new(),
            codec_as: BTreeMap::new(),
            computed: BTreeSet::new(),
            ignore_into: BTreeSet::new(),
            hand_deps: BTreeMap::new(),
            decode_as: BTreeMap::new(),
            helper_names: BTreeMap::new(),
            helpers_out: String::new(),
            instances: BTreeMap::new(),
            subst: BTreeMap::new(),
            with_reqs: BTreeMap::new(),
            default_kind: BTreeMap::new(),
            defaults_out: String::new(),
            manual_default_reqs: BTreeSet::new(),
            wire: BTreeSet::new(),
            types_out: String::new(),
            codec_out: String::new(),
            clone_out: String::new(),
            clone_names: BTreeMap::new(),
            drop_names: BTreeMap::new(),
            drop_pending: Vec::new(),
            eq_out: String::new(),
            eq_names: BTreeMap::new(),
            plain_memo: BTreeMap::new(),
            counts_memo: BTreeMap::new(),
            emitted: BTreeSet::new(),
            queue: VecDeque::new(),
            skip_reqs: BTreeMap::new(),
            default_reqs: BTreeMap::new(),
            unknown_shapes: BTreeMap::new(),
            flattened: BTreeSet::new(),
            current: String::new(),
        }
    }

    /// The definition used for a name: the serde-deriving one if there are several.
    pub fn def(&self, name: &str) -> Option<&'a TypeDef> {
        let defs = self.reg.types.get(name)?;
        defs.iter().find(|d| d.derives_serialize() || d.derives_deserialize()).or(defs.first())
    }

    pub fn shape(&mut self, ty: &Type, params: &[String]) -> Shape {
        match ty {
            Type::Reference(r) => return self.shape(&r.elem, params),
            Type::Paren(p) => return self.shape(&p.elem, params),
            Type::Group(g) => return self.shape(&g.elem, params),
            Type::Tuple(t) if t.elems.is_empty() => return Shape::Unit,
            Type::Tuple(t) => return Shape::Tuple(t.elems.iter().map(|e| self.shape(e, params)).collect()),
            Type::Array(a) => {
                let len = &a.len;
                let n = quote::quote!(#len).to_string();
                // `[T; Enum::COUNT]` is indexed by the enum, which must then be emitted.
                if let Some(en) = n.strip_suffix(":: COUNT").map(str::trim) {
                    self.require(en);
                }
                return Shape::Array(Box::new(self.shape(&a.elem, params)), n);
            }
            Type::Slice(s) => return Shape::Vec(Box::new(self.shape(&s.elem, params))),
            // `impl Iterator<Item = T>` (and `IntoIterator`, `DoubleEndedIterator`, ...): translated logic
            // materializes iterators, so one is a Vec of its items (docs/odin-port.md, "The translator's next layer").
            Type::ImplTrait(it) => {
                if let Some(item) = iterator_item(it.bounds.iter()) {
                    return Shape::Vec(Box::new(self.shape(&item, params)));
                }
            }
            _ => {}
        }
        // `Box<dyn Iterator<Item = T> + '_>`: the same.
        if let Type::Path(p) = ty {
            if let Some(seg) = p.path.segments.last() {
                if seg.ident == "Box" {
                    if let syn::PathArguments::AngleBracketed(a) = &seg.arguments {
                        if let Some(syn::GenericArgument::Type(Type::TraitObject(to))) = a.args.first() {
                            if let Some(item) = iterator_item(to.bounds.iter()) {
                                return Shape::Vec(Box::new(self.shape(&item, params)));
                            }
                        }
                    }
                }
            }
        }
        let Some((name, args)) = last_ident(ty) else {
            return Shape::Unknown(quote::quote!(#ty).to_string());
        };
        // An `im` collection clones in O(1) in Rust (persistent). The Odin model holds it as a shared collection,
        // like `Arc<Vec<T>>`: clones share it, the first write after a clone copies it (make_mut). Its JSON is the
        // plain collection's. docs/odin-port.md, "State layout".
        if is_im_collection(ty) && name == "Vector" {
            let elem = args.first().map(|t| self.shape(t, params)).unwrap_or(Shape::Unknown("im::Vector arg".into()));
            return Shape::PVec(Box::new(elem));
        }
        if is_im_collection(ty) {
            if let Type::Path(p) = ty {
                let mut plain = p.clone();
                let last = plain.path.segments.len() - 1;
                let seg = &mut plain.path.segments[last];
                seg.ident = syn::Ident::new(
                    match name.as_str() {
                        "Vector" => "Vec",
                        "HashSet" | "OrdSet" => "BTreeSet",
                        _ => "BTreeMap",
                    },
                    seg.ident.span(),
                );
                // Keep the plain collection's own name so `HashMap`/`OrdMap` keep their key handling.
                if name == "HashMap" || name == "OrdMap" {
                    seg.ident = syn::Ident::new(&name, seg.ident.span());
                }
                plain.path.segments = plain.path.segments.into_iter().skip(last).collect();
                return Shape::Ptr(Box::new(self.shape(&Type::Path(plain), params)), true);
            }
        }
        let arg = |this: &mut Self, i: usize| -> Shape {
            args.get(i).map(|t| this.shape(t, params)).unwrap_or(Shape::Unknown(format!("{name} arg {i}")))
        };
        match name.as_str() {
            "bool" => Shape::Bool,
            "u8" => Shape::Int("u8"),
            "u16" => Shape::Int("u16"),
            "u32" | "NonZeroU32" => Shape::Int("u32"),
            "u64" | "NonZeroU64" => Shape::Int("u64"),
            "u128" => Shape::Int("u128"),
            "usize" | "NonZeroUsize" => Shape::Int("int"),
            "NonZeroU8" => Shape::Int("u8"),
            "i8" => Shape::Int("i8"),
            "i16" => Shape::Int("i16"),
            "i32" => Shape::Int("i32"),
            "i64" => Shape::Int("i64"),
            "i128" => Shape::Int("i128"),
            "isize" => Shape::Int("int"),
            "f32" => Shape::Float("f32"),
            "f64" => Shape::Float("f64"),
            "char" => Shape::Char,
            "String" | "str" | "Cow" => Shape::Str,
            "Value" | "Map" if !self.reg.types.contains_key(&name) || name == "Map" => Shape::Json,
            "Option" => match arg(self, 0) {
                Shape::Ptr(inner, shared) => Shape::OptPtr(inner, shared),
                s => Shape::Option(Box::new(s)),
            },
            "Box" => Shape::Ptr(Box::new(arg(self, 0)), false),
            "Result" if args.len() == 2 => Shape::Result(Box::new(arg(self, 0)), Box::new(arg(self, 1))),
            "Arc" | "Rc" => Shape::Ptr(Box::new(arg(self, 0)), true),
            "Vec" | "VecDeque" | "SmallVec" | "Vector" | "HashSet" | "BTreeSet" | "IndexSet" | "OrdSet"
            | "FxHashSet" => {
                // SmallVec<[T; N]>: the element is inside the array argument.
                if name == "SmallVec" {
                    if let Some(Type::Array(a)) = args.first() {
                        return Shape::Vec(Box::new(self.shape(&a.elem, params)));
                    }
                }
                Shape::Vec(Box::new(arg(self, 0)))
            }
            "HashMap" | "BTreeMap" | "IndexMap" | "OrdMap" | "FxHashMap" => {
                Shape::Map(Box::new(arg(self, 0)), Box::new(arg(self, 1)))
            }
            "PhantomData" => Shape::Unit,
            // Runtime-only wrappers (behind #[serde(skip)] fields): the Odin type is what they hold.
            "Mutex" | "RwLock" | "OnceLock" | "OnceCell" | "Cell" | "RefCell" | "LazyLock" => arg(self, 0),
            "PathBuf" => Shape::Str,
            "Discriminant" => Shape::Int("u64"),
            // The game's ChaCha20 generator (types/game_state.rs GameRng): the verified Odin port.
            "ChaCha20Rng" => Shape::Extern("rng.Chacha20".into()),
            _ if self.subst.contains_key(&name) => self.subst[&name].clone(),
            _ if params.contains(&name) => Shape::Param(name),
            _ => {
                if let Some(aliases) = self.reg.aliases.get(&name) {
                    if self.reg.types.get(&name).is_none() {
                        let target = aliases[0].0.clone();
                        return self.shape(&target, params);
                    }
                }
                if self.reg.types.contains_key(&name) {
                    let a: Vec<Shape> = (0..args.len()).map(|i| arg(self, i)).collect();
                    if a.is_empty() {
                        self.require(&name);
                        return Shape::Named(name, a);
                    }
                    let inst = format!("{name}_{}", a.iter().map(|x| mangle(&self.odin(x))).collect::<Vec<_>>().join("_"));
                    self.instances.insert(inst.clone(), (name.clone(), a));
                    self.require(&inst);
                    Shape::Named(inst, vec![])
                } else {
                    self.unknown_shapes.entry(name.clone()).or_default().insert(self.current.clone());
                    Shape::Unknown(name)
                }
            }
        }
    }

    pub fn require(&mut self, name: &str) {
        if !self.emitted.contains(name) && !self.queue.iter().any(|q| q == name) {
            self.queue.push_back(name.to_string());
        }
    }

    pub fn odin(&self, s: &Shape) -> String {
        match s {
            Shape::Bool => "bool".into(),
            Shape::Int(t) | Shape::Float(t) => t.to_string(),
            Shape::Str => "string".into(),
            Shape::Char => "rune".into(),
            Shape::Unit => "Unit".into(),
            Shape::MutRef(i) => format!("^{}", self.odin(i)),
            Shape::Json => "json.Value".into(),
            Shape::Option(i) => format!("Maybe({})", self.odin(i)),
            Shape::Result(t, e) => format!("Result({}, {})", self.odin(t), self.odin(e)),
            Shape::OptPtr(i, _) | Shape::Ptr(i, _) => format!("^{}", self.odin(i)),
            Shape::PVec(i) => format!("PVec({})", self.odin(i)),
            Shape::Vec(i) => format!("[dynamic]{}", self.odin(i)),
            Shape::Map(k, v) => {
                if self.simple_key(k) {
                    format!("map[{}]{}", self.odin(k), self.odin(v))
                } else {
                    format!("[dynamic]Tuple2({}, {})", self.odin(k), self.odin(v))
                }
            }
            Shape::Tuple(es) => {
                let inner: Vec<String> = es.iter().map(|e| self.odin(e)).collect();
                format!("Tuple{}({})", es.len(), inner.join(", "))
            }
            // `[T; Enum::COUNT]` (strum's variant count) is Odin's enumerated array, indexed by the enum.
            Shape::Array(e, n) => match n.strip_suffix(":: COUNT").map(str::trim) {
                Some(en) => format!("[{en}]{}", self.odin(e)),
                None => format!("[{}]{}", n, self.odin(e)),
            },
            Shape::Named(n, args) if args.is_empty() => n.clone(),
            Shape::Named(n, args) => {
                let a: Vec<String> = args.iter().map(|x| self.odin(x)).collect();
                format!("{n}({})", a.join(", "))
            }
            Shape::Param(p) => p.clone(),
            Shape::Extern(e) => e.clone(),
            Shape::Unknown(u) => format!("Unknown /* {u} */"),
        }
    }

    /// Map keys Odin can hash and JSON can write as an object key: strings, integers, unit-only enums and newtypes
    /// of those.
    pub fn simple_key(&self, k: &Shape) -> bool {
        match k {
            Shape::Str | Shape::Int(_) | Shape::Char | Shape::Bool => true,
            Shape::Named(n, a) if a.is_empty() => match self.def(n).map(|d| &d.kind) {
                Some(Kind::Enum(vs)) => vs.iter().all(|v| matches!(v.fields, Fields::Unit)),
                Some(Kind::Struct(Fields::Tuple(fs))) if fs.len() == 1 => {
                    matches!(last_ident(&fs[0].ty).map(|x| x.0).as_deref(), Some("u8" | "u16" | "u32" | "u64" | "usize" | "i32" | "i64" | "String"))
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// The procedure that decodes a value of this shape: `proc(v: json.Value, out: ^T) -> bool`.
    pub fn dec(&mut self, s: &Shape) -> String {
        match s {
            Shape::Bool => "decode_bool".into(),
            Shape::Int(t) | Shape::Float(t) => format!("decode_{t}"),
            Shape::Str => "decode_string".into(),
            Shape::Char => "decode_rune".into(),
            Shape::Unit => "decode_unit".into(),
            Shape::Json => "decode_json".into(),
            Shape::Named(n, a) if a.is_empty() => format!("decode_{n}"),
            Shape::Named(..) | Shape::Param(_) | Shape::Unknown(_) | Shape::Extern(_) => "decode".into(),
            _ => self.helper(s, 0),
        }
    }

    /// The procedure that encodes a value of this shape: `proc(b: ^strings.Builder, x: T)`.
    pub fn enc(&mut self, s: &Shape) -> String {
        match s {
            Shape::Bool => "encode_bool".into(),
            Shape::Int(t) | Shape::Float(t) => format!("encode_{t}"),
            Shape::Str => "encode_string".into(),
            Shape::Char => "encode_rune".into(),
            Shape::Unit => "encode_unit".into(),
            Shape::Json => "encode_json".into(),
            Shape::Named(n, a) if a.is_empty() => format!("encode_{n}"),
            Shape::Named(..) | Shape::Param(_) | Shape::Unknown(_) | Shape::Extern(_) => "encode".into(),
            _ => self.helper(s, 1),
        }
    }

    /// The procedure that writes a flattened value's members into the enclosing object.
    pub fn mem(&mut self, s: &Shape) -> String {
        match s {
            Shape::Named(n, a) if a.is_empty() => {
                self.flattened.insert(n.clone());
                format!("encode_{n}_members")
            }
            Shape::Map(..) | Shape::Option(_) | Shape::Ptr(_, _) | Shape::OptPtr(_, _) => self.helper(s, 2),
            _ => "encode_members".into(),
        }
    }

    /// Decoding a JSON object key (always a string) as a map key of this shape.
    fn key_dec(&mut self, k: &Shape, key: &str, out: &str) -> String {
        match k {
            Shape::Str => format!("{out} = {key}; ok_k := true"),
            Shape::Int(_) | Shape::Named(..) if self.key_is_number(k) => {
                let d = self.dec(k);
                format!("ok_k := {d}(json.Value{{kind = .Number, text = {key}}}, &{out})")
            }
            _ => {
                let d = self.dec(k);
                format!("ok_k := {d}(json.Value{{kind = .String, text = {key}}}, &{out})")
            }
        }
    }

    fn key_is_number(&self, k: &Shape) -> bool {
        match k {
            Shape::Int(_) => true,
            Shape::Named(n, _) => matches!(self.def(n).map(|d| &d.kind), Some(Kind::Struct(Fields::Tuple(fs))) if fs.len() == 1
                && matches!(last_ident(&fs[0].ty).map(|x| x.0).as_deref(), Some("u8" | "u16" | "u32" | "u64" | "usize" | "i32" | "i64"))),
            _ => false,
        }
    }

    fn helper(&mut self, s: &Shape, kind: u8) -> String {
        let ty = self.odin(s);
        // A shared pointer (`Arc`) has the same Odin type as an owned one but is allocated with its count.
        let shared = matches!(s, Shape::Ptr(_, true) | Shape::OptPtr(_, true));
        let key = if shared { format!("{ty}#shared") } else { ty.clone() };
        if let Some(n) = self.helper_names.get(&(kind, key.clone())) {
            return n.clone();
        }
        let mangled = if shared { mangle(&ty).replacen("ptr_", "shared_", 1) } else { mangle(&ty) };
        let name = format!("{}_{}", ["dec", "enc", "mem"][kind as usize], mangled);
        self.helper_names.insert((kind, key), name.clone());
        let body = match (kind, s) {
            (0, Shape::Option(i)) => {
                let (it, d) = (self.odin(i), self.dec(i));
                format!("	if v.kind == .Null {{ out^ = nil; return true }}
	x: {it}
	if !{d}(v, &x) do return false
	out^ = x
	return true
")
            }
            (1, Shape::Option(i)) => {
                let e = self.enc(i);
                format!("	if y, ok := x.?; ok do {e}(b, y)
	else do strings.write_string(b, \"null\")
")
            }
            (2, Shape::Option(i)) => {
                let m = self.mem(i);
                format!("	if y, ok := x.?; ok do {m}(b, y, first)
")
            }
            (2, Shape::Ptr(i, _) | Shape::OptPtr(i, _)) => {
                // A flattened box: its members, or none when it's absent.
                let m = self.mem(i);
                format!("	if x != nil do {m}(b, x^, first)
")
            }
            (0, Shape::Ptr(i, sh) | Shape::OptPtr(i, sh)) => {
                let (it, d) = (self.odin(i), self.dec(i));
                let alloc = if *sh { format!("shared_new({it})") } else { format!("new({it})") };
                format!("	if v.kind == .Null {{ out^ = nil; return true }}
	p := {alloc}
	if !{d}(v, p) do return false
	out^ = p
	return true
")
            }
            (1, Shape::OptPtr(i, _)) => {
                let e = self.enc(i);
                format!("	if x == nil do strings.write_string(b, \"null\")
	else do {e}(b, x^)
")
            }
            (1, Shape::Ptr(i, _)) if !matches!(**i, Shape::Vec(_) | Shape::Map(..) | Shape::Str) => {
                let e = self.enc(i);
                format!("	if x == nil do strings.write_string(b, \"null\")
	else do {e}(b, x^)
")
            }
            (1, Shape::Ptr(i, _)) => {
                // A shared collection (Arc<Vec<T>>) is never null in Rust; nil here is a field read as absent,
                // standing for the empty collection.
                let (it, e) = (self.odin(i), self.enc(i));
                format!("	if x == nil {{ zero: {it}; {e}(b, zero) }}
	else do {e}(b, x^)
")
            }
            (0, Shape::PVec(i)) => {
                let (it, d) = (self.odin(i), self.dec(i));
                format!("	if v.kind != .Array do return fail(\"expected an array\")
	out^ = {{}}
	for item in v.items {{
		x: {it}
		if !{d}(item, &x) do return false
		pvec_push_new(out, x)
	}}
	return true
")
            }
            (1, Shape::PVec(i)) => {
                let e = self.enc(i);
                format!("	strings.write_byte(b, '[')
	for i in 0 ..< x.len {{
		if i > 0 do strings.write_byte(b, ',')
		{e}(b, pvec_get(x, i))
	}}
	strings.write_byte(b, ']')
")
            }
            (0, Shape::Vec(i)) => {
                let (it, d) = (self.odin(i), self.dec(i));
                format!("	if v.kind != .Array do return fail(\"expected an array\")
	out^ = make([dynamic]{it}, len(v.items))
	for item, i in v.items do if !{d}(item, &out[i]) do return false
	return true
")
            }
            (1, Shape::Vec(i)) => {
                let e = self.enc(i);
                format!("	strings.write_byte(b, '[')
	for item, i in x {{
		if i > 0 do strings.write_byte(b, ',')
		{e}(b, item)
	}}
	strings.write_byte(b, ']')
")
            }
            (0, Shape::Array(i, n)) => {
                let d = self.dec(i);
                format!("	if v.kind != .Array || len(v.items) != {n} do return fail(\"expected a fixed-size array\")
	for item, i in v.items do if !{d}(item, &out[i]) do return false
	return true
")
            }
            (1, Shape::Array(i, _)) => {
                let e = self.enc(i);
                format!("	strings.write_byte(b, '[')
	for item, i in x {{
		if i > 0 do strings.write_byte(b, ',')
		{e}(b, item)
	}}
	strings.write_byte(b, ']')
")
            }
            (0, Shape::Tuple(es)) => {
                let mut b = format!("	if v.kind != .Array || len(v.items) != {} do return fail(\"expected a tuple\")
", es.len());
                for (i, e) in es.iter().enumerate() {
                    let d = self.dec(e);
                    let _ = writeln!(b, "	if !{d}(v.items[{i}], &out._{i}) do return false");
                }
                b.push_str("	return true
");
                b
            }
            (1, Shape::Tuple(es)) => {
                let mut b = "	strings.write_byte(b, '[')
".to_string();
                for (i, e) in es.iter().enumerate() {
                    let en = self.enc(e);
                    if i > 0 {
                        b.push_str("	strings.write_byte(b, ',')
");
                    }
                    let _ = writeln!(b, "	{en}(b, x._{i})");
                }
                b.push_str("	strings.write_byte(b, ']')
");
                b
            }
            (_, Shape::Map(k, v)) if !self.simple_key(k) => {
                // Written as an array of [key, value] pairs.
                // Same Odin type as the list of pairs, so the list's helper is this helper.
                let pair = Shape::Vec(Box::new(Shape::Tuple(vec![(**k).clone(), (**v).clone()])));
                self.helper_names.remove(&(kind, ty.clone()));
                return if kind == 0 { self.dec(&pair) } else { self.enc(&pair) };
            }
            (0, Shape::Map(k, v)) => {
                let (kt, vt) = (self.odin(k), self.odin(v));
                let kd = self.key_dec(k, "m.key", "key");
                let vd = self.dec(v);
                format!("	if v.kind != .Object do return fail(\"expected an object (map)\")
	out^ = make(map[{kt}]{vt}, len(v.members))
	for m in v.members {{
		key: {kt}
		val: {vt}
		{kd}
		if !ok_k || !{vd}(m.value, &val) do return false
		out[key] = val
	}}
	return true
")
            }
            (1 | 2, Shape::Map(k, v)) => {
                let ke = self.enc(k);
                let ve = self.enc(v);
                let key_write = match &**k {
                    Shape::Str => "json.write_string(b, k)".to_string(),
                    _ if self.key_is_number(k) => format!("strings.write_byte(b, '\"'); {ke}(b, k); strings.write_byte(b, '\"')"),
                    _ => format!("{ke}(b, k)"),
                };
                if kind == 1 {
                    format!("	strings.write_byte(b, '{{')
	first := true
	for k, val in x {{
		if !first do strings.write_byte(b, ',')
		first = false
		{key_write}
		strings.write_byte(b, ':')
		{ve}(b, val)
	}}
	strings.write_byte(b, '}}')
")
                } else {
                    format!("	for k, val in x {{
		if !first^ do strings.write_byte(b, ',')
		first^ = false
		{key_write}
		strings.write_byte(b, ':')
		{ve}(b, val)
	}}
")
                }
            }
            _ => return if kind == 0 { "decode".into() } else if kind == 1 { "encode".into() } else { "encode_members".into() },
        };
        let sig = match kind {
            0 => format!("proc(v: json.Value, out: ^{ty}) -> bool"),
            1 => format!("proc(b: ^strings.Builder, x: {ty})"),
            _ => format!("proc(b: ^strings.Builder, x: {ty}, first: ^bool)"),
        };
        let _ = writeln!(self.helpers_out, "{name} :: {sig} {{\n{body}}}\n");
        name
    }

    /// A map (or Option of one) read and written as an array of [key, value] pairs.
    fn pairs_helper(&mut self, shape: &Shape, decode: bool) -> String {
        let (inner, optional) = match shape {
            Shape::Option(i) => ((**i).clone(), true),
            s => (s.clone(), false),
        };
        let Shape::Map(k, v) = &inner else { return "decode".into() };
        if !self.simple_key(k) {
            // Already a list of pairs in Odin.
            return if decode { self.dec(shape) } else { self.enc(shape) };
        }
        let ty = self.odin(shape);
        let name = format!("{}_pairs_{}", if decode { "dec" } else { "enc" }, mangle(&ty));
        if self.helper_names.values().any(|n| n == &name) {
            return name;
        }
        self.helper_names.insert((if decode { 5 } else { 6 }, ty.clone()), name.clone());
        let (kt, vt) = (self.odin(k), self.odin(v));
        let (kd, vd, ke, ve) = (self.dec(k), self.dec(v), self.enc(k), self.enc(v));
        let body = if decode {
            let target = if optional { "m" } else { "out^" };
            let mut b = String::new();
            if optional {
                let _ = writeln!(b, "\tif v.kind == .Null {{ out^ = nil; return true }}\n\tm: map[{kt}]{vt}");
            }
            let _ = write!(b, "\tif v.kind != .Array do return fail(\"expected [key, value] pairs\")\n\t{target} = make(map[{kt}]{vt}, len(v.items))\n\tfor p in v.items {{\n\t\tif p.kind != .Array || len(p.items) != 2 do return fail(\"expected a [key, value] pair\")\n\t\tkey: {kt}\n\t\tval: {vt}\n\t\tif !{kd}(p.items[0], &key) || !{vd}(p.items[1], &val) do return false\n\t\t{target}[key] = val\n\t}}\n");
            if optional {
                b.push_str("\tout^ = m\n");
            }
            b.push_str("\treturn true\n");
            b
        } else {
            let mut b = String::new();
            let src = if optional {
                b.push_str("\tm, ok := x.?\n\tif !ok { strings.write_string(b, \"null\"); return }\n");
                "m"
            } else {
                "x"
            };
            // BTreeMap order: sorted keys.
            let _ = write!(b, "\tkeys := make([dynamic]{kt}, 0, len({src}), context.temp_allocator)\n\tfor k in {src} do append(&keys, k)\n\tslice.sort(keys[:])\n\tstrings.write_byte(b, '[')\n\tfor k, i in keys {{\n\t\tif i > 0 do strings.write_byte(b, ',')\n\t\tstrings.write_byte(b, '[')\n\t\t{ke}(b, k)\n\t\tstrings.write_byte(b, ',')\n\t\t{ve}(b, {src}[k])\n\t\tstrings.write_byte(b, ']')\n\t}}\n\tstrings.write_byte(b, ']')\n");
            b
        };
        let sig = if decode { format!("proc(v: json.Value, out: ^{ty}) -> bool") } else { format!("proc(b: ^strings.Builder, x: {ty})") };
        let _ = writeln!(self.helpers_out, "{name} :: {sig} {{\n{body}}}\n");
        name
    }

    fn alias_helper(&mut self, name: &str, target: &str) -> String {
        let _ = writeln!(self.helpers_out, "{name} :: {target}\n");
        name.to_string()
    }

    /// Field adapters (`with`, `serialize_with`, `deserialize_with`). Those that change the written form are
    /// hand-written as decode_with_<fn>/encode_with_<fn> (hand_codecs.odin); each was read in the Rust source:
    /// five write a legacy bool for a two-variant enum, serialize_multi_target_min writes a fixed quantity as a bare
    /// number, serialize_damage_amount_compat writes a per-source threshold as a [comparator, threshold] pair. Any
    /// other `deserialize_with` reads today's (derived) form plus older ones, and deterministic_serde writers keep
    /// the derived shape (sorted). An adapter not listed becomes a missing procedure, so it can't slip through.
    fn with_adapter(&mut self, f: &crate::model::Field, shape: &Shape, decode: bool) -> Option<String> {
        const CHANGES_FORM: &[&str] = &[
            "etb_tap_bool_compat", "card_selection_bool_compat", "additional_cost_repeatability_bool_compat",
            "discard_self_scope_bool_compat", "source_exclusion_bool_compat",
            "serialize_damage_amount_compat", "deserialize_damage_amount_compat",
            "serialize_multi_target_min", "deserialize_multi_target_min",
        ];
        let path = if decode {
            f.serde.with.clone().or(f.serde.deserialize_with.clone())
        } else {
            f.serde.with.clone().or(f.serde.serialize_with.clone())
        }?;
        let last = path.rsplit("::").next().unwrap_or(&path).to_string();
        // analysis/resource.rs map_key_pairs (and its `opt` for Option<map>): a map written as [[key, value], ...].
        if path == "map_key_pairs" || path == "map_key_pairs::opt" {
            return Some(self.pairs_helper(shape, decode));
        }
        let keeps_form = path.contains("deterministic_serde")
            || matches!(last.as_str(), "hash_set" | "hash_map" | "option_hash_set" | "option_hash_map" | "vec_hash_map"
                | "hash_map_of_hash_set" | "im_hash_set" | "im_hash_map" | "im_hash_map_of_im_hash_map");
        if keeps_form || (decode && f.serde.with.is_none() && !CHANGES_FORM.contains(&last.as_str())) {
            return None;
        }
        // One name per adapter pair: the serialize_/deserialize_ prefix dropped.
        let key = last.trim_start_matches("serialize_").trim_start_matches("deserialize_").to_string();
        let n = if decode { format!("decode_with_{key}") } else { format!("encode_with_{key}") };
        self.with_reqs.insert(n.clone(), path.clone());
        // On an `im` collection (a shared collection in the model) the hand-written adapter works on the collection
        // itself; a generated wrapper allocates or dereferences the shared pointer around it.
        if let Shape::Ptr(inner, true) = shape {
            let it = self.odin(inner);
            let wrapper = format!("{n}_shared");
            if self.helper_names.insert((if decode { 4 } else { 5 }, wrapper.clone()), wrapper.clone()).is_none() {
                let body = if decode {
                    format!("{wrapper} :: proc(v: json.Value, out: ^^{it}) -> bool {{\n\tp := shared_new({it})\n\tif !{n}(v, p) do return false\n\tout^ = p\n\treturn true\n}}\n\n")
                } else {
                    format!("{wrapper} :: proc(b: ^strings.Builder, x: ^{it}) {{\n\tif x == nil {{ zero: {it}; {n}(b, zero) }} else do {n}(b, x^)\n}}\n\n")
                };
                self.helpers_out.push_str(&body);
            }
            return Some(wrapper);
        }
        Some(n)
    }

    /// An Odin expression for `Default::default()` of this shape, or None when Odin's zero value is it.
    pub fn default_expr(&mut self, s: &Shape) -> Option<String> {
        // Box<T>/Arc<T>: a fresh allocation of T's default (Box::default()). Shared collections stay nil, which
        // the codecs and skip tests read as empty.
        if let Shape::Ptr(i, shared) = s {
            if matches!(**i, Shape::Vec(_) | Shape::Map(..) | Shape::Str) {
                return None;
            }
            let it = self.odin(i);
            return Some(match (self.default_expr(i), *shared) {
                (Some(inner), true) => format!("shared_from({inner})"),
                (Some(inner), false) => format!("new_clone({inner})"),
                // The zero value is the default (a nil inner pointer included).
                (None, true) => format!("shared_new({it})"),
                (None, false) => format!("new({it})"),
            });
        }
        let Shape::Named(n, a) = s else { return None };
        if !a.is_empty() {
            return None;
        }
        if let Some(cached) = self.default_kind.get(n) {
            return cached.clone();
        }
        // Mark first: recursive types.
        self.default_kind.insert(n.clone(), None);
        let has_manual = self.reg.fns.contains_key(&(Some(n.clone()), "__Default".to_string()));
        let def = self.def(n)?;
        let derives_default = def.derives.iter().any(|d| d == "Default");
        let result = if has_manual && !derives_default {
            self.manual_default_reqs.insert(n.clone());
            Some(format!("default_{n}()"))
        } else {
            match &def.kind {
                Kind::Enum(vs) => {
                    let unit = vs.iter().all(|v| matches!(v.fields, Fields::Unit));
                    match vs.iter().position(|v| v.is_default) {
                        Some(0) if unit => None,
                        Some(i) if unit => Some(format!("{n}.{}", vs[i].name)),
                        Some(i) => Some(format!("{n}({n}_{}{{}})", vs[i].name)),
                        None => None,
                    }
                }
                Kind::Struct(Fields::Named(fs)) if derives_default => {
                    let fs = fs.clone();
                    let mut parts = Vec::new();
                    for f in &fs {
                        let sh = self.shape(&f.ty, &[]);
                        if let Some(e) = self.default_expr(&sh) {
                            parts.push(format!("{} = {e}", field_ident(f.name.as_ref().unwrap())));
                        }
                    }
                    if parts.is_empty() {
                        None
                    } else {
                        let _ = writeln!(self.defaults_out, "default_{n} :: proc() -> {n} {{\n\treturn {n}{{{}}}\n}}\n", parts.join(", "));
                        Some(format!("default_{n}()"))
                    }
                }
                Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                    let sh = self.shape(&fs[0].ty, &[]);
                    self.default_expr(&sh).map(|e| format!("{n}({e})"))
                }
                _ => None,
            }
        };
        self.default_kind.insert(n.clone(), result.clone());
        result
    }

    /// Walks serialized fields from the roots (skipped fields and variants left out; hand-coded types followed
    /// through all their fields, conservatively).
    fn compute_wire(&mut self, roots: &[&str]) {
        let mut stack: Vec<String> = roots.iter().map(|r| r.to_string()).collect();
        while let Some(n) = stack.pop() {
            if !self.wire.insert(n.clone()) {
                continue;
            }
            if self.hand.contains(&n) {
                for d in self.hand_deps.get(&n).cloned().unwrap_or_default() {
                    if !self.wire.contains(&d) {
                        stack.push(d);
                    }
                }
                continue;
            }
            let mut defs: Vec<&TypeDef> = self.def(&n).into_iter().collect();
            if self.codec_as.contains_key(&n) || self.decode_as.contains_key(&n) {
                // The repr stands for the type on the wire; the type's own other fields are runtime state.
                defs.clear();
            }
            for alt in [self.codec_as.get(&n), self.decode_as.get(&n)].into_iter().flatten() {
                if let Some(d) = self.def(alt) {
                    defs.push(d);
                }
            }
            let mut tys: Vec<Type> = Vec::new();
            for d in defs {
                let custom = !d.derives_serialize();
                let mut take = |fs: &Fields| {
                    if let Fields::Named(v) | Fields::Tuple(v) = fs {
                        for f in v {
                            if custom || !(f.serde.skip || (f.serde.skip_serializing && f.serde.skip_deserializing)) {
                                tys.push(f.ty.clone());
                            }
                        }
                    }
                };
                match &d.kind {
                    Kind::Struct(fs) => take(fs),
                    Kind::Enum(vs) => {
                        for v in vs {
                            if custom || !v.serde.skip {
                                take(&v.fields);
                            }
                        }
                    }
                }
            }
            for t in tys {
                let mut names = Vec::new();
                crate::type_names(&t, &mut names);
                for nm in names {
                    let resolved = match self.reg.aliases.get(&nm) {
                        Some(a) if !self.reg.types.contains_key(&nm) => {
                            let mut inner = Vec::new();
                            crate::type_names(&a[0].0, &mut inner);
                            inner
                        }
                        _ => vec![nm],
                    };
                    for x in resolved {
                        if self.reg.types.contains_key(&x) && !self.wire.contains(&x) {
                            stack.push(x);
                        }
                    }
                }
            }
        }
    }

    pub fn run(&mut self, roots: &[&str]) {
        self.compute_wire(roots);
        for r in roots {
            self.require(r);
        }
        self.drain();
    }

    /// Emits more types (and what they use) after `run`: types only, no codecs unless already serialized. The
    /// logic's types that saves never hold (translate-report).
    pub fn emit_more(&mut self, names: &[String]) {
        for n in names {
            self.require(n);
        }
        self.drain();
    }

    /// Emits every queued type, then the drops of those types (after, so that what the drops look at doesn't
    /// reorder the types and codecs), and again for anything the drops queued.
    fn drain(&mut self) {
        loop {
            self.drain_queue();
            if self.drop_pending.is_empty() {
                break;
            }
            for (def, subst) in std::mem::take(&mut self.drop_pending) {
                self.subst = subst;
                self.current = def.name.clone();
                self.emit_drop(&def);
            }
        }
    }

    fn drain_queue(&mut self) {
        while let Some(name) = self.queue.pop_front() {
            if self.emitted.contains(&name) {
                continue;
            }
            self.emitted.insert(name.clone());
            let inst = self.instances.get(&name).cloned();
            let owned;
            let def: &TypeDef = match &inst {
                Some((base, args)) => {
                    let Some(b) = self.def(base) else { continue };
                    let mut d = b.clone();
                    self.subst = d.generics.iter().cloned().zip(args.iter().cloned()).collect();
                    d.name = name.clone();
                    d.generics.clear();
                    owned = d;
                    &owned
                }
                None => {
                    self.subst.clear();
                    match self.def(&name) {
                        Some(d) => d,
                        None => continue,
                    }
                }
            };
            self.current = name.clone();
            if self.hand_types.contains(&name) {
                for d in self.hand_deps.get(&name).cloned().unwrap_or_default() {
                    self.require(&d);
                }
                continue;
            }
            self.emit_type(def);
            self.emit_clone(def);
            self.drop_pending.push((def.clone(), self.subst.clone()));
            let base = inst.as_ref().map(|(b, _)| b.clone()).unwrap_or(name.clone());
            if !self.wire.contains(&base) {
                continue;
            }
            // An instance of a serialized generic is serialized only if its arguments are (LazyBoxedVec<T> holds
            // serialized vectors and, behind `#[serde(skip)]`, the runtime-only QueuedControlChange).
            if let Some((_, args)) = &inst {
                let mut names = Vec::new();
                for a in args {
                    shape_names(a, &mut names);
                }
                if names.iter().any(|n| self.reg.types.contains_key(n) && !self.wire.contains(n)) {
                    continue;
                }
            }
            if self.hand.contains(&name) {
                // Hand-written codecs call the generated codecs of what they declare (hand_deps), and the per-shape
                // helpers of their fields whose types are all serialized (a runtime-only field's are left out).
                for d in self.hand_deps.get(&name).cloned().unwrap_or_default() {
                    self.require(&d);
                }
                let mut field_tys = Vec::new();
                match &def.kind {
                    Kind::Struct(Fields::Named(fs) | Fields::Tuple(fs)) => field_tys.extend(fs.iter().map(|f| f.ty.clone())),
                    Kind::Enum(vs) => {
                        for v in vs {
                            if let Fields::Named(fs) | Fields::Tuple(fs) = &v.fields {
                                field_tys.extend(fs.iter().map(|f| f.ty.clone()));
                            }
                        }
                    }
                    _ => {}
                }
                for t in field_tys {
                    let mut names = Vec::new();
                    crate::type_names(&t, &mut names);
                    if names.iter().all(|n| !self.reg.types.contains_key(n) || self.wire.contains(n)) {
                        let sh = self.shape(&t, &[]);
                        self.dec(&sh);
                        self.enc(&sh);
                    }
                }
            }
            if !self.hand.contains(&name) {
                let enc_def = self.codec_as.get(&name).and_then(|r| self.def(r)).unwrap_or(def);
                let dec_def = self.decode_as.get(&name).and_then(|r| self.def(r)).unwrap_or(enc_def);
                // A repr's serde attributes with the real type's fields: same-named fields take the real field's
                // type (the repr may borrow where the type owns), and repr fields the type lacks (legacy input
                // fields such as AbilityDefinitionDe.sorcery_speed) are dropped.
                let merge = |repr: &TypeDef| -> TypeDef {
                    let mut d = repr.clone();
                    d.name = name.clone();
                    if let (Kind::Struct(Fields::Named(rf)), Kind::Struct(Fields::Named(real))) = (&mut d.kind, &def.kind) {
                        rf.retain_mut(|f| match real.iter().find(|x| x.name == f.name) {
                            Some(x) => {
                                f.ty = x.ty.clone();
                                true
                            }
                            None => false,
                        });
                    }
                    d
                };
                let (ed, dd) = (merge(enc_def), merge(dec_def));
                if dd.file == ed.file && std::ptr::eq(enc_def, dec_def) {
                    self.emit_codec(&ed, true, true);
                } else {
                    self.emit_codec(&dd, true, false);
                    self.emit_codec(&ed, false, true);
                }
            }
        }
    }

    fn params_decl(def: &TypeDef) -> String {
        if def.generics.is_empty() {
            String::new()
        } else {
            let p: Vec<String> = def.generics.iter().map(|g| format!("${g}: typeid")).collect();
            format!("({})", p.join(", "))
        }
    }

    fn fields_struct(&mut self, fields: &Fields, params: &[String]) -> String {
        let mut out = String::new();
        match fields {
            Fields::Named(fs) => {
                for f in fs {
                    let s = self.shape(&f.ty, params);
                    let _ = writeln!(out, "\t{}: {},", field_ident(f.name.as_ref().unwrap()), self.odin(&s));
                }
            }
            Fields::Tuple(fs) => {
                for (i, f) in fs.iter().enumerate() {
                    let s = self.shape(&f.ty, params);
                    let _ = writeln!(out, "\t_{i}: {},", self.odin(&s));
                }
            }
            Fields::Unit => {}
        }
        out
    }

    fn is_unit_enum(def: &TypeDef) -> bool {
        matches!(&def.kind, Kind::Enum(vs) if vs.iter().all(|v| matches!(v.fields, Fields::Unit)))
    }

    fn emit_type(&mut self, def: &TypeDef) {
        let params = def.generics.clone();
        let name = &def.name;
        match &def.kind {
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 && params.is_empty() => {
                let s = self.shape(&fs[0].ty, &params);
                let _ = writeln!(self.types_out, "{name} :: distinct {}\n", self.odin(&s));
            }
            Kind::Struct(fields) => {
                let body = self.fields_struct(fields, &params);
                let _ = writeln!(self.types_out, "{name} :: struct{} {{\n{body}}}\n", Self::params_decl(def));
            }
            Kind::Enum(vs) if Self::is_unit_enum(def) => {
                let names: Vec<String> = vs.iter().map(|v| format!("\t{},", v.name)).collect();
                let _ = writeln!(self.types_out, "{name} :: enum u16 {{\n{}\n}}\n", names.join("\n"));
            }
            Kind::Enum(vs) => {
                let mut members = Vec::new();
                for v in vs {
                    let vname = format!("{name}_{}", v.name);
                    let body = self.fields_struct(&v.fields, &params);
                    let _ = writeln!(self.types_out, "{vname} :: struct{} {{\n{body}}}", Self::params_decl(def));
                    if params.is_empty() {
                        members.push(format!("\t{vname},"));
                    } else {
                        members.push(format!("\t{vname}({}),", params.join(", ")));
                    }
                }
                let _ = writeln!(self.types_out, "{name} :: union{} {{\n{}\n}}\n", Self::params_decl(def), members.join("\n"));
            }
        }
    }

    // ------------------------------------------------------------------------------------------------ codecs ---

    fn json_field_name(f_name: &str, field: &Serde, rule: Option<&str>) -> String {
        if let Some(r) = &field.rename {
            return r.clone();
        }
        match rule {
            Some(rule) => rename(rule, f_name.strip_prefix("r#").unwrap_or(f_name), false),
            None => f_name.strip_prefix("r#").unwrap_or(f_name).to_string(),
        }
    }

    fn variant_name(v: &Variant, enum_serde: &Serde) -> String {
        if let Some(r) = &v.serde.rename {
            return r.clone();
        }
        match &enum_serde.rename_all {
            Some(rule) => rename(rule, &v.name, true),
            None => v.name.clone(),
        }
    }

    /// The Odin expression that tests whether a field is skipped when serializing.
    fn skip_expr(&mut self, pred: &str, expr: &str, shape: &Shape) -> String {
        let last = pred.rsplit("::").next().unwrap_or(pred);
        match (pred, last) {
            (_, "is_none") if pred.starts_with("Option") => format!("{expr} == nil"),
            (_, "is_empty") if pred.starts_with("std::collections::") || pred.starts_with("Vec") || pred.starts_with("HashMap") || pred.starts_with("HashSet")
                || pred.starts_with("BTreeMap") || pred.starts_with("BTreeSet") || pred.starts_with("im::")
                || pred.starts_with("String") || pred.starts_with("IndexMap") || pred.starts_with("SmallVec")
                || pred.starts_with("VecDeque") => {
                // Through any pointers (a shared collection, a Box of one): nil at any level is the empty collection.
                let mut cond = Vec::new();
                let mut e = expr.to_string();
                let mut sh = shape;
                while let Shape::Ptr(i, _) | Shape::OptPtr(i, _) = sh {
                    cond.push(format!("{e} == nil"));
                    e = format!("{e}^");
                    sh = i;
                }
                cond.push(if matches!(sh, Shape::PVec(_)) { format!("{e}.len == 0") } else { format!("len({e}) == 0") });
                format!("({})", cond.join(" || "))
            }
            ("std::ops::Not::not" | "Not::not", _) | (_, "is_false") => format!("!{expr}"),
            (_, "is_zero_u32" | "is_zero_usize" | "is_zero_u64" | "is_zero" | "is_zero_u32_field" | "is_zero_u8"
                | "is_zero_i32") if matches!(shape, Shape::Int(_)) => format!("{expr} == 0"),
            _ => {
                // Named per field type too: a generic predicate (`is_default<T>`) serves fields of several types.
                let proc_name = format!("skip_{}_{}_{}", self.current, sanitize(pred), mangle(&self.odin(shape)));
                self.skip_reqs.insert(proc_name.clone(), (pred.to_string(), shape.clone(), self.current.clone()));
                format!("{proc_name}({expr})")
            }
        }
    }

    fn default_stmt(&mut self, target: &str, field: &Serde, shape: &Shape) -> Option<String> {
        match &field.default {
            Some(Some(path)) => {
                let proc_name = format!("default_{}_{}", self.current, sanitize(path));
                self.default_reqs.insert(proc_name.clone(), (path.to_string(), shape.clone(), self.current.clone()));
                Some(format!("{target} = {proc_name}()"))
            }
            Some(None) => Some(String::new()),
            None => None,
        }
    }

    /// Decode statements for a struct's named fields from the object `v` into `out`.
    fn decode_named_fields(&mut self, fields: &[crate::model::Field], params: &[String], rule: Option<&str>, container_default: bool, ctx: &str) -> String {
        let mut out = String::new();
        // A container `#[serde(default)]` with a hand-written `impl Default` takes missing fields from it.
        let owner = self.current.clone();
        let container_manual_default = if container_default {
            let manual = self.reg.fns.contains_key(&(Some(owner.clone()), "__Default".to_string()))
                && !self.def(&owner).map(|d| d.derives.iter().any(|x| x == "Default")).unwrap_or(false);
            if manual {
                self.manual_default_reqs.insert(owner.clone());
                Some(owner)
            } else {
                None
            }
        } else {
            None
        };
        for f in fields {
            let fname = f.name.as_ref().unwrap();
            let id = field_ident(fname);
            if f.serde.skip || f.serde.skip_deserializing {
                // serde still sets a skipped field: `default = "path"`, else the container's Default (with a
                // container `#[serde(default)]`), else the field type's Default.
                let shape = self.shape(&f.ty, params);
                let stmt = match self.default_stmt(&format!("out.{id}"), &f.serde, &shape) {
                    Some(stmt) if !stmt.is_empty() => Some(stmt),
                    _ => match (container_default, container_manual_default.clone()) {
                        (true, Some(ty)) => Some(format!("out.{id} = default_{ty}().{id}")),
                        _ => self.default_expr(&shape).map(|e| format!("out.{id} = {e}")),
                    },
                };
                if let Some(stmt) = stmt {
                    let _ = writeln!(out, "	{stmt} // skipped when reading: its default");
                }
                continue;
            }
            let shape = self.shape(&f.ty, params);
            let d = match self.with_adapter(f, &shape, true) {
                Some(w) => w,
                None => self.dec(&shape),
            };
            if f.serde.flatten {
                let _ = writeln!(out, "\tif !{d}(v, &out.{id}) do return fail(\"{ctx}.{fname} (flattened)\")");
                continue;
            }
            let jname = Self::json_field_name(fname, &f.serde, rule);
            let mut names = vec![jname.clone()];
            names.extend(f.serde.aliases.iter().cloned());
            let lookup: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let missing = if let Some(stmt) = self.default_stmt(&format!("out.{id}"), &f.serde, &shape) {
                if !stmt.is_empty() {
                    format!(" else {{ {stmt} }}")
                } else {
                    // `#[serde(default)]`: the field type's Default, which may not be Odin's zero value.
                    match self.default_expr(&shape) {
                        Some(e) => format!(" else {{ out.{id} = {e} }}"),
                        None => String::new(),
                    }
                }
            } else if container_default {
                // The container's Default supplies the field: its own Default if derived, else the hand impl's.
                match container_manual_default.clone() {
                    Some(ty) => format!(" else {{ out.{id} = default_{ty}().{id} }}"),
                    None => match self.default_expr(&shape) {
                        Some(e) => format!(" else {{ out.{id} = {e} }}"),
                        None => String::new(),
                    },
                }
            } else if matches!(shape, Shape::Option(_) | Shape::OptPtr(_, _)) {
                String::new()
            } else {
                format!(" else {{ return fail(\"{ctx}.{fname} missing\") }}")
            };
            let _ = writeln!(
                out,
                "\tif fv, found := get_any(v, {}); found {{ if !{d}(fv, &out.{id}) do return fail(\"{ctx}.{fname}\") }}{missing}",
                lookup.join(", ")
            );
        }
        out
    }

    /// Statements writing a struct's named fields as members of an object already opened (`first` tracks commas).
    fn encode_named_fields(&mut self, fields: &[crate::model::Field], params: &[String], rule: Option<&str>, src: &str) -> String {
        let mut out = String::new();
        for f in fields {
            let fname = f.name.as_ref().unwrap();
            let id = field_ident(fname);
            if f.serde.skip || f.serde.skip_serializing {
                continue;
            }
            let shape = self.shape(&f.ty, params);
            let expr = format!("{src}.{id}");
            if f.serde.flatten {
                let m = self.mem(&shape);
                let _ = writeln!(out, "\t{m}(b, {expr}, first)");
                continue;
            }
            let e = match self.with_adapter(f, &shape, false) {
                Some(w) => w,
                None => self.enc(&shape),
            };
            let jname = Self::json_field_name(fname, &f.serde, rule);
            let write = format!("member(b, first, \"{jname}\"); {e}(b, {expr})");
            match &f.serde.skip_serializing_if {
                Some(pred) => {
                    let cond = self.skip_expr(pred, &expr, &shape);
                    let _ = writeln!(out, "\tif !({cond}) {{ {write} }}");
                }
                None => {
                    let _ = writeln!(out, "\t{write}");
                }
            }
        }
        out
    }

    fn emit_codec(&mut self, def: &TypeDef, want_decode: bool, want_encode: bool) {
        let params = def.generics.clone();
        let name = def.name.clone();
        let ty = if params.is_empty() { name.clone() } else { format!("{name}({})", params.iter().map(|p| format!("${p}")).collect::<Vec<_>>().join(", ")) };
        let ty_use = if params.is_empty() { name.clone() } else { format!("{name}({})", params.join(", ")) };
        let serde = def.serde.clone();
        if serde.into.is_some() && !self.ignore_into.contains(&name) {
            // Written through another type: hand-written. (`from`/`try_from` alone only add tolerant reading of older
            // forms; what Rust writes is the derived shape, which is what the generated codec reads.)
            self.hand.insert(name.clone());
            return;
        }
        let mut dec = String::new();
        let mut enc = String::new();
        let mut members: Option<String> = None;
        let rule = serde.rename_all.clone();
        match &def.kind {
            Kind::Struct(Fields::Unit) => {
                dec = "\t_ = out\n\treturn v.kind == .Null || v.kind == .Object\n".into();
                enc = "\t_ = x\n\tstrings.write_string(b, \"null\")\n".into();
            }
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                let inner = self.shape(&fs[0].ty, &params);
                let it = self.odin(&inner);
                if params.is_empty() {
                    let (d, e) = (self.dec(&inner), self.enc(&inner));
                    dec = format!("\treturn {d}(v, cast(^{it})out)\n");
                    enc = format!("\t{e}(b, cast({it})x)\n");
                } else {
                    dec = "\treturn decode(v, &out._0)\n".into();
                    enc = "\tencode(b, x._0)\n".into();
                }
            }
            Kind::Struct(Fields::Tuple(fs)) => {
                let mut d = format!("\tif v.kind != .Array || len(v.items) != {} do return fail(\"{name} tuple\")\n", fs.len());
                let mut e = "\tstrings.write_byte(b, '[')\n".to_string();
                for (i, f) in fs.iter().enumerate() {
                    let sh = self.shape(&f.ty, &params);
                    let (fd, fe) = (self.dec(&sh), self.enc(&sh));
                    let _ = writeln!(d, "\tif !{fd}(v.items[{i}], &out._{i}) do return fail(\"{name}._{i}\")");
                    if i > 0 {
                        e.push_str("\tstrings.write_byte(b, ',')\n");
                    }
                    let _ = writeln!(e, "\t{fe}(b, x._{i})");
                }
                d.push_str("\treturn true\n");
                e.push_str("\tstrings.write_byte(b, ']')\n");
                dec = d;
                enc = e;
            }
            Kind::Struct(Fields::Named(fs)) if serde.transparent => {
                let f = fs.iter().find(|f| !f.serde.skip).unwrap();
                let id = field_ident(f.name.as_ref().unwrap());
                let sh = self.shape(&f.ty, &params);
                let (d, e) = (self.dec(&sh), self.enc(&sh));
                dec = format!("\treturn {d}(v, &out.{id})\n");
                enc = format!("\t{e}(b, x.{id})\n");
            }
            Kind::Struct(Fields::Named(fs)) => {
                let body = self.decode_named_fields(fs, &params, rule.as_deref(), serde.default.is_some(), &name);
                dec = format!("\tif v.kind != .Object do return fail(\"{name}: not an object\")\n{body}\treturn true\n");
                let mut m = self.encode_named_fields(fs, &params, rule.as_deref(), "x");
                if self.computed.contains(&name) {
                    let _ = writeln!(m, "\tencode_{name}_computed(b, x, first)");
                }
                enc = format!("\tstrings.write_byte(b, '{{')\n\tf := true\n\tencode_{name}_members(b, x, &f)\n\tstrings.write_byte(b, '}}')\n");
                members = Some(m);
            }
            Kind::Enum(vs) if Self::is_unit_enum(def) => {
                let (d, e, m) = self.unit_enum_codec(def, vs);
                dec = d;
                enc = e;
                members = m;
            }
            Kind::Enum(vs) => {
                let (d, e, m) = self.data_enum_codec(def, vs, &params);
                dec = d;
                enc = e;
                members = m;
            }
        }
        if want_decode {
            let _ = writeln!(self.codec_out, "decode_{name} :: proc(v: json.Value, out: ^{ty}) -> bool {{\n{dec}}}\n");
        }
        if !want_encode {
            return;
        }
        let _ = writeln!(self.codec_out, "encode_{name} :: proc(b: ^strings.Builder, x: {ty}) {{\n{enc}}}\n");
        if let Some(m) = members {
            let used = if m.contains("x.") || m.contains("x)") || m.contains("(x") || m.contains(" x ") { "" } else { "\t_ = x\n" };
            let firstused = if m.contains("first") { "" } else { "\t_ = first\n" };
            let _ = writeln!(self.codec_out, "encode_{name}_members :: proc(b: ^strings.Builder, x: {ty}, first: ^bool) {{\n{used}{firstused}{m}}}\n");
        }
        let _ = ty_use;
    }

    fn tag_value(enum_serde: &Serde, v: &Variant) -> String {
        Self::variant_name(v, enum_serde)
    }

    fn unit_enum_codec(&mut self, def: &TypeDef, vs: &[Variant]) -> (String, String, Option<String>) {
        let name = &def.name;
        let s = &def.serde;
        // Decode the variant name from a string.
        let mut cases = String::new();
        let mut other = None;
        for v in vs {
            if v.serde.other {
                other = Some(v.name.clone());
            }
            let mut names = vec![Self::tag_value(s, v)];
            names.extend(v.serde.aliases.iter().cloned());
            let lits: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let _ = writeln!(cases, "\tcase {}: out^ = .{}", lits.join(", "), v.name);
        }
        let default_case = match other {
            Some(o) => format!("\tcase: out^ = .{o}\n"),
            None => format!("\tcase: return fail(\"{name}: unknown variant\")\n"),
        };
        let from_str = format!("\tswitch str {{\n{cases}{default_case}\t}}\n\treturn true\n");
        let mut names_tbl = String::new();
        for v in vs {
            let _ = writeln!(names_tbl, "\t\t.{} = \"{}\",", v.name, Self::tag_value(s, v));
        }
        let table = format!("\t@(static, rodata) NAMES := [{name}]string{{\n{names_tbl}\t}}\n");
        if let Some(tag) = &s.tag {
            // Internally (or adjacently) tagged, all unit: {"tag": "Variant"}.
            let dec = format!("\tif v.kind != .Object do return fail(\"{name}: not an object\")\n\ttv, found := json.get(v, \"{tag}\")\n\tif !found || tv.kind != .String do return fail(\"{name}: no tag\")\n\tstr := tv.text\n{from_str}");
            let enc = format!("\tstrings.write_byte(b, '{{')\n\tf := true\n\tencode_{name}_members(b, x, &f)\n\tstrings.write_byte(b, '}}')\n");
            let mem = format!("{table}\tmember(b, first, \"{tag}\"); json.write_string(b, NAMES[x])\n");
            return (dec, enc, Some(mem));
        }
        if s.untagged {
            return (format!("\t_ = out\n\treturn v.kind == .Null\n"), "\t_ = x\n\tstrings.write_string(b, \"null\")\n".into(), None);
        }
        let dec = format!("\tif v.kind != .String do return fail(\"{name}: not a string\")\n\tstr := v.text\n{from_str}");
        let enc = format!("{table}\tjson.write_string(b, NAMES[x])\n");
        (dec, enc, None)
    }

    fn data_enum_codec(&mut self, def: &TypeDef, vs: &[Variant], params: &[String]) -> (String, String, Option<String>) {
        let name = def.name.clone();
        let s = def.serde.clone();
        let generic_suffix = if params.is_empty() { String::new() } else { format!("({})", params.join(", ")) };
        let field_rule = s.rename_all_fields.clone();
        let mut dec = String::new();
        let mut enc = String::from("\t#partial switch y in x {\n");
        let mut mem = String::from("\t#partial switch y in x {\n");
        let internally = s.tag.is_some() && s.content.is_none();
        let adjacent = s.tag.is_some() && s.content.is_some();

        if s.untagged {
            dec.push_str("\t// untagged: the first variant that decodes wins, as in serde.\n");
            for v in vs {
                let vt = format!("{name}_{}{generic_suffix}", v.name);
                match &v.fields {
                    Fields::Unit => {
                        let _ = writeln!(dec, "\tif v.kind == .Null {{ out^ = {vt}{{}}; return true }}");
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; strings.write_string(b, \"null\")");
                    }
                    Fields::Tuple(fs) if fs.len() == 1 => {
                        let sh = self.shape(&fs[0].ty, params);
                        let (d, e) = (self.dec(&sh), self.enc(&sh));
                        let _ = writeln!(dec, "\t{{ tmp: {vt}; if decode_quiet_proc(v, &tmp._0, {d}) {{ out^ = tmp; return true }} }}");
                        let _ = writeln!(enc, "\tcase {vt}: {e}(b, y._0)");
                    }
                    Fields::Tuple(fs) => {
                        let _ = writeln!(dec, "\tif v.kind == .Array && len(v.items) == {} {{ tmp: {vt}; ok := true", fs.len());
                        let shapes: Vec<Shape> = fs.iter().map(|f| self.shape(&f.ty, params)).collect();
                        for (i, sh) in shapes.iter().enumerate() {
                            let d = self.dec(sh);
                            let _ = writeln!(dec, "\t\tok = ok && decode_quiet_proc(v.items[{i}], &tmp._{i}, {d})");
                        }
                        let _ = writeln!(dec, "\t\tif ok {{ out^ = tmp; return true }}\n\t}}");
                        let mut e = format!("\tcase {vt}: strings.write_byte(b, '[')");
                        for (i, sh) in shapes.iter().enumerate() {
                            if i > 0 {
                                e.push_str("; strings.write_byte(b, ',')");
                            }
                            let en = self.enc(sh);
                            let _ = write!(e, "; {en}(b, y._{i})");
                        }
                        e.push_str("; strings.write_byte(b, ']')\n");
                        enc.push_str(&e);
                    }
                    Fields::Named(fs) => {
                        let rule = v.serde.rename_all.clone().or(field_rule.clone());
                        let body = self.decode_named_fields(fs, params, rule.as_deref(), false, &format!("{name}::{}", v.name));
                        let _ = writeln!(dec, "\tif v.kind == .Object {{ tmp: {vt}; if decode_quiet_proc(v, &tmp, proc(v: json.Value, out: ^{vt}) -> bool {{\n{body}\treturn true\n\t}}) {{ out^ = tmp; return true }} }}");
                        let m = self.encode_named_fields(fs, params, rule.as_deref(), "y");
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}:\n{m}");
                    }
                }
            }
            let _ = writeln!(dec, "\treturn fail(\"{name}: no untagged variant matched\")");
            enc.push_str("\t}\n");
            mem.push_str("\t}\n");
            let all_named = vs.iter().all(|v| matches!(v.fields, Fields::Named(_)));
            return (dec, enc, if all_named { Some(mem) } else { None });
        }

        // The variant name: externally tagged reads it from the object's only key or a bare string; internally and
        // adjacently tagged from the tag member.
        if internally || adjacent {
            let tag = s.tag.clone().unwrap();
            let _ = writeln!(dec, "\tif v.kind != .Object do return fail(\"{name}: not an object\")\n\ttv, found := json.get(v, \"{tag}\")\n\tif !found || tv.kind != .String do return fail(\"{name}: no tag\")\n\tswitch tv.text {{");
        } else {
            dec.push_str("\tvariant: string\n\tbody: json.Value\n\t#partial switch v.kind {\n\tcase .String: variant = v.text\n\tcase .Object:\n\t\tif len(v.members) != 1 do return fail(\"");
            let _ = write!(dec, "{name}: externally tagged object needs one key\")\n\t\tvariant, body = v.members[0].key, v.members[0].value\n\tcase: return fail(\"{name}: not a string or object\")\n\t}}\n\tswitch variant {{\n");
        }
        let mut other_variant = None;
        for v in vs {
            if v.serde.skip || v.serde.skip_deserializing && v.serde.skip_serializing {
                continue;
            }
            if v.serde.other {
                other_variant = Some(v.name.clone());
            }
            let vt = format!("{name}_{}{generic_suffix}", v.name);
            let mut names = vec![Self::tag_value(&s, v)];
            names.extend(v.serde.aliases.iter().cloned());
            let lits: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let vname = Self::tag_value(&s, v);
            let ctx = format!("{name}::{}", v.name);
            let rule = v.serde.rename_all.clone().or(field_rule.clone());
            // Where the variant's data is: externally tagged `body`, adjacently the content member, internally the
            // object itself.
            let data_expr = if internally {
                "v".to_string()
            } else if adjacent {
                let content = s.content.clone().unwrap();
                format!("json.get_or_null(v, \"{content}\")")
            } else {
                "body".to_string()
            };
            match &v.fields {
                Fields::Unit => {
                    let _ = writeln!(dec, "\tcase {}: out^ = {vt}{{}}", lits.join(", "));
                    if internally || adjacent {
                        let tag = s.tag.clone().unwrap();
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: _ = y; member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; json.write_string(b, \"{vname}\")");
                    }
                }
                Fields::Tuple(fs) if fs.len() == 1 => {
                    let sh = self.shape(&fs[0].ty, params);
                    let (d, e) = (self.dec(&sh), self.enc(&sh));
                    let _ = writeln!(dec, "\tcase {}: tmp: {vt}; if !{d}({data_expr}, &tmp._0) do return fail(\"{ctx}\"); out^ = tmp", lits.join(", "));
                    // The payload's own serde container attributes (an enum written as a string, or tagged).
                    let inner_def = match &sh { Shape::Named(n, a) if a.is_empty() => self.def(n), _ => None };
                    let inner_tag = inner_def.and_then(|d| d.serde.tag.clone());
                    let unit_payload = inner_def.is_some_and(|d| d.serde.tag.is_none() && !d.serde.untagged
                        && matches!(&d.kind, Kind::Enum(pv) if pv.iter().all(|x| matches!(x.fields, Fields::Unit))));
                    if internally && inner_tag.is_some() && inner_tag == s.tag {
                        // An internally tagged payload with the same tag key: serde writes the key twice
                        // ({"type": "Modification", "type": "Increase"}); the payload reads the second.
                        let tag = s.tag.clone().unwrap();
                        dec = dec.replace(&format!("\tcase {}: tmp: {vt}; if !{d}({data_expr}, &tmp._0) do return fail(\"{ctx}\"); out^ = tmp\n", lits.join(", ")),
                            &format!("\tcase {}: tmp: {vt}; if !{d}(json.without_first(v, \"{tag}\"), &tmp._0) do return fail(\"{ctx}\"); out^ = tmp\n", lits.join(", ")));
                        let m = self.mem(&sh);
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); {m}(b, y._0, &f); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\"); {m}(b, y._0, first)");
                    } else if internally && unit_payload {
                        // serde's tagged serializer writes a unit-enum payload as one more member, `"Inner": null`
                        // ({"type": "Destination", "Hand": null}); reading takes the member that isn't the tag.
                        let tag = s.tag.clone().unwrap();
                        let pd = self.dec(&sh);
                        dec = dec.replace(&format!("\tcase {}: tmp: {vt}; if !{d}({data_expr}, &tmp._0) do return fail(\"{ctx}\"); out^ = tmp\n", lits.join(", ")),
                            &format!("\tcase {}: tmp: {vt}; if !{pd}(json.Value{{kind = .String, text = other_member_key(v, \"{tag}\")}}, &tmp._0) do return fail(\"{ctx}\"); out^ = tmp\n", lits.join(", ")));
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member_json_key(b, &f, y._0, {e}); strings.write_string(b, \"null\"); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\"); member_json_key(b, first, y._0, {e}); strings.write_string(b, \"null\")");
                    } else if internally {
                        // The newtype's members are merged with the tag.
                        let tag = s.tag.clone().unwrap();
                        let m = self.mem(&sh);
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); {m}(b, y._0, &f); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\"); {m}(b, y._0, first)");
                    } else if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); {e}(b, y._0); strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); {e}(b, y._0); strings.write_byte(b, '}}')");
                    }
                }
                Fields::Tuple(fs) => {
                    let _ = writeln!(dec, "\tcase {}:\n\t\tdata := {data_expr}\n\t\tif data.kind != .Array || len(data.items) != {} do return fail(\"{ctx}\")\n\t\ttmp: {vt}", lits.join(", "), fs.len());
                    let shapes: Vec<Shape> = fs.iter().map(|f| self.shape(&f.ty, params)).collect();
                    for (i, sh) in shapes.iter().enumerate() {
                        let d = self.dec(sh);
                        let _ = writeln!(dec, "\t\tif !{d}(data.items[{i}], &tmp._{i}) do return fail(\"{ctx}._{i}\")");
                    }
                    dec.push_str("\t\tout^ = tmp\n");
                    let mut arr = String::from("strings.write_byte(b, '[')");
                    for (i, sh) in shapes.iter().enumerate() {
                        if i > 0 {
                            arr.push_str("; strings.write_byte(b, ',')");
                        }
                        let en = self.enc(sh);
                        let _ = write!(arr, "; {en}(b, y._{i})");
                    }
                    arr.push_str("; strings.write_byte(b, ']')");
                    if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); {arr}; strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); {arr}; strings.write_byte(b, '}}')");
                    }
                }
                Fields::Named(fs) => {
                    let body = self.decode_named_fields(fs, params, rule.as_deref(), false, &ctx);
                    let _ = writeln!(dec, "\tcase {}:\n\t\ttmp: {vt}\n\t\tif !decode_variant({data_expr}, &tmp, proc(v: json.Value, out: ^{vt}) -> bool {{\n{body}\treturn true\n\t\t}}) {{ return fail(\"{ctx}\") }}\n\t\tout^ = tmp", lits.join(", "));
                    let m = self.encode_named_fields(fs, params, rule.as_deref(), "y");
                    if internally {
                        let tag = s.tag.clone().unwrap();
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); {{ fst := true; first := &fst; member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")\n{m}\t}}; strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")\n{m}");
                    } else if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}'); strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}'); strings.write_byte(b, '}}')");
                    }
                }
            }
        }
        match other_variant {
            Some(o) => {
                let _ = writeln!(dec, "\tcase: out^ = {name}_{o}{generic_suffix}{{}}");
            }
            None => {
                let _ = writeln!(dec, "\tcase: return fail(\"{name}: unknown variant\")");
            }
        }
        dec.push_str("\t}\n\treturn true\n");
        enc.push_str("\t}\n");
        mem.push_str("\t}\n");
        let members = if internally { Some(mem) } else { None };
        (dec, enc, members)
    }
}

/// The model type names a shape mentions.
fn shape_names(s: &Shape, out: &mut Vec<String>) {
    match s {
        Shape::Option(i) | Shape::OptPtr(i, _) | Shape::Ptr(i, _) | Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _) | Shape::MutRef(i) => shape_names(i, out),
        Shape::Result(t, e) => {
            shape_names(t, out);
            shape_names(e, out);
        }
        Shape::Map(k, v) => {
            shape_names(k, out);
            shape_names(v, out);
        }
        Shape::Tuple(es) => es.iter().for_each(|e| shape_names(e, out)),
        Shape::Named(n, a) => {
            out.push(n.clone());
            a.iter().for_each(|e| shape_names(e, out));
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------------------------------- clones ---
// Rust's `Clone`, generated for every model type, with Rust's sharing: an `Arc` is shared (its count goes up; a
// write copies it first, `make_mut`), everything else is copied deeply. Strings and JSON trees are immutable once
// built, so they are shared too. docs/odin-port.md, "State layout".
impl<'a> Emitter<'a> {
    /// Whether copying the value is a full clone (no owned allocations inside).
    fn plain(&mut self, s: &Shape) -> bool {
        match s {
            Shape::Bool | Shape::Int(_) | Shape::Float(_) | Shape::Str | Shape::Char | Shape::Unit | Shape::Json
            | Shape::Extern(_) | Shape::Unknown(_) | Shape::Param(_) | Shape::MutRef(_) => true,
            Shape::Option(i) | Shape::Array(i, _) => self.plain(i),
            Shape::Tuple(es) => es.clone().iter().all(|e| self.plain(e)),
            Shape::Vec(_) | Shape::PVec(_) | Shape::Map(..) | Shape::Ptr(..) | Shape::OptPtr(..) => false,
            Shape::Result(t, e) => {
                let (t, e) = (t.clone(), e.clone());
                self.plain(&t) && self.plain(&e)
            }
            Shape::Named(..) => {
                let ty = self.odin(s);
                if let Some(p) = self.plain_memo.get(&ty) {
                    return *p;
                }
                // Recursive types hold pointers, so they are never plain; assume not while computing.
                self.plain_memo.insert(ty.clone(), false);
                let p = self.named_plain(s);
                self.plain_memo.insert(ty, p);
                p
            }
        }
    }

    fn named_plain(&mut self, s: &Shape) -> bool {
        let Shape::Named(n, args) = s else { return true };
        let Some(def) = self.def(n).cloned() else { return true };
        let saved = self.subst.clone();
        if !args.is_empty() {
            self.subst = def.generics.iter().cloned().zip(args.iter().cloned()).collect();
        }
        let mut shapes = Vec::new();
        let mut collect = |e: &mut Self, fs: &Fields| {
            if let Fields::Named(v) | Fields::Tuple(v) = fs {
                for f in v {
                    shapes.push(e.shape(&f.ty, &def.generics));
                }
            }
        };
        match &def.kind {
            Kind::Struct(fs) => collect(self, fs),
            Kind::Enum(vs) => {
                for v in vs {
                    collect(self, &v.fields);
                }
            }
        }
        self.subst = saved;
        shapes.iter().all(|x| self.plain(x))
    }

    /// The procedure that clones a value of this shape, or None when a copy is the clone.
    pub fn cloner(&mut self, s: &Shape) -> Option<String> {
        if self.plain(s) {
            return None;
        }
        if let Shape::PVec(i) = s {
            // Shares every chunk; elements are cloned only when a chunk is written (pvec_mut, pvec_push).
            let _ = self.cloner(i);
            return Some("pvec_clone".into());
        }
        let ty = self.odin(s);
        let shared = matches!(s, Shape::Ptr(_, true) | Shape::OptPtr(_, true));
        let key = if shared { format!("{ty}#shared") } else { ty.clone() };
        if let Some(n) = self.clone_names.get(&key) {
            return Some(n.clone());
        }
        let name = match s {
            Shape::Named(n, a) if a.is_empty() => format!("clone_{n}"),
            _ => {
                let m = if shared { mangle(&ty).replacen("ptr_", "shared_", 1) } else { mangle(&ty) };
                format!("cln_{m}")
            }
        };
        self.clone_names.insert(key, name.clone());
        if let Shape::Named(..) = s {
            return Some(name); // emitted with its type (emit_clone)
        }
        let body = match s {
            Shape::Option(i) => {
                let c = self.cloner(i).unwrap();
                "\tif y, ok := x.?; ok do return {c}(y)\n\treturn nil\n".replace("{c}", &c)
            }
            Shape::Ptr(_, true) | Shape::OptPtr(_, true) => "\tshared_retain(x)\n\treturn x\n".to_string(),
            Shape::Ptr(i, false) | Shape::OptPtr(i, false) => {
                let it = self.odin(i);
                let copy = match self.cloner(i) {
                    Some(c) => format!("{c}(x^)"),
                    None => "x^".to_string(),
                };
                format!("\tif x == nil do return nil\n\tp := new({it})\n\tp^ = {copy}\n\treturn p\n")
            }
            Shape::Vec(i) | Shape::Array(i, _) => {
                let is_vec = matches!(s, Shape::Vec(_));
                match (self.cloner(i), is_vec) {
                    (None, true) => format!("\tout := make({ty}, len(x))\n\tcopy(out[:], x[:])\n\treturn out\n"),
                    (Some(c), true) => format!("\tout := make({ty}, len(x))\n\tfor item, i in x do out[i] = {c}(item)\n\treturn out\n"),
                    (Some(c), false) => format!("\tout := x\n\tfor item, i in x do out[i] = {c}(item)\n\treturn out\n"),
                    (None, false) => "\treturn x\n".to_string(),
                }
            }
            Shape::Map(k, v) => {
                if ty.starts_with("map[") {
                    let vc = self.cloner(v).map(|c| format!("{c}(val)")).unwrap_or_else(|| "val".into());
                    let kc = self.cloner(k).map(|c| format!("{c}(key)")).unwrap_or_else(|| "key".into());
                    format!("\tout := make({ty}, len(x))\n\tfor key, val in x do out[{kc}] = {vc}\n\treturn out\n")
                } else {
                    // Pairs: [dynamic]Tuple2(K, V).
                    let pair = Shape::Tuple(vec![(**k).clone(), (**v).clone()]);
                    match self.cloner(&pair) {
                        Some(c) => format!("\tout := make({ty}, len(x))\n\tfor item, i in x do out[i] = {c}(item)\n\treturn out\n"),
                        None => format!("\tout := make({ty}, len(x))\n\tcopy(out[:], x[:])\n\treturn out\n"),
                    }
                }
            }
            Shape::Result(t, er) => {
                let (t, er) = (t.clone(), er.clone());
                let mut b = "\tout := x\n".to_string();
                if let Some(c) = self.cloner(&t) {
                    b.push_str(&format!("\tout.ok = {c}(x.ok)\n"));
                }
                if let Some(c) = self.cloner(&er) {
                    b.push_str(&format!("\tif e, failed := x.err.?; failed do out.err = {c}(e)\n"));
                }
                b.push_str("\treturn out\n");
                b
            }
            Shape::Tuple(es) => {
                let mut b = "\tout := x\n".to_string();
                for (i, e) in es.clone().iter().enumerate() {
                    if let Some(c) = self.cloner(e) {
                        b.push_str(&format!("\tout._{i} = {c}(x._{i})\n"));
                    }
                }
                b.push_str("\treturn out\n");
                b
            }
            _ => return None,
        };
        let _ = writeln!(self.clone_out, "{name} :: proc(x: {ty}) -> {ty} {{\n{body}}}\n");
        Some(name)
    }

    /// `clone_<T>` for a model type: copy, then clone each field that owns something.
    fn emit_clone(&mut self, def: &TypeDef) {
        if !def.generics.is_empty() {
            return; // only monomorphized instances are used
        }
        let name = def.name.clone();
        let shape = Shape::Named(name.clone(), vec![]);
        if self.plain(&shape) {
            return;
        }
        self.clone_names.insert(name.clone(), format!("clone_{name}"));
        let params = def.generics.clone();
        let mut body = String::new();
        let field_lines = |e: &mut Self, fs: &Fields, src: &str, dst: &str| -> String {
            let mut out = String::new();
            match fs {
                Fields::Named(v) => {
                    for f in v {
                        let sh = e.shape(&f.ty, &params);
                        if let Some(c) = e.cloner(&sh) {
                            let id = field_ident(f.name.as_ref().unwrap());
                            out.push_str(&format!("\t{dst}.{id} = {c}({src}.{id})\n"));
                        }
                    }
                }
                Fields::Tuple(v) => {
                    for (i, f) in v.iter().enumerate() {
                        let sh = e.shape(&f.ty, &params);
                        if let Some(c) = e.cloner(&sh) {
                            out.push_str(&format!("\t{dst}._{i} = {c}({src}._{i})\n"));
                        }
                    }
                }
                Fields::Unit => {}
            }
            out
        };
        match &def.kind {
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                // A newtype is a `distinct` of its inner type.
                let inner = self.shape(&fs[0].ty, &params);
                let it = self.odin(&inner);
                let c = self.cloner(&inner).unwrap();
                body.push_str(&format!("\treturn cast({name}){c}(cast({it})x)\n"));
            }
            Kind::Struct(fs) => {
                body.push_str("\tout := x\n");
                body.push_str(&field_lines(self, fs, "x", "out"));
                body.push_str("\treturn out\n");
            }
            Kind::Enum(vs) => {
                if vs.iter().all(|v| matches!(v.fields, Fields::Unit)) {
                    return;
                }
                body.push_str("\t#partial switch y in x {\n");
                for v in vs {
                    let lines = field_lines(self, &v.fields, "y", "v");
                    if !lines.is_empty() {
                        body.push_str(&format!("\tcase {name}_{}:\n\t\tv := y\n{}\t\treturn v\n", v.name, lines.replace("\n\t", "\n\t\t").replacen('\t', "\t\t", 1)));
                    }
                }
                body.push_str("\t}\n\treturn x\n");
            }
        }
        let _ = writeln!(self.clone_out, "clone_{name} :: proc(x: {name}) -> {name} {{\n{body}}}\n");
    }
}

// ----------------------------------------------------------------------------------------------------- drops ---
// Rust's Drop, as far as sharing goes: `drop_<T>` gives back the counts a value holds. A shared pointer's count goes
// down, and when it reaches zero what it points at is dropped in turn (it held counts too); owned parts are walked.
// Memory itself belongs to the arena it came from (docs/odin-port.md, "State layout"), so nothing is freed here.
// Translated code drops a value that dies at scope end, as Rust would (never one moved elsewhere: that would
// under-count and let a write reach shared data). Without a drop a count stays high, which only costs a copy.
impl<'a> Emitter<'a> {
    /// The procedure that drops a value of this shape, or None when it holds no counts.
    pub fn dropper(&mut self, s: &Shape) -> Option<String> {
        if self.plain(s) {
            return None;
        }
        if let Shape::PVec(i) = s {
            let d = self.dropper(i).unwrap_or_else(|| "nil".into());
            let ty = self.odin(s);
            let name = format!("drp_{}", mangle(&ty));
            if !self.drop_names.contains_key(&ty) {
                self.drop_names.insert(ty.clone(), Some(name.clone()));
                let _ = writeln!(self.clone_out, "{name} :: proc(x: {ty}) {{\n\tpvec_drop(x, {d})\n}}\n");
            }
            return Some(name);
        }
        let ty = self.odin(s);
        let shared = matches!(s, Shape::Ptr(_, true) | Shape::OptPtr(_, true));
        let key = if shared { format!("{ty}#shared") } else { ty.clone() };
        if let Some(n) = self.drop_names.get(&key) {
            return n.clone();
        }
        if let Shape::Named(n, a) = s {
            if a.is_empty() {
                // Emitted with its type (emit_drop); a type with no counts inside gets no procedure.
                let name = self.named_holds_counts(s).then(|| format!("drop_{n}"));
                self.drop_names.insert(key, name.clone());
                return name;
            }
        }
        let m = if shared { mangle(&ty).replacen("ptr_", "shared_", 1) } else { mangle(&ty) };
        let name = format!("drp_{m}");
        // Reserved first: recursive shapes refer to themselves.
        self.drop_names.insert(key.clone(), Some(name.clone()));
        let body = match s {
            Shape::Option(i) => match self.dropper(i) {
                Some(d) => format!("\tif y, ok := x.?; ok do {d}(y)\n"),
                None => String::new(),
            },
            Shape::Ptr(i, true) | Shape::OptPtr(i, true) => {
                let then = match self.dropper(i) {
                    Some(d) => format!("\tif c^ == 0 do {d}(x^)\n"),
                    None => String::new(),
                };
                format!("\tif x == nil do return\n\tc := shared_count(x)\n\tc^ -= 1\n{then}")
            }
            Shape::Ptr(i, false) | Shape::OptPtr(i, false) => match self.dropper(i) {
                Some(d) => format!("\tif x != nil do {d}(x^)\n"),
                None => String::new(),
            },
            Shape::Vec(i) | Shape::Array(i, _) => match self.dropper(i) {
                Some(d) => format!("\tfor item in x do {d}(item)\n"),
                None => String::new(),
            },
            Shape::Map(k, v) => {
                if ty.starts_with("map[") {
                    let (dk, dv) = (self.dropper(k), self.dropper(v));
                    let mut b = String::new();
                    if let Some(d) = dk {
                        b.push_str(&format!("\t\t{d}(key)\n"));
                    }
                    if let Some(d) = dv {
                        b.push_str(&format!("\t\t{d}(val)\n"));
                    }
                    if b.is_empty() { b } else { format!("\tfor key, val in x {{\n{b}\t}}\n") }
                } else {
                    let pair = Shape::Tuple(vec![(**k).clone(), (**v).clone()]);
                    match self.dropper(&pair) {
                        Some(d) => format!("\tfor item in x do {d}(item)\n"),
                        None => String::new(),
                    }
                }
            }
            Shape::Result(t, er) => {
                let (t, er) = (t.clone(), er.clone());
                let mut b = String::new();
                if let Some(d) = self.dropper(&t) {
                    b.push_str(&format!("\t{d}(x.ok)\n"));
                }
                if let Some(d) = self.dropper(&er) {
                    b.push_str(&format!("\tif e, failed := x.err.?; failed do {d}(e)\n"));
                }
                b
            }
            Shape::Tuple(es) => {
                let mut b = String::new();
                for (i, e) in es.clone().iter().enumerate() {
                    if let Some(d) = self.dropper(e) {
                        b.push_str(&format!("\t{d}(x._{i})\n"));
                    }
                }
                b
            }
            _ => String::new(),
        };
        if body.is_empty() {
            self.drop_names.insert(key, None);
            return None;
        }
        let _ = writeln!(self.clone_out, "{name} :: proc(x: {ty}) {{\n{body}}}\n");
        Some(name)
    }

    /// Whether a named type holds a count anywhere inside (a shared pointer, a PVec, a hand type), so its drop does
    /// something. Owned-only types (a Box of plain data) need no drop. Recursive types make this a fixpoint: the
    /// named types reachable from `s` are gathered, then marked from the ones holding a count directly.
    fn named_holds_counts(&mut self, s: &Shape) -> bool {
        let ty = self.odin(s);
        if let Some(p) = self.counts_memo.get(&ty) {
            return *p;
        }
        let mut nodes: BTreeMap<String, (bool, Vec<String>)> = BTreeMap::new();
        let mut stack = vec![s.clone()];
        while let Some(x) = stack.pop() {
            let t = self.odin(&x);
            if self.counts_memo.contains_key(&t) || nodes.contains_key(&t) {
                continue;
            }
            let mut direct = false;
            let mut succ = Vec::new();
            if let Shape::Named(n, _) = &x {
                if self.hand_types.contains(n) {
                    direct = true;
                } else {
                    for f in self.named_field_shapes(&x) {
                        self.scan_counts(&f, &mut direct, &mut succ);
                    }
                }
            }
            let names: Vec<String> = succ.iter().map(|y| self.odin(y)).collect();
            nodes.insert(t, (direct, names));
            stack.extend(succ);
        }
        let mut holds: BTreeSet<String> = nodes.iter().filter(|(_, (d, _))| *d).map(|(n, _)| n.clone()).collect();
        loop {
            let mut changed = false;
            for (n, (_, succ)) in &nodes {
                if !holds.contains(n) && succ.iter().any(|y| holds.contains(y) || self.counts_memo.get(y) == Some(&true)) {
                    holds.insert(n.clone());
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for n in nodes.keys() {
            self.counts_memo.insert(n.clone(), holds.contains(n));
        }
        self.counts_memo[&ty]
    }

    /// The shapes of a named type's fields (every variant's, for an enum).
    fn named_field_shapes(&mut self, s: &Shape) -> Vec<Shape> {
        let Shape::Named(n, args) = s else { return vec![] };
        let (def, sub) = match self.def(n) {
            Some(d) => (d.clone(), None),
            None => match self.instances.get(n).cloned() {
                Some((base, a)) => match self.def(&base) {
                    Some(d) => {
                        let d = d.clone();
                        let sub: BTreeMap<String, Shape> = d.generics.iter().cloned().zip(a).collect();
                        (d, Some(sub))
                    }
                    None => return vec![],
                },
                None => return vec![],
            },
        };
        // Only answers a question: the types it touches mustn't join the emission queue early (that would reorder
        // the generated files).
        let saved_queue = self.queue.clone();
        let saved = self.subst.clone();
        if let Some(sub) = sub {
            self.subst = sub;
        } else if !args.is_empty() {
            self.subst = def.generics.iter().cloned().zip(args.iter().cloned()).collect();
        }
        let mut shapes = Vec::new();
        let mut collect = |e: &mut Self, fs: &Fields| {
            if let Fields::Named(v) | Fields::Tuple(v) = fs {
                for f in v {
                    shapes.push(e.shape(&f.ty, &def.generics));
                }
            }
        };
        match &def.kind {
            Kind::Struct(fs) => collect(self, fs),
            Kind::Enum(vs) => {
                for v in vs {
                    collect(self, &v.fields);
                }
            }
        }
        self.subst = saved;
        self.queue = saved_queue;
        shapes
    }

    /// Walks a field's shape: a count held directly sets `direct`; named types inside go to `succ`.
    fn scan_counts(&mut self, s: &Shape, direct: &mut bool, succ: &mut Vec<Shape>) {
        match s {
            Shape::Ptr(_, true) | Shape::OptPtr(_, true) | Shape::PVec(_) => *direct = true,
            Shape::Option(i) | Shape::Array(i, _) | Shape::Vec(i) | Shape::Ptr(i, false) | Shape::OptPtr(i, false) => {
                self.scan_counts(i, direct, succ)
            }
            Shape::Map(k, v) => {
                self.scan_counts(k, direct, succ);
                self.scan_counts(v, direct, succ);
            }
            Shape::Tuple(es) => es.iter().for_each(|e| self.scan_counts(e, direct, succ)),
            Shape::Result(t, e) => {
                self.scan_counts(t, direct, succ);
                self.scan_counts(e, direct, succ);
            }
            Shape::Named(..) => succ.push(s.clone()),
            _ => {}
        }
    }

    /// `drop_<T>` for a model type that holds counts: drop each field that does.
    fn emit_drop(&mut self, def: &TypeDef) {
        if !def.generics.is_empty() {
            return;
        }
        let name = def.name.clone();
        let shape = Shape::Named(name.clone(), vec![]);
        if self.plain(&shape) || !self.named_holds_counts(&shape) {
            return;
        }
        let field_lines = |e: &mut Self, fs: &Fields, src: &str| -> String {
            let mut out = String::new();
            match fs {
                Fields::Named(v) => {
                    for f in v {
                        let sh = e.shape(&f.ty, &[]);
                        if let Some(d) = e.dropper(&sh) {
                            out.push_str(&format!("\t{d}({src}.{})\n", field_ident(f.name.as_ref().unwrap())));
                        }
                    }
                }
                Fields::Tuple(v) => {
                    for (i, f) in v.iter().enumerate() {
                        let sh = e.shape(&f.ty, &[]);
                        if let Some(d) = e.dropper(&sh) {
                            out.push_str(&format!("\t{d}({src}._{i})\n"));
                        }
                    }
                }
                Fields::Unit => {}
            }
            out
        };
        let mut body = String::new();
        match &def.kind {
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                let inner = self.shape(&fs[0].ty, &[]);
                let it = self.odin(&inner);
                if let Some(d) = self.dropper(&inner) {
                    body.push_str(&format!("\t{d}(cast({it})x)\n"));
                }
            }
            Kind::Struct(fs) => body.push_str(&field_lines(self, fs, "x")),
            Kind::Enum(vs) => {
                let mut cases = String::new();
                for v in vs {
                    let lines = field_lines(self, &v.fields, "y");
                    if !lines.is_empty() {
                        cases.push_str(&format!("\tcase {name}_{}:\n{}", v.name, lines.replace('\t', "\t\t")));
                    }
                }
                if !cases.is_empty() {
                    body.push_str(&format!("\t#partial switch y in x {{\n{cases}\t}}\n"));
                }
            }
        }
        let _ = writeln!(self.clone_out, "drop_{name} :: proc(x: {name}) {{\n{body}}}\n");
    }
}

pub fn shape_names_pub(s: &Shape, out: &mut Vec<String>) {
    shape_names(s, out)
}

/// The `Item` of an `Iterator`-like bound (`Iterator<Item = T>`, `IntoIterator<Item = T>`, ...).
fn iterator_item<'t>(bounds: impl Iterator<Item = &'t syn::TypeParamBound>) -> Option<Type> {
    for b in bounds {
        let syn::TypeParamBound::Trait(t) = b else { continue };
        let seg = t.path.segments.last()?;
        if !matches!(seg.ident.to_string().as_str(), "Iterator" | "IntoIterator" | "DoubleEndedIterator" | "ExactSizeIterator") {
            continue;
        }
        if let syn::PathArguments::AngleBracketed(a) = &seg.arguments {
            for arg in &a.args {
                if let syn::GenericArgument::AssocType(at) = arg {
                    if at.ident == "Item" {
                        return Some(at.ty.clone());
                    }
                }
            }
        }
    }
    None
}

impl Emitter<'_> {
    /// Equality as Rust's derived PartialEq has it: None when Odin's `==` is that already, Some(procedure) for a
    /// generated `eq_*`, Err when it can't be (a hand-written PartialEq, a type outside the model, a generic).
    pub fn equaler(&mut self, s: &Shape) -> Result<Option<String>, String> {
        match s {
            Shape::Bool | Shape::Int(_) | Shape::Float(_) | Shape::Str | Shape::Char | Shape::Unit => return Ok(None),
            Shape::Json | Shape::Extern(_) | Shape::Unknown(_) | Shape::Param(_) | Shape::MutRef(_) => {
                return Err(format!("equality of a type outside the model ({})", format!("{s:?}").chars().take(40).collect::<String>()))
            }
            _ => {}
        }
        let ty = self.odin(s);
        if let Some(r) = self.eq_names.get(&ty) {
            return r.clone();
        }
        // Recursive types refer to themselves: the name is reserved first.
        let name = match s {
            Shape::Named(n, a) if a.is_empty() => format!("eq_{n}"),
            Shape::Named(..) => return Err("equality of a generic type".into()),
            _ => format!("eqs_{}", mangle(&ty)),
        };
        self.eq_names.insert(ty.clone(), Ok(Some(name.clone())));
        let body = match self.eq_body(s, &ty) {
            Ok(Some(b)) => b,
            Ok(None) => {
                self.eq_names.insert(ty, Ok(None));
                return Ok(None);
            }
            Err(e) => {
                self.eq_names.insert(ty, Err(e.clone()));
                return Err(e);
            }
        };
        let _ = writeln!(self.eq_out, "{name} :: proc(a, b: {ty}) -> bool {{\n{body}}}\n");
        Ok(Some(name))
    }

    /// `x == y` for two Odin expressions of a shape.
    fn eq_expr(&mut self, s: &Shape, x: &str, y: &str) -> Result<String, String> {
        Ok(match self.equaler(s)? {
            None => format!("{x} == {y}"),
            Some(p) => format!("{p}({x}, {y})"),
        })
    }

    fn eq_body(&mut self, s: &Shape, ty: &str) -> Result<Option<String>, String> {
        Ok(Some(match s {
            Shape::Option(i) => {
                let e = self.eq_expr(i, "x", "y")?;
                format!("\tx, xok := a.?\n\ty, yok := b.?\n\tif xok != yok do return false\n\treturn !xok || {e}\n")
            }
            // Rust compares a Box's or Arc's contents.
            Shape::Ptr(i, _) | Shape::OptPtr(i, _) => {
                let e = self.eq_expr(i, "a^", "b^")?;
                format!("\tif a == nil || b == nil do return a == b\n\treturn {e}\n")
            }
            Shape::Vec(i) | Shape::Array(i, _) => {
                let e = self.eq_expr(i, "a[k]", "b[k]")?;
                format!("\tif len(a) != len(b) do return false\n\tfor k in 0 ..< len(a) do if !({e}) do return false\n\treturn true\n")
            }
            Shape::PVec(i) => {
                let e = self.eq_expr(i, "pvec_get(a, k)", "pvec_get(b, k)")?;
                format!("\tif a.len != b.len do return false\n\tfor k in 0 ..< a.len do if !({e}) do return false\n\treturn true\n")
            }
            Shape::Map(_, v) if ty.starts_with("map[") || ty.starts_with("^map[") => {
                let deref = if ty.starts_with('^') { "^" } else { "" };
                let e = self.eq_expr(v, "va", "vb")?;
                let nil = if deref.is_empty() { String::new() } else { "\tif a == nil || b == nil do return (a == nil || len(a^) == 0) && (b == nil || len(b^) == 0)\n".to_string() };
                format!("{nil}\tif len(a{deref}) != len(b{deref}) do return false\n\tfor k, va in a{deref} {{\n\t\tvb, ok := b{deref}[k]\n\t\tif !ok || !({e}) do return false\n\t}}\n\treturn true\n")
            }
            Shape::Map(..) => return Err("equality of an ordered map".into()),
            Shape::Tuple(es) => {
                let mut parts = Vec::new();
                for (i, e) in es.clone().iter().enumerate() {
                    parts.push(self.eq_expr(e, &format!("a._{i}"), &format!("b._{i}"))?);
                }
                format!("\treturn {}\n", if parts.is_empty() { "true".into() } else { parts.join(" && ") })
            }
            Shape::Result(t, er) => {
                let (t, er) = ((**t).clone(), (**er).clone());
                let ok = self.eq_expr(&t, "a.ok", "b.ok")?;
                let err = self.eq_expr(&er, "x", "y")?;
                format!("\tx, xf := a.err.?\n\ty, yf := b.err.?\n\tif xf != yf do return false\n\tif xf do return {err}\n\treturn {ok}\n")
            }
            Shape::Named(n, _) => {
                let n = n.clone();
                // A monomorphized instance (`Definitions_TriggerDefinition`): its base's definition, with the instance's
                // arguments for the base's parameters while its fields' shapes are worked out.
                let (def, inst_subst) = match self.def(&n) {
                    Some(d) => (d.clone(), None),
                    None => {
                        let (base, args) = self.instances.get(&n).cloned().ok_or_else(|| format!("equality of a type without a definition ({n})"))?;
                        let d = self.def(&base).ok_or_else(|| format!("equality of a type without a definition ({base})"))?.clone();
                        let sub: BTreeMap<String, Shape> = d.generics.iter().cloned().zip(args).collect();
                        (d, Some(sub))
                    }
                };
                if !def.derives.iter().any(|d| d == "PartialEq") {
                    return Err(format!("{n} has a hand-written PartialEq"));
                }
                if !def.generics.is_empty() && inst_subst.is_none() {
                    return Err("equality of a generic type".into());
                }
                let saved_subst = self.subst.clone();
                if let Some(sub) = &inst_subst {
                    self.subst.extend(sub.clone());
                }
                let r = self.eq_named(&n, &def);
                self.subst = saved_subst;
                return r.map(Some);
            }
            _ => return Err("equality of this shape".into()),
        }))
    }

    fn eq_named(&mut self, n: &str, def: &TypeDef) -> Result<String, String> {
                let n = n.to_string();
                let fields_eq = |e: &mut Self, fs: &Fields, x: &str, y: &str| -> Result<Vec<String>, String> {
                    let mut out = Vec::new();
                    match fs {
                        Fields::Named(v) => {
                            for f in v {
                                let sh = e.shape(&f.ty, &[]);
                                let id = field_ident(f.name.as_ref().unwrap());
                                out.push(e.eq_expr(&sh, &format!("{x}.{id}"), &format!("{y}.{id}"))?);
                            }
                        }
                        Fields::Tuple(v) => {
                            for (i, f) in v.iter().enumerate() {
                                let sh = e.shape(&f.ty, &[]);
                                out.push(e.eq_expr(&sh, &format!("{x}._{i}"), &format!("{y}._{i}"))?);
                            }
                        }
                        Fields::Unit => {}
                    }
                    Ok(out)
                };
                Ok(match &def.kind {
                    // A newtype is a `distinct` of its inner type.
                    Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                        let inner = self.shape(&fs[0].ty, &[]);
                        let it = self.odin(&inner);
                        match self.equaler(&inner)? {
                            None => "\treturn a == b\n".to_string(),
                            Some(p) => format!("\treturn {p}(cast({it})a, cast({it})b)\n"),
                        }
                    }
                    Kind::Struct(fs) => {
                        let parts = fields_eq(self, fs, "a", "b")?;
                        format!("\treturn {}\n", if parts.is_empty() { "true".into() } else { parts.join(" && ") })
                    }
                    Kind::Enum(vs) => {
                        if vs.iter().all(|v| matches!(v.fields, Fields::Unit)) {
                            return Ok("\treturn a == b\n".to_string());
                        }
                        let mut b = "\tswitch x in a {\n\tcase nil:\n\t\treturn b == nil\n".to_string();
                        for v in vs {
                            let parts = fields_eq(self, &v.fields, "x", "y")?;
                            let all = if parts.is_empty() { "true".to_string() } else { parts.join(" && ") };
                            b.push_str(&format!("\tcase {n}_{}:\n\t\ty, ok := b.({n}_{})\n\t\treturn ok && ({all})\n", v.name, v.name));
                        }
                        b.push_str("\t}\n\treturn false\n");
                        b
                    }
                })
    }
}
