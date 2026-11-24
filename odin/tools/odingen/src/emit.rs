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
    /// `Option<Box<T>>`: a nil-able pointer.
    OptPtr(Box<Shape>),
    Ptr(Box<Shape>),
    Vec(Box<Shape>),
    Map(Box<Shape>, Box<Shape>),
    Tuple(Vec<Shape>),
    Array(Box<Shape>, String),
    Named(String, Vec<Shape>),
    Param(String),
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
    /// Types whose codec is generated from another type's serde attributes (a Rust "repr" struct the hand-written
    /// impl delegates to, with the same fields).
    pub codec_as: BTreeMap<String, String>,
    /// Types whose writer appends computed members after the fields (`encode_<T>_computed`, hand-written).
    pub computed: BTreeSet<String>,
    /// Types with `into = "..."` whose repr has the same shape, so the derived codec is right.
    pub ignore_into: BTreeSet<String>,
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
    subst: BTreeMap<String, Shape>,
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
            codec_as: BTreeMap::new(),
            computed: BTreeSet::new(),
            ignore_into: BTreeSet::new(),
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
                return Shape::Array(Box::new(self.shape(&a.elem, params)), quote::quote!(#len).to_string());
            }
            Type::Slice(s) => return Shape::Vec(Box::new(self.shape(&s.elem, params))),
            _ => {}
        }
        let Some((name, args)) = last_ident(ty) else {
            return Shape::Unknown(quote::quote!(#ty).to_string());
        };
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
                Shape::Ptr(inner) => Shape::OptPtr(inner),
                s => Shape::Option(Box::new(s)),
            },
            "Box" | "Arc" | "Rc" => Shape::Ptr(Box::new(arg(self, 0))),
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
            Shape::Json => "json.Value".into(),
            Shape::Option(i) => format!("Maybe({})", self.odin(i)),
            Shape::OptPtr(i) | Shape::Ptr(i) => format!("^{}", self.odin(i)),
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
            Shape::Array(e, n) => format!("[{}]{}", n, self.odin(e)),
            Shape::Named(n, args) if args.is_empty() => n.clone(),
            Shape::Named(n, args) => {
                let a: Vec<String> = args.iter().map(|x| self.odin(x)).collect();
                format!("{n}({})", a.join(", "))
            }
            Shape::Param(p) => p.clone(),
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
            Shape::Named(..) | Shape::Param(_) | Shape::Unknown(_) => "decode".into(),
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
            Shape::Named(..) | Shape::Param(_) | Shape::Unknown(_) => "encode".into(),
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
            Shape::Map(..) | Shape::Option(_) => self.helper(s, 2),
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
        if let Some(n) = self.helper_names.get(&(kind, ty.clone())) {
            return n.clone();
        }
        let name = format!("{}_{}", ["dec", "enc", "mem"][kind as usize], mangle(&ty));
        self.helper_names.insert((kind, ty.clone()), name.clone());
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
            (0, Shape::Ptr(i) | Shape::OptPtr(i)) => {
                let (it, d) = (self.odin(i), self.dec(i));
                format!("	if v.kind == .Null {{ out^ = nil; return true }}
	p := new({it})
	if !{d}(v, p) do return false
	out^ = p
	return true
")
            }
            (1, Shape::Ptr(i) | Shape::OptPtr(i)) => {
                let e = self.enc(i);
                format!("	if x == nil do strings.write_string(b, \"null\")
	else do {e}(b, x^)
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
                let pair = Shape::Vec(Box::new(Shape::Tuple(vec![(**k).clone(), (**v).clone()])));
                return if kind == 0 { let n = self.dec(&pair); self.alias_helper(&name, &n) } else { let n = self.enc(&pair); self.alias_helper(&name, &n) };
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
    fn with_adapter(&mut self, f: &crate::model::Field, decode: bool) -> Option<String> {
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
        Some(n)
    }

    /// An Odin expression for `Default::default()` of this shape, or None when Odin's zero value is it.
    pub fn default_expr(&mut self, s: &Shape) -> Option<String> {
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
            let mut defs: Vec<&TypeDef> = self.def(&n).into_iter().collect();
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
            self.emit_type(def);
            let base = inst.as_ref().map(|(b, _)| b.clone()).unwrap_or(name.clone());
            if !self.wire.contains(&base) {
                continue;
            }
            if self.hand.contains(&name) {
                // Hand-written codecs call the same per-type helpers for their fields, so make sure they exist.
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
                    let sh = self.shape(&t, &[]);
                    self.dec(&sh);
                    self.enc(&sh);
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
            (_, "is_empty") if pred.starts_with("Vec") || pred.starts_with("HashMap") || pred.starts_with("HashSet")
                || pred.starts_with("BTreeMap") || pred.starts_with("BTreeSet") || pred.starts_with("im::")
                || pred.starts_with("String") || pred.starts_with("IndexMap") || pred.starts_with("SmallVec")
                || pred.starts_with("VecDeque") => format!("len({expr}) == 0"),
            ("std::ops::Not::not" | "Not::not", _) | (_, "is_false") => format!("!{expr}"),
            (_, "is_zero_u32" | "is_zero_usize" | "is_zero_u64" | "is_zero" | "is_zero_u32_field" | "is_zero_u8"
                | "is_zero_i32") => format!("{expr} == 0"),
            _ => {
                let proc_name = format!("skip_{}_{}", self.current, sanitize(pred));
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
                continue;
            }
            let shape = self.shape(&f.ty, params);
            let d = match self.with_adapter(f, true) {
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
            } else if matches!(shape, Shape::Option(_) | Shape::OptPtr(_)) {
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
            let e = match self.with_adapter(f, false) {
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
                    if internally {
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
