//! Translates Rust function bodies to Odin, for the subset of Rust they use. It starts with the default functions
//! and skip predicates serde attributes name (`default = "default_quantity_one"`,
//! `skip_serializing_if = "is_player_scope_controller"`), whose bodies are literals, variants, `vec![...]` and
//! `matches!`; docs/odin-port.md ("How the engine logic gets ported") is the plan for growing it into the engine's
//! translator. Anything it can't translate is reported for a hand-written Odin procedure, never guessed at.

use std::collections::BTreeMap;
use std::fmt::Write;

use syn::{BinOp, Expr, Lit, Pat, Stmt, UnOp};

use crate::emit::{field_ident, Emitter, Shape};
use crate::model::{Fields, FnDef, Kind};

type R<T> = Result<T, String>;

pub struct Tx<'a, 'b> {
    pub e: &'b mut Emitter<'a>,
    /// Rust parameter names (and `self`) and the Odin expressions they become.
    pub vars: BTreeMap<String, (String, Shape)>,
    pub self_ty: Option<String>,
    /// Inlining depth (calls to single-expression functions are translated in place).
    pub depth: u32,
    /// Whole-function translation (body.rs): calls to engine functions stay calls to their translated procedures
    /// (`Owner_method`), and `.clone()` clones. Off for the serde defaults and skip predicates, which inline.
    pub calls: bool,
    /// Statements an expression needs before the line it's on (`?` becomes a temporary and an early return);
    /// body.rs writes them out ahead of the statement.
    pub pre: Vec<String>,
    /// The enclosing function's result shape (what an early return from `?` must produce).
    pub fn_ret: Shape,
    pub temps: u32,
}

/// The Odin procedure a translated engine function becomes: `Owner_method` for methods and associated
/// functions, the bare name for free functions.
pub fn proc_name(owner: Option<&str>, name: &str) -> String {
    match owner {
        Some(o) => format!("{o}_{name}"),
        None => name.to_string(),
    }
}

/// The procedure name for an engine function: methods `Owner_method`; free functions `<file>_<name>` (free
/// functions repeat names across modules, and some match Odin builtins such as `append`).
pub fn proc_name_for(owner: Option<&str>, name: &str, f: &FnDef) -> String {
    match owner {
        Some(o) => format!("{o}_{name}"),
        None => {
            let stem = f.file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let stem = if stem == "mod" {
                f.file.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or(stem)
            } else {
                stem
            };
            format!("{stem}_{name}")
        }
    }
}

fn path_segs(p: &syn::Path) -> Vec<String> {
    p.segments.iter().map(|s| s.ident.to_string()).collect()
}

fn lit(l: &Lit) -> R<String> {
    Ok(match l {
        Lit::Int(i) => i.base10_digits().to_string(),
        Lit::Float(f) => f.base10_digits().to_string(),
        Lit::Bool(b) => b.value.to_string(),
        Lit::Str(s) => odin_string(&s.value()),
        Lit::Char(c) => format!("'{}'", c.value()),
        other => return Err(format!("literal {}", quote::quote!(#other))),
    })
}

/// An Odin string literal (Rust's `{:?}` writes `\u{..}` escapes, which Odin doesn't read).
pub fn odin_string(v: &str) -> String {
    let mut out = String::from("\"");
    for c in v.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl<'a, 'b> Tx<'a, 'b> {
    /// The owner a path names: `Self::x` is the impl type, `T::x` is T, a bare `x` has none.
    fn owner_of(&self, segs: &[String]) -> Option<String> {
        if segs.len() >= 2 {
            let o = &segs[segs.len() - 2];
            if o == "Self" { self.self_ty.clone() } else if o.chars().next()?.is_uppercase() { Some(o.clone()) } else { None }
        } else {
            None
        }
    }

    /// A named constant, translated from its value.
    fn const_value(&mut self, segs: &[String], want: &Shape) -> Option<R<String>> {
        let name = segs.last()?.clone();
        let owner = self.owner_of(segs);
        let c = self.e.reg.consts.get(&(owner.clone(), name.clone())).and_then(|v| v.first()).cloned()?;
        let shape = self.e.shape(&c.ty, &[]);
        let shape = if matches!(shape, Shape::Named(ref n, _) if n == "Self") { want.clone() } else { shape };
        let next_self = owner.or(self.self_ty.clone());
        let saved = std::mem::replace(&mut self.self_ty, next_self);
        let r = self.expr(&c.expr, &shape);
        self.self_ty = saved;
        Some(r)
    }

    /// A call to a function whose body is one expression: its parameters bound to the (translated) arguments.
    fn inline_call(&mut self, owner: Option<String>, name: &str, recv: Option<(String, Shape)>, args: &[&Expr], want: &Shape) -> Option<R<String>> {
        if self.depth > 8 {
            return Some(Err("inlining too deep".into()));
        }
        let f = self.e.reg.fns.get(&(owner.clone(), name.to_string())).and_then(|v| v.first()).cloned()?;
        let body = single_expr(&f.block)?.clone();
        let mut vars = BTreeMap::new();
        let mut arg_i = 0;
        for input in &f.sig.inputs {
            match input {
                syn::FnArg::Receiver(_) => {
                    let Some((r, sh)) = recv.clone() else { return Some(Err("method without receiver".into())) };
                    vars.insert("self".to_string(), (r, sh));
                }
                syn::FnArg::Typed(pt) => {
                    let Pat::Ident(pi) = &*pt.pat else { return Some(Err("parameter pattern".into())) };
                    let sh = self.e.shape(&pt.ty, &[]);
                    let Some(a) = args.get(arg_i) else { return Some(Err("arity".into())) };
                    arg_i += 1;
                    let v = match self.expr(a, &sh) {
                        Ok(v) => v,
                        Err(e) => return Some(Err(e)),
                    };
                    vars.insert(pi.ident.to_string(), (format!("({v})"), sh));
                }
            }
        }
        let ret = match &f.sig.output {
            syn::ReturnType::Type(_, t) => {
                let sh = self.e.shape(t, &[]);
                if matches!(sh, Shape::Named(ref n, _) if n == "Self") { want.clone() } else { sh }
            }
            syn::ReturnType::Default => Shape::Unit,
        };
        let saved_vars = std::mem::replace(&mut self.vars, vars);
        let next_self = owner.or(self.self_ty.clone());
        let saved_self = std::mem::replace(&mut self.self_ty, next_self);
        self.depth += 1;
        let r = self.expr(&body, &ret);
        self.depth -= 1;
        self.vars = saved_vars;
        self.self_ty = saved_self;
        Some(r)
    }

    fn enum_variants(&self, name: &str) -> Option<(bool, Vec<crate::model::Variant>)> {
        let def = self.e.def(name)?;
        match &def.kind {
            Kind::Enum(vs) => Some((vs.iter().all(|v| matches!(v.fields, Fields::Unit)), vs.clone())),
            _ => None,
        }
    }

    /// The enum a path's variant belongs to: `E::V`, `Self::V`, or a bare `V` read against the wanted type.
    fn variant_of(&self, segs: &[String], want: &Shape) -> Option<(String, String)> {
        let v = segs.last()?.clone();
        let e = if segs.len() >= 2 {
            let e = &segs[segs.len() - 2];
            if e == "Self" { self.self_ty.clone()? } else { e.clone() }
        } else if let Shape::Named(n, _) = want {
            n.clone()
        } else {
            return None;
        };
        let (_, vs) = self.enum_variants(&e)?;
        vs.iter().any(|x| x.name == v).then_some((e, v))
    }

    /// Whether Odin's `==` works on values of this shape: no dynamic arrays, maps or pointers inside.
    fn comparable(&mut self, s: &Shape) -> bool {
        match s {
            Shape::Bool | Shape::Int(_) | Shape::Float(_) | Shape::Str | Shape::Char | Shape::Unit => true,
            Shape::Option(i) => self.comparable(i),
            Shape::Named(n, _) => {
                let Some(def) = self.e.def(n).cloned() else { return false };
                let mut tys = Vec::new();
                match &def.kind {
                    Kind::Struct(Fields::Named(fs) | Fields::Tuple(fs)) => tys.extend(fs.iter().map(|f| f.ty.clone())),
                    Kind::Struct(Fields::Unit) => {}
                    Kind::Enum(vs) => {
                        for v in vs {
                            if let Fields::Named(fs) | Fields::Tuple(fs) = &v.fields {
                                tys.extend(fs.iter().map(|f| f.ty.clone()));
                            }
                        }
                    }
                }
                tys.iter().all(|t| {
                    let sh = self.e.shape(t, &[]);
                    !matches!(sh, Shape::Named(ref m, _) if m == n) && self.comparable(&sh)
                })
            }
            _ => false,
        }
    }

    fn named_fields(&self, ty: &str, variant: Option<&str>) -> Option<Fields> {
        // A monomorphized generic (DisplayOnly_ptr_CardPrinting) has its base type's fields.
        let ty = self.e.instances.get(ty).map(|(b, _)| b.as_str()).unwrap_or(ty);
        let def = self.e.def(ty)?;
        match (&def.kind, variant) {
            (Kind::Struct(f), None) => Some(f.clone()),
            (Kind::Enum(vs), Some(v)) => vs.iter().find(|x| x.name == v).map(|x| x.fields.clone()),
            _ => None,
        }
    }

    fn field_shape(&mut self, fields: &Fields, name: &str, ty_params: &[String]) -> Option<Shape> {
        if let Fields::Named(fs) = fields {
            let f = fs.iter().find(|f| f.name.as_deref() == Some(name))?;
            return Some(self.e.shape(&f.ty, ty_params));
        }
        None
    }

    fn tuple_shapes(&mut self, fields: &Fields) -> Vec<Shape> {
        match fields {
            Fields::Tuple(fs) => fs.iter().map(|f| self.e.shape(&f.ty, &[])).collect(),
            _ => vec![],
        }
    }

    /// An expression in value position, given the type it must have.
    pub fn expr(&mut self, ex: &Expr, want: &Shape) -> R<String> {
        match ex {
            Expr::Lit(l) => lit(&l.lit),
            Expr::Field(fe) => {
                let mut base_shape = self.shape_of(&fe.base).ok_or("field of an unknown value")?;
                let mut base = self.expr(&fe.base, &base_shape)?;
                if let Shape::Ptr(inner, _) = base_shape.clone() {
                    base = format!("{base}^");
                    base_shape = *inner;
                }
                let Shape::Named(tn, _) = &base_shape else { return Err("field of a non-struct".into()) };
                match &fe.member {
                    syn::Member::Named(id) => Ok(format!("{base}.{}", field_ident(&id.to_string()))),
                    // A newtype's only field: the Odin type is `distinct` of it, so the value itself.
                    syn::Member::Unnamed(i) if i.index == 0 => match self.named_fields(tn, None) {
                        Some(Fields::Tuple(fs)) if fs.len() == 1 => {
                            // A monomorphized generic: its parameters stand for the instance's arguments.
                            let saved = self.e.subst.clone();
                            if let Some((base, args)) = self.e.instances.get(tn).cloned() {
                                if let Some(d) = self.e.def(&base) {
                                    self.e.subst = d.generics.iter().cloned().zip(args).collect();
                                }
                            }
                            let inner = self.e.shape(&fs[0].ty, &[]);
                            self.e.subst = saved;
                            Ok(format!("(cast({})({base}))", self.e.odin(&inner)))
                        }
                        _ => Ok(format!("{base}._0")),
                    },
                    _ => Err("tuple field".into()),
                }
            }
            Expr::Paren(p) => self.expr(&p.expr, want),
            // `x?`: a temporary, an early return of the error (or None), and the value.
            Expr::Try(t) if self.calls => {
                let sh = self.shape_of(&t.expr).ok_or("? on an untyped value")?;
                let v = self.expr(&t.expr, &sh)?;
                self.temps += 1;
                let tmp = format!("t{}_", self.temps);
                match (&sh, self.fn_ret.clone()) {
                    (Shape::Result(_, _), Shape::Result(..)) => {
                        let ret_ty = self.e.odin(&self.fn_ret.clone());
                        self.pre.push(format!("{tmp} := {v}"));
                        self.pre.push(format!("if e_, failed := {tmp}.err.?; failed do return {ret_ty}{{err = e_}}"));
                        Ok(format!("{tmp}.ok"))
                    }
                    (Shape::Option(_), Shape::Option(_)) => {
                        self.pre.push(format!("{tmp} := {v}"));
                        self.pre.push(format!("if {tmp} == nil do return nil"));
                        Ok(format!("{tmp}.?"))
                    }
                    _ => Err("? between different kinds".into()),
                }
            }
            Expr::Group(g) => self.expr(&g.expr, want),
            Expr::Reference(r) => self.expr(&r.expr, want),
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => self.expr(e, want),
                _ => Err("block".into()),
            },
            Expr::Unary(u) => {
                let inner = self.expr(&u.expr, want)?;
                Ok(match u.op {
                    UnOp::Deref(_) => inner,
                    UnOp::Not(_) => format!("!{inner}"),
                    UnOp::Neg(_) => format!("-{inner}"),
                    _ => return Err("unary".into()),
                })
            }
            Expr::Path(p) => {
                let segs = path_segs(&p.path);
                if segs.len() == 1 {
                    if let Some((odin, _)) = self.vars.get(&segs[0]) {
                        return Ok(odin.clone());
                    }
                    if segs[0] == "None" {
                        return Ok("nil".into());
                    }
                }
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                if let Some((e, v)) = self.variant_of(&segs, &target) {
                    let (unit, _) = self.enum_variants(&e).unwrap();
                    let val = if unit { format!("{e}.{v}") } else { format!("{e}_{v}{{}}") };
                    return Ok(match want {
                        Shape::Ptr(_, _) | Shape::OptPtr(_, _) => format!("new_clone({e}({val}))"),
                        _ => val,
                    });
                }
                if let Some(v) = self.const_value(&segs, want) {
                    return v;
                }
                // u64::MAX and friends.
                if segs.len() == 2 && matches!(segs[1].as_str(), "MAX" | "MIN")
                    && matches!(segs[0].as_str(), "u8" | "u16" | "u32" | "u64" | "usize" | "i8" | "i16" | "i32" | "i64" | "isize")
                {
                    let t = match segs[0].as_str() { "usize" | "isize" => "int", t => t };
                    return Ok(format!("{}({t})", segs[1].to_lowercase()));
                }
                Err(format!("path {}", segs.join("::")))
            }
            Expr::Call(c) => {
                let Expr::Path(fp) = &*c.func else { return Err("call target".into()) };
                let segs = path_segs(&fp.path);
                let last = segs.last().cloned().unwrap_or_default();
                let args: Vec<&Expr> = c.args.iter().collect();
                match (segs.as_slice(), last.as_str()) {
                    (_, "Ok" | "Err") if args.len() == 1 && self.calls => {
                        let Shape::Result(t, er) = want else { return Err("Ok/Err without a Result type".into()) };
                        let ty = self.e.odin(want);
                        return Ok(if last == "Ok" {
                            let v = self.expr(args[0], t)?;
                            format!("{ty}{{ok = {v}}}")
                        } else {
                            let v = self.expr(args[0], er)?;
                            format!("{ty}{{err = {v}}}")
                        });
                    }
                    (_, "Some") if args.len() == 1 => {
                        let inner = match want {
                            Shape::Option(i) => (**i).clone(),
                            Shape::OptPtr(i, sh) => Shape::Ptr(i.clone(), *sh),
                            s => s.clone(),
                        };
                        return self.expr(args[0], &inner);
                    }
                    (_, "new") if segs.len() == 2 && matches!(segs[0].as_str(), "Box" | "Arc" | "Rc") => {
                        let inner = match want {
                            Shape::Ptr(i, _) | Shape::OptPtr(i, _) => (**i).clone(),
                            s => s.clone(),
                        };
                        let v = self.expr(args[0], &inner)?;
                        return Ok(format!("new_clone({}({v}))", self.e.odin(&inner)));
                    }
                    // Empty standard collections and Default::default(): Odin's zero value.
                    (_, "new" | "with_capacity" | "default")
                        if segs.len() == 2
                            && matches!(segs[0].as_str(), "Vec" | "VecDeque" | "SmallVec" | "HashMap" | "HashSet"
                                | "BTreeMap" | "BTreeSet" | "IndexMap" | "IndexSet" | "String" | "Default" | "Vector") =>
                    {
                        return Ok("{}".into())
                    }
                    _ => {}
                }
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                if let Some((e, v)) = self.variant_of(&segs, &target) {
                    let fields = self.named_fields(&e, Some(&v)).unwrap();
                    let shapes = self.tuple_shapes(&fields);
                    let mut parts = Vec::new();
                    for (i, a) in args.iter().enumerate() {
                        let s = shapes.get(i).cloned().ok_or("tuple variant arity")?;
                        parts.push(format!("_{i} = {}", self.expr(a, &s)?));
                    }
                    let val = format!("{e}_{v}{{{}}}", parts.join(", "));
                    return Ok(match want {
                        Shape::Ptr(_, _) | Shape::OptPtr(_, _) => format!("new_clone({e}({val}))"),
                        _ => val,
                    });
                }
                // A newtype struct: `ObjectId(5)`.
                if segs.len() == 1 && args.len() == 1 {
                    if let Some(Fields::Tuple(fs)) = self.named_fields(&last, None) {
                        if fs.len() == 1 {
                            let s = self.e.shape(&fs[0].ty, &[]);
                            return Ok(format!("{last}({})", self.expr(args[0], &s)?));
                        }
                    }
                }
                // `T::default()` / `Default::default()`: Rust's Default for the wanted type.
                if last == "default" && args.is_empty() {
                    // A generic parameter (`T::default()` in `is_default<T>`) is the wanted type.
                    let target = if segs.len() == 2 && segs[0] != "Default" && segs[0] != "Self" && self.e.reg.types.contains_key(&segs[0]) {
                        Shape::Named(segs[0].clone(), vec![])
                    } else {
                        want.clone()
                    };
                    return Ok(self.e.default_expr(&target).unwrap_or_else(|| format!("{}{{}}", self.e.odin(&target))));
                }
                // `Self(x)`: the impl type's newtype constructor.
                if segs.len() == 1 && last == "Self" && args.len() == 1 {
                    if let Some(st) = self.self_ty.clone() {
                        if let Some(Fields::Tuple(fs)) = self.named_fields(&st, None) {
                            if fs.len() == 1 {
                                let sh = self.e.shape(&fs[0].ty, &[]);
                                return Ok(format!("{st}({})", self.expr(args[0], &sh)?));
                            }
                        }
                    }
                }
                let owner = self.owner_of(&segs);
                if self.calls {
                    if let Some(f) = self.e.reg.fns.get(&(owner.clone(), last.clone())).and_then(|v| v.first()).cloned() {
                        return self.call_with_sig(&proc_name_for(owner.as_deref(), &last, &f), &f, None, &args);
                    }
                    return Err(format!("call {}", segs.join("::")));
                }
                if let Some(v) = self.inline_call(owner, &last, None, &args, want) {
                    return v;
                }
                Err(format!("call {}", segs.join("::")))
            }
            Expr::Struct(st) => {
                let segs = path_segs(&st.path);
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                let (odin_ty, fields) = if let Some((e, v)) = self.variant_of(&segs, &target) {
                    (format!("{e}_{v}"), self.named_fields(&e, Some(&v)).unwrap())
                } else {
                    let n = if segs.last().map(|s| s == "Self").unwrap_or(false) {
                        self.self_ty.clone().ok_or("Self")?
                    } else {
                        segs.last().cloned().unwrap()
                    };
                    let f = self.named_fields(&n, None).ok_or(format!("struct {n}"))?;
                    (n, f)
                };
                if let Some(rest) = &st.rest {
                    // `..Default::default()`: the other fields keep Odin's zero values, which match derived Default.
                    let ok = matches!(&**rest, Expr::Call(c) if matches!(&*c.func, Expr::Path(p) if path_segs(&p.path).last().map(|s| s == "default").unwrap_or(false)));
                    if !ok {
                        return Err("struct update syntax".into());
                    }
                }
                let mut parts = Vec::new();
                for fv in &st.fields {
                    let syn::Member::Named(id) = &fv.member else { return Err("unnamed member".into()) };
                    let name = id.to_string();
                    let s = self.field_shape(&fields, &name, &[]).ok_or(format!("field {name}"))?;
                    parts.push(format!("{} = {}", field_ident(&name), self.expr(&fv.expr, &s)?));
                }
                let val = format!("{odin_ty}{{{}}}", parts.join(", "));
                Ok(match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) => format!("new_clone({}({val}))", self.e.odin(i)),
                    _ => val,
                })
            }
            Expr::Macro(m) if m.mac.path.is_ident("matches") => {
                let mac: MatchesArgs = m.mac.parse_body().map_err(|e| e.to_string())?;
                let sh = self.shape_of(&mac.subject).ok_or("matches! subject")?;
                let subj = self.expr(&mac.subject, &sh)?;
                let alts: Vec<&Pat> = match &mac.pat {
                    Pat::Or(o) => o.cases.iter().collect(),
                    p => vec![p],
                };
                let mut conds = Vec::new();
                for p in alts {
                    let segs = pat_path(p).ok_or("pattern")?;
                    let (e, v) = self.variant_of(&segs, &sh).ok_or("pattern variant")?;
                    let unit_enum = self.enum_variants(&e).map(|x| x.0).unwrap_or(false);
                    let has_field_conds = match p {
                        Pat::Struct(ps) => ps.fields.iter().any(|f| !matches!(*f.pat, Pat::Wild(_))),
                        Pat::TupleStruct(ts) => ts.elems.iter().any(|e| !matches!(e, Pat::Wild(_) | Pat::Rest(_))),
                        _ => false,
                    };
                    if has_field_conds {
                        return Err("matches! with field conditions in an expression".into());
                    }
                    conds.push(if unit_enum { format!("{subj} == {e}.{v}") } else { format!("is_variant({subj}, {e}_{v})") });
                }
                Ok(format!("({})", conds.join(" || ")))
            }
            Expr::Macro(m) if m.mac.path.is_ident("vec") => {
                let Shape::Vec(elem) = want else { return Err("vec! for a non-vector".into()) };
                let items: syn::punctuated::Punctuated<Expr, syn::Token![,]> =
                    m.mac.parse_body_with(syn::punctuated::Punctuated::parse_terminated).map_err(|e| e.to_string())?;
                if items.is_empty() {
                    return Ok("{}".into());
                }
                let mut parts = Vec::new();
                for it in &items {
                    parts.push(self.expr(it, elem)?);
                }
                Ok(format!("dynamic_from([]{}{{{}}})", self.e.odin(elem), parts.join(", ")))
            }
            Expr::Binary(b) => {
                let op = match b.op {
                    BinOp::Eq(_) => "==",
                    BinOp::Ne(_) => "!=",
                    BinOp::Lt(_) => "<",
                    BinOp::Le(_) => "<=",
                    BinOp::Gt(_) => ">",
                    BinOp::Ge(_) => ">=",
                    BinOp::And(_) => "&&",
                    BinOp::Or(_) => "||",
                    _ => return Err("binary operator".into()),
                };
                // Comparisons take the left side's type for the right (literals, variants).
                let left_shape = self.shape_of(&b.left).unwrap_or(Shape::Bool);
                let l = self.expr(&b.left, &left_shape)?;
                let r = self.expr(&b.right, &left_shape)?;
                if matches!(op, "==" | "!=") {
                    if let Shape::Named(n, _) = &left_shape {
                        if !self.enum_variants(n).map(|x| x.0).unwrap_or(true) {
                            // Comparing a data enum with one of its unit variants: a variant test.
                            let segs = match &*b.right {
                                Expr::Path(p) => path_segs(&p.path),
                                _ => return Err("== on a data enum with a non-variant".into()),
                            };
                            let (e, v) = self.variant_of(&segs, &left_shape).ok_or("== variant")?;
                            if !matches!(self.named_fields(&e, Some(&v)), Some(Fields::Unit)) {
                                return Err("== with a data-carrying variant".into());
                            }
                            let neg = if op == "!=" { "!" } else { "" };
                            return Ok(format!("{neg}is_variant({l}, {e}_{v})"));
                        }
                    }
                }
                if matches!(op, "==" | "!=") && !self.comparable(&left_shape) {
                    return Err("== on a type Odin can't compare".into());
                }
                Ok(format!("({l} {op} {r})"))
            }
            Expr::MethodCall(mc) if self.calls && self.chain_terminal(mc) => self.chain(mc, want),
            Expr::MethodCall(mc) => {
                if self.calls {
                    if let Some(r) = self.library_method(mc) {
                        return r;
                    }
                }
                let recv_shape = self.shape_of(&mc.receiver).unwrap_or(Shape::Bool);
                let recv = self.expr(&mc.receiver, &recv_shape)?;
                match mc.method.to_string().as_str() {
                    "is_empty" if matches!(recv_shape, Shape::Vec(_) | Shape::Map(..) | Shape::Str) => Ok(format!("(len({recv}) == 0)")),
                    "is_empty" if matches!(recv_shape, Shape::PVec(_)) => Ok(format!("({recv}.len == 0)")),
                    // A shared collection (`Arc<Vec<T>>`, an `im` collection): nil is the empty one.
                    "is_empty" if matches!(&recv_shape, Shape::Ptr(i, _) if matches!(**i, Shape::Vec(_) | Shape::Map(..))) => {
                        Ok(format!("({recv} == nil || len({recv}^) == 0)"))
                    }
                    "is_none" => Ok(format!("({recv} == nil)")),
                    "is_some" => Ok(format!("({recv} != nil)")),
                    "clone" if self.calls => Ok(match self.e.cloner(&recv_shape) {
                        Some(c) => format!("{c}({recv})"),
                        None => recv,
                    }),
                    // In whole-function translation a conversion is the value itself only between equal types
                    // (`String::to_owned`, `x.into()` to its own type); others (`IntoStaticStr`, Display) differ.
                    "into" | "to_owned" | "to_string" if self.calls => {
                        if &recv_shape == want || (matches!(recv_shape, Shape::Str) && matches!(want, Shape::Str)) {
                            Ok(recv)
                        } else {
                            Err(format!("conversion .{}()", mc.method))
                        }
                    }
                    "clone" | "into" | "to_owned" | "to_string" => Ok(recv),
                    m => {
                        let owner = match &recv_shape { Shape::Named(n, _) => Some(n.clone()), _ => None };
                        let args: Vec<&Expr> = mc.args.iter().collect();
                        if self.calls {
                            if let Some(o) = owner.as_ref() {
                                if let Some(f) = self.e.reg.fns.get(&(Some(o.clone()), m.to_string())).and_then(|v| v.first()).cloned() {
                                    return self.call_with_sig(&proc_name_for(Some(o), m, &f), &f, Some(recv), &args);
                                }
                            }
                            return Err(format!("method .{m}()"));
                        }
                        match owner.and_then(|o| self.inline_call(Some(o), m, Some((recv.clone(), recv_shape.clone())), &args, want)) {
                            Some(v) => v,
                            None => Err(format!("method {m}")),
                        }
                    }
                }
            }
            other => Err(format!("expression {}", quote::quote!(#other).to_string().chars().take(60).collect::<String>())),
        }
    }

    /// The shape of a variable reference (parameters and `self`), for comparisons.
    fn shape_of(&mut self, ex: &Expr) -> Option<Shape> {
        match ex {
            Expr::Path(p) if p.path.segments.len() == 1 => self.vars.get(&p.path.segments[0].ident.to_string()).map(|v| v.1.clone()),
            Expr::Unary(u) => self.shape_of(&u.expr),
            Expr::Reference(r) => self.shape_of(&r.expr),
            Expr::Paren(p) => self.shape_of(&p.expr),
            Expr::Field(fe) => {
                let base = match self.shape_of(&fe.base)? {
                    Shape::Ptr(inner, _) => *inner,
                    s => s,
                };
                let Shape::Named(tn, _) = base else { return None };
                let fields = self.named_fields(&tn, None)?;
                match (&fe.member, &fields) {
                    (syn::Member::Named(id), Fields::Named(fs)) => {
                        let f = fs.iter().find(|f| f.name.as_deref() == Some(&id.to_string()))?;
                        Some(self.e.shape(&f.ty, &[]))
                    }
                    (syn::Member::Unnamed(i), Fields::Tuple(fs)) => fs.get(i.index as usize).map(|f| self.e.shape(&f.ty, &[])),
                    _ => None,
                }
            }
            Expr::MethodCall(mc) if self.calls => {
                let recv = match self.shape_of(&mc.receiver)? {
                    Shape::Ptr(inner, _) => *inner,
                    s => s,
                };
                // Library methods whose result shape follows from the receiver's.
                let m = mc.method.to_string();
                match (m.as_str(), &recv) {
                    ("len", _) | ("count", _) => return Some(Shape::Int("int")),
                    ("is_empty" | "is_some" | "is_none" | "contains" | "contains_key" | "starts_with" | "ends_with"
                        | "is_some_and" | "is_none_or" | "any" | "all" | "eq_ignore_ascii_case", _) => return Some(Shape::Bool),
                    ("clone" | "to_owned", _) => return Some(recv.clone()),
                    ("to_string" | "to_lowercase" | "to_uppercase" | "trim" | "as_str", _) => return Some(Shape::Str),
                    ("first" | "last" | "get", Shape::Vec(i) | Shape::PVec(i)) => return Some(Shape::Option(i.clone())),
                    ("unwrap" | "expect" | "unwrap_or_default" | "unwrap_or" | "unwrap_or_else", Shape::Option(i)) => return Some((**i).clone()),
                    ("copied" | "cloned" | "as_ref" | "as_deref", Shape::Option(_)) => return Some(recv.clone()),
                    _ => {}
                }
                let Shape::Named(o, _) = recv else { return None };
                let f = self.e.reg.fns.get(&(Some(o.clone()), mc.method.to_string())).and_then(|v| v.first()).cloned()?;
                self.return_shape(&f, Some(&o))
            }
            Expr::Call(c) if self.calls => {
                let Expr::Path(fp) = &*c.func else { return None };
                let segs = path_segs(&fp.path);
                let last = segs.last()?.clone();
                if last == "Some" && c.args.len() == 1 {
                    return Some(Shape::Option(Box::new(self.shape_of(&c.args[0])?)));
                }
                // A tuple variant `Enum::V(..)` or a newtype `T(..)`.
                if segs.len() >= 2 {
                    let en = &segs[segs.len() - 2];
                    let en = if en == "Self" { self.self_ty.clone()? } else { en.clone() };
                    if self.enum_variants(&en).is_some_and(|(_, vs)| vs.iter().any(|v| v.name == last)) {
                        return Some(Shape::Named(en, vec![]));
                    }
                } else if self.named_fields(&last, None).is_some_and(|f| matches!(f, Fields::Tuple(_))) {
                    return Some(Shape::Named(last, vec![]));
                }
                let owner = self.owner_of(&segs);
                let f = self.e.reg.fns.get(&(owner.clone(), last)).and_then(|v| v.first()).cloned()?;
                self.return_shape(&f, owner.as_deref())
            }
            Expr::Lit(l) => match &l.lit {
                Lit::Bool(_) => Some(Shape::Bool),
                Lit::Str(_) => Some(Shape::Str),
                Lit::Int(i) => Some(Shape::Int(match i.suffix() {
                    "u8" => "u8",
                    "u16" => "u16",
                    "u32" => "u32",
                    "u64" => "u64",
                    "i32" => "i32",
                    "i64" => "i64",
                    _ => "int",
                })),
                _ => None,
            },
            // Struct literals: `T { .. }`, `Enum::Variant { .. }`.
            Expr::Struct(st) if self.calls => {
                let segs = path_segs(&st.path);
                if segs.len() == 1 && segs[0] == "Self" {
                    return self.self_ty.clone().map(|t| Shape::Named(t, vec![]));
                }
                if segs.len() == 1 && self.e.reg.types.contains_key(&segs[0]) {
                    return Some(Shape::Named(segs[0].clone(), vec![]));
                }
                let enum_name = if segs.len() >= 2 { Some(segs[segs.len() - 2].clone()) } else { None }?;
                let enum_name = if enum_name == "Self" { self.self_ty.clone()? } else { enum_name };
                self.e.reg.types.contains_key(&enum_name).then(|| Shape::Named(enum_name, vec![]))
            }
            Expr::Binary(b) if self.calls => match b.op {
                BinOp::Eq(_) | BinOp::Ne(_) | BinOp::Lt(_) | BinOp::Le(_) | BinOp::Gt(_) | BinOp::Ge(_) | BinOp::And(_)
                | BinOp::Or(_) => Some(Shape::Bool),
                _ => self.shape_of(&b.left).or_else(|| self.shape_of(&b.right)),
            },
            Expr::Cast(c) if self.calls => Some(self.e.shape(&c.ty, &[])),
            Expr::Try(t) if self.calls => match self.shape_of(&t.expr)? {
                Shape::Result(v, _) => Some(*v),
                Shape::Option(v) => Some(*v),
                _ => None,
            },
            Expr::Index(ix) if self.calls => match self.shape_of(&ix.expr)? {
                Shape::Vec(i) | Shape::Array(i, _) | Shape::PVec(i) => Some(*i),
                _ => None,
            },
            Expr::Tuple(t) if self.calls && !t.elems.is_empty() => {
                let mut es = Vec::new();
                for e in &t.elems {
                    es.push(self.shape_of(e)?);
                }
                Some(Shape::Tuple(es))
            }
            Expr::Macro(m) if self.calls => {
                let name = m.mac.path.segments.last()?.ident.to_string();
                match name.as_str() {
                    "format" => Some(Shape::Str),
                    "matches" => Some(Shape::Bool),
                    "vec" => {
                        // The first element's shape.
                        let elems = m.mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated).ok()?;
                        let first = elems.first()?.clone();
                        Some(Shape::Vec(Box::new(self.shape_of(&first)?)))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    pub fn shape_of_pub(&mut self, ex: &Expr) -> Option<Shape> {
        self.shape_of(ex)
    }

    pub fn enum_variants_pub(&self, name: &str) -> Option<(bool, Vec<crate::model::Variant>)> {
        self.enum_variants(name)
    }

    pub fn named_fields_pub(&self, ty: &str, variant: Option<&str>) -> Option<Fields> {
        self.named_fields(ty, variant)
    }

    /// The shape an engine function returns (`Self` is its owner).
    pub fn return_shape(&mut self, f: &FnDef, owner: Option<&str>) -> Option<Shape> {
        match &f.sig.output {
            syn::ReturnType::Default => Some(Shape::Unit),
            syn::ReturnType::Type(_, t) => {
                let s = self.e.shape(t, &[]);
                Some(match s {
                    Shape::Named(ref n, _) if n == "Self" => Shape::Named(owner?.to_string(), vec![]),
                    s => s,
                })
            }
        }
    }

    /// A call to a translated engine function: arguments shaped by its parameters, `&mut` ones by pointer.
    pub fn call_with_sig(&mut self, name: &str, f: &FnDef, recv: Option<String>, args: &[&Expr]) -> R<String> {
        if !f.sig.generics.params.is_empty() {
            return Err("call to a generic function".into());
        }
        let mut parts = Vec::new();
        let mut ai = 0;
        for input in &f.sig.inputs {
            match input {
                syn::FnArg::Receiver(rc) => {
                    let r = recv.clone().ok_or("method called without a receiver")?;
                    parts.push(if rc.mutability.is_some() && rc.reference.is_some() { format!("&{r}") } else { r });
                }
                syn::FnArg::Typed(pt) => {
                    let a = args.get(ai).ok_or("argument count")?;
                    ai += 1;
                    let sh = self.e.shape(&pt.ty, &[]);
                    let v = self.expr(a, &sh)?;
                    let by_mut_ref = matches!(&*pt.ty, syn::Type::Reference(r) if r.mutability.is_some());
                    parts.push(if by_mut_ref { format!("&{v}") } else { v });
                }
            }
        }
        Ok(format!("{name}({})", parts.join(", ")))
    }

    /// `matches!(subject, pattern)` as statements returning the result.
    pub fn matches_stmts(&mut self, subject: &str, shape: &Shape, pat: &Pat) -> R<String> {
        let alts: Vec<&Pat> = match pat {
            Pat::Or(o) => o.cases.iter().collect(),
            p => vec![p],
        };
        let (inner_shape, subject, wrap_some) = match shape {
            Shape::Option(i) => ((**i).clone(), subject.to_string(), true),
            s => (s.clone(), subject.to_string(), false),
        };
        let _ = wrap_some;
        match &inner_shape {
            Shape::Named(n, _) if self.enum_variants(n).is_some() => {
                let (unit, _) = self.enum_variants(n).unwrap();
                if unit {
                    let mut conds = Vec::new();
                    for p in alts {
                        let segs = pat_path(p).ok_or("pattern")?;
                        let (e, v) = self.variant_of(&segs, &inner_shape).ok_or("pattern variant")?;
                        conds.push(format!("{subject} == {e}.{v}"));
                    }
                    return Ok(format!("\treturn {}\n", conds.join(" || ")));
                }
                let mut out = format!("\t#partial switch y in {subject} {{\n");
                for p in alts {
                    let segs = pat_path(p).ok_or("pattern")?;
                    let (e, v) = self.variant_of(&segs, &inner_shape).ok_or("pattern variant")?;
                    let fields = self.named_fields(&e, Some(&v)).unwrap();
                    let mut conds = Vec::new();
                    match p {
                        Pat::Struct(ps) => {
                            for fp in &ps.fields {
                                let syn::Member::Named(id) = &fp.member else { return Err("pattern member".into()) };
                                let fs = self.field_shape(&fields, &id.to_string(), &[]).ok_or("pattern field")?;
                                let acc = format!("y.{}", field_ident(&id.to_string()));
                                conds.push(self.pat_cond(&acc, &fs, &fp.pat)?);
                            }
                        }
                        Pat::TupleStruct(ts) => {
                            let shapes = self.tuple_shapes(&fields);
                            for (i, sp) in ts.elems.iter().enumerate() {
                                let s = shapes.get(i).cloned().ok_or("pattern arity")?;
                                conds.push(self.pat_cond(&format!("y._{i}"), &s, sp)?);
                            }
                        }
                        _ => {}
                    }
                    conds.retain(|c| c != "true");
                    let cond = if conds.is_empty() { "true".to_string() } else { conds.join(" && ") };
                    let _ = writeln!(out, "\tcase {e}_{v}:\n\t\t_ = y\n\t\treturn {cond}");
                }
                out.push_str("\t}\n\treturn false\n");
                Ok(out)
            }
            _ => {
                let mut conds = Vec::new();
                for p in alts {
                    conds.push(self.pat_cond(&subject, &inner_shape, p)?);
                }
                Ok(format!("\treturn {}\n", conds.join(" || ")))
            }
        }
    }

    /// A sub-pattern as a boolean condition on an already-extracted value.
    fn pat_cond(&mut self, acc: &str, shape: &Shape, p: &Pat) -> R<String> {
        match p {
            Pat::Wild(_) | Pat::Rest(_) => Ok("true".into()),
            Pat::Lit(l) => Ok(format!("{acc} == {}", lit(&l.lit)?)),
            Pat::Ident(i) if i.subpat.is_none() && i.ident == "None" => Ok(format!("{acc} == nil")),
            Pat::Path(_) | Pat::Ident(_) => {
                let segs = pat_path(p).ok_or("sub-pattern")?;
                match self.variant_of(&segs, shape) {
                    Some((e, v)) if self.enum_variants(&e).map(|x| x.0).unwrap_or(false) => Ok(format!("{acc} == {e}.{v}")),
                    _ => Err("sub-pattern path".into()),
                }
            }
            _ => Err(format!("sub-pattern {}", quote::quote!(#p))),
        }
    }
}

fn pat_path(p: &Pat) -> Option<Vec<String>> {
    match p {
        Pat::Path(pp) => Some(path_segs(&pp.path)),
        Pat::Struct(ps) => Some(path_segs(&ps.path)),
        Pat::TupleStruct(ts) => Some(path_segs(&ts.path)),
        Pat::Ident(i) => Some(vec![i.ident.to_string()]),
        _ => None,
    }
}

/// The function a serde attribute path names, looked up the way rustc would: `Type::method` as an impl method,
/// otherwise a free function, preferring the one in the same file as the type that uses it.
fn resolve<'r>(e: &Emitter<'r>, path: &str, user: &str) -> Option<&'r FnDef> {
    let segs: Vec<&str> = path.split("::").collect();
    let name = segs.last()?.to_string();
    let owner = if segs.len() >= 2 && segs[segs.len() - 2].chars().next()?.is_uppercase() {
        Some(segs[segs.len() - 2].to_string())
    } else {
        None
    };
    let defs = e.reg.fns.get(&(owner, name))?;
    let user_file = e.def(user).map(|d| d.file.clone());
    defs.iter().find(|d| Some(&d.file) == user_file.as_ref()).or(defs.first())
}

fn single_expr(block: &syn::Block) -> Option<&Expr> {
    match block.stmts.as_slice() {
        [Stmt::Expr(e, None)] => Some(e),
        [Stmt::Expr(Expr::Return(r), _)] => r.expr.as_deref(),
        _ => None,
    }
}

/// Translates every default function and skip predicate the codecs call. Returns the Odin source and the ones that
/// need writing by hand.
pub fn defaults_and_skips(e: &mut Emitter) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut failed = Vec::new();
    // One Odin procedure per distinct Rust function; each request is an alias of it.
    let mut canonical: BTreeMap<String, String> = BTreeMap::new();
    let defaults: Vec<_> = e.default_reqs.clone().into_iter().collect();
    let skips: Vec<_> = e.skip_reqs.clone().into_iter().collect();
    for (is_default, reqs) in [(true, defaults), (false, skips)] {
        for (proc_name, (path, shape, user)) in reqs {
            let Some(f) = resolve(e, &path, &user) else {
                // Outside the scanned sources (e.g. bin/oracle_gen.rs): written by hand.
                let hand_name = format!("hand_{}", path.rsplit("::").next().unwrap_or(&path));
                let _ = writeln!(out, "{proc_name} :: {hand_name}");
                failed.push(format!("{hand_name}: {path} (not in the scanned sources)"));
                continue;
            };
            let key = format!("{}:{}:{}:{}", f.file.display(), f.self_ty.clone().unwrap_or_default(), f.sig.ident, e.odin(&shape));
            if let Some(c) = canonical.get(&key) {
                let _ = writeln!(out, "{proc_name} :: {c}");
                continue;
            }
            let odin_ty = e.odin(&shape);
            let result = (|| -> R<String> {
                let body = single_expr(&f.block).ok_or("not a single expression")?;
                let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: f.self_ty.clone(), depth: 0, calls: false, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
                if is_default {
                    let v = tx.expr(body, &shape)?;
                    Ok(format!("{proc_name} :: proc() -> {odin_ty} {{\n\treturn {v}\n}}\n"))
                } else {
                    // The predicate's one parameter (or self) is the field value `x`.
                    let pname = match f.sig.inputs.first() {
                        Some(syn::FnArg::Receiver(_)) => "self".to_string(),
                        Some(syn::FnArg::Typed(pt)) => match &*pt.pat {
                            Pat::Ident(i) => i.ident.to_string(),
                            _ => return Err("parameter pattern".into()),
                        },
                        None => return Err("no parameter".into()),
                    };
                    tx.vars.insert(pname, ("x".into(), shape.clone()));
                    let stmts = match body {
                        Expr::Macro(m) if m.mac.path.is_ident("matches") => {
                            let mac: MatchesArgs = m.mac.parse_body().map_err(|e| e.to_string())?;
                            let subject_shape = tx.shape_of(&mac.subject).ok_or("matches! subject")?;
                            tx.matches_stmts("x", &subject_shape, &mac.pat)?
                        }
                        other => format!("\treturn {}\n", tx.expr(other, &Shape::Bool)?),
                    };
                    Ok(format!("{proc_name} :: proc(x: {odin_ty}) -> bool {{\n\t_ = x\n{stmts}}}\n"))
                }
            })();
            match result {
                Ok(src) => {
                    canonical.insert(key, proc_name.clone());
                    out.push_str(&src);
                    out.push('\n');
                }
                Err(why) => {
                    // Written by hand once, as hand_<Type>_<fn> (odin/engine/types/hand_*.odin); each use aliases it.
                    let owner = f.self_ty.clone().map(|t| format!("{t}_")).unwrap_or_default();
                    let hand_name = format!("hand_{owner}{}", f.sig.ident);
                    let _ = writeln!(out, "{proc_name} :: {hand_name}");
                    canonical.insert(key, proc_name.clone());
                    failed.push(format!("{hand_name}: {path} ({why})"));
                }
            }
        }
    }
    // `impl Default for T` bodies, for types whose Default isn't Odin's zero value.
    let manual: Vec<String> = e.manual_default_reqs.iter().cloned().collect();
    for ty in manual {
        let Some(f) = e.reg.fns.get(&(Some(ty.clone()), "__Default".to_string())).and_then(|v| v.first()) else {
            failed.push(format!("default_{ty}: impl Default not found"));
            continue;
        };
        let shape = Shape::Named(ty.clone(), vec![]);
        let res = (|| -> R<String> {
            let body = single_expr(&f.block).ok_or("not a single expression")?;
            let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: Some(ty.clone()), depth: 0, calls: false, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
            tx.expr(body, &shape)
        })();
        match res {
            Ok(v) => {
                let _ = writeln!(out, "default_{ty} :: proc() -> {ty} {{\n\treturn {v}\n}}\n");
            }
            Err(why) => {
                let _ = writeln!(out, "default_{ty} :: hand_default_{ty}\n");
                failed.push(format!("hand_default_{ty}: impl Default for {ty} ({why})"));
            }
        }
    }
    (out, failed)
}

struct MatchesArgs {
    subject: Expr,
    pat: Pat,
}

impl syn::parse::Parse for MatchesArgs {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let subject: Expr = input.parse()?;
        input.parse::<syn::Token![,]>()?;
        let pat = Pat::parse_multi_with_leading_vert(input)?;
        // An `if` guard or trailing comma isn't used by these predicates.
        let _ = input.parse::<Option<syn::Token![,]>>();
        Ok(MatchesArgs { subject, pat })
    }
}

// ------------------------------------------------------------------------------------------- iterator chains ---
// `xs.iter().filter(|x| ..).map(|x| ..).collect()` and friends become one loop, written ahead of the line (pre),
// with each closure's body inlined; the chain's value is a temporary. Only expression-bodied closures and a
// collection at the chain's start (a `Vec`, an `im::Vector`, a range) for now.

enum Stage<'e> {
    Filter(&'e syn::ExprClosure),
    Map(&'e syn::ExprClosure),
    FilterMap(&'e syn::ExprClosure),
    Pass, // copied(), cloned(), iter(), into_iter()
}

impl<'a, 'b> Tx<'a, 'b> {
    fn chain_terminal(&self, mc: &syn::ExprMethodCall) -> bool {
        matches!(mc.method.to_string().as_str(), "collect" | "any" | "all" | "find" | "position" | "count" | "sum" | "find_map")
            && self.chain_source(&mc.receiver).is_some()
    }

    /// The collection a chain starts from, under its adapters.
    fn chain_source<'e>(&self, mut e: &'e Expr) -> Option<&'e Expr> {
        loop {
            match e {
                Expr::MethodCall(m) => match m.method.to_string().as_str() {
                    "iter" | "into_iter" | "copied" | "cloned" | "filter" | "map" | "filter_map" => e = &m.receiver,
                    _ => return None,
                },
                Expr::Paren(p) => e = &p.expr,
                _ => return Some(e),
            }
        }
    }

    fn closure_of(a: &Expr) -> R<&syn::ExprClosure> {
        match a {
            Expr::Closure(c) if c.inputs.len() == 1 => Ok(c),
            _ => Err("iterator adapter without a one-argument closure".into()),
        }
    }

    /// Binds a closure's parameter (`|x|`, `|&x|`, `|(a, b)|`) to an Odin value of a shape; returns the old bindings.
    fn bind_param(&mut self, pat: &Pat, value: &str, shape: &Shape) -> R<Vec<(String, Option<(String, Shape)>)>> {
        let mut saved = Vec::new();
        match pat {
            Pat::Ident(pi) => {
                let n = pi.ident.to_string();
                saved.push((n.clone(), self.vars.insert(n, (value.to_string(), shape.clone()))));
            }
            Pat::Reference(r) => return self.bind_param(&r.pat, value, shape),
            Pat::Type(t) => return self.bind_param(&t.pat, value, shape),
            Pat::Wild(_) => {}
            Pat::Tuple(t) => {
                let Shape::Tuple(es) = shape else { return Err("tuple parameter on a non-tuple".into()) };
                for (i, (p, s)) in t.elems.iter().zip(es.clone().iter()).enumerate() {
                    saved.extend(self.bind_param(p, &format!("{value}._{i}"), s)?);
                }
            }
            _ => return Err("closure parameter pattern".into()),
        }
        Ok(saved)
    }

    fn unbind(&mut self, saved: Vec<(String, Option<(String, Shape)>)>) {
        for (n, old) in saved.into_iter().rev() {
            match old {
                Some(o) => {
                    self.vars.insert(n, o);
                }
                None => {
                    self.vars.remove(&n);
                }
            }
        }
    }

    /// A closure body inside a loop body: its expression, after any statements it needs (into `body`).
    fn closure_in(&mut self, body: &mut Vec<String>, c: &syn::ExprClosure, value: &str, shape: &Shape, want: &Shape) -> R<String> {
        let outer = std::mem::take(&mut self.pre);
        let r = self.closure_expr(c, value, shape, want);
        let inner = std::mem::replace(&mut self.pre, outer);
        body.extend(inner);
        r
    }

    /// A closure body as an expression, with its parameter bound to `value`.
    fn closure_expr(&mut self, c: &syn::ExprClosure, value: &str, shape: &Shape, want: &Shape) -> R<String> {
        let saved = self.bind_param(&c.inputs[0], value, shape)?;
        let body = match &*c.body {
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => e.clone(),
                _ => {
                    self.unbind(saved);
                    return Err("closure with statements".into());
                }
            },
            Expr::Block(_) => {
                self.unbind(saved);
                return Err("closure with statements".into());
            }
            e => e.clone(),
        };
        let r = self.expr(&body, want);
        self.unbind(saved);
        r
    }

    fn closure_shape(&mut self, c: &syn::ExprClosure, value: &str, shape: &Shape) -> Option<Shape> {
        let saved = self.bind_param(&c.inputs[0], value, shape).ok()?;
        let body = match &*c.body {
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => e.clone(),
                _ => return None,
            },
            e => e.clone(),
        };
        let r = self.shape_of(&body);
        self.unbind(saved);
        r
    }

    fn chain(&mut self, mc: &syn::ExprMethodCall, want: &Shape) -> R<String> {
        // Collect the stages from the source outwards.
        let mut stages: Vec<Stage> = Vec::new();
        let mut e: &Expr = &mc.receiver;
        loop {
            match e {
                Expr::MethodCall(m) => {
                    match m.method.to_string().as_str() {
                        "iter" | "into_iter" | "copied" | "cloned" => stages.push(Stage::Pass),
                        "filter" => stages.push(Stage::Filter(Self::closure_of(m.args.first().ok_or("filter")?)?)),
                        "map" => stages.push(Stage::Map(Self::closure_of(m.args.first().ok_or("map")?)?)),
                        "filter_map" => stages.push(Stage::FilterMap(Self::closure_of(m.args.first().ok_or("filter_map")?)?)),
                        _ => return Err("iterator adapter".into()),
                    }
                    e = &m.receiver;
                }
                Expr::Paren(p) => e = &p.expr,
                _ => break,
            }
        }
        stages.reverse();
        let src_shape = self.shape_of(e).ok_or("iterator over an untyped collection")?;
        self.temps += 1;
        let n = self.temps;
        let item = format!("it{n}_");
        // The loop over the source.
        let (head, mut cur_shape) = match &src_shape {
            Shape::Vec(i) | Shape::Array(i, _) => {
                let src = self.expr(e, &src_shape)?;
                (format!("for {item} in {src}"), (**i).clone())
            }
            Shape::PVec(i) => {
                let src = self.expr(e, &src_shape)?;
                (format!("for i{n}_ in 0 ..< {src}.len {{ {item} := pvec_get({src}, i{n}_);"), (**i).clone())
            }
            _ => return Err("iterator over a non-Vec".into()),
        };
        let pvec = matches!(src_shape, Shape::PVec(_));
        // Each stage refines the current value (`cur`) or skips the item.
        let mut body: Vec<String> = Vec::new();
        let mut cur = item.clone();
        for (k, st) in stages.iter().enumerate() {
            match st {
                Stage::Pass => {}
                Stage::Filter(c) => {
                    let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                    body.push(format!("if !({cond}) do continue"));
                }
                Stage::Map(c) => {
                    let out_shape = self.closure_shape(c, &cur, &cur_shape).ok_or("map closure of an untyped value")?;
                    let v = self.closure_in(&mut body, c, &cur, &cur_shape, &out_shape)?;
                    let next = format!("m{n}_{k}_");
                    body.push(format!("{next} := {v}"));
                    cur = next;
                    cur_shape = out_shape;
                }
                Stage::FilterMap(c) => {
                    let out_shape = self.closure_shape(c, &cur, &cur_shape).ok_or("filter_map closure of an untyped value")?;
                    let Shape::Option(inner) = out_shape else { return Err("filter_map closure not returning Option".into()) };
                    let v = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Option(inner.clone()))?;
                    let next = format!("m{n}_{k}_");
                    body.push(format!("{next}, {next}ok := ({v}).?"));
                    body.push(format!("if !{next}ok do continue"));
                    cur = next;
                    cur_shape = *inner;
                }
            }
        }
        let res = format!("r{n}_");
        let args: Vec<&Expr> = mc.args.iter().collect();
        let (init, step, value) = match mc.method.to_string().as_str() {
            "collect" => {
                let ty = self.e.odin(want);
                match want {
                    Shape::Vec(_) => (format!("{res}: {ty}"), format!("append(&{res}, {cur})"), res.clone()),
                    _ => return Err("collect into something other than a Vec".into()),
                }
            }
            "any" => {
                let c = Self::closure_of(args.first().ok_or("any")?)?;
                let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res} := false"), format!("if {cond} {{ {res} = true; break }}"), res.clone())
            }
            "all" => {
                let c = Self::closure_of(args.first().ok_or("all")?)?;
                let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res} := true"), format!("if !({cond}) {{ {res} = false; break }}"), res.clone())
            }
            "find" => {
                let c = Self::closure_of(args.first().ok_or("find")?)?;
                let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                let ty = self.e.odin(&cur_shape);
                (format!("{res}: Maybe({ty})"), format!("if {cond} {{ {res} = {cur}; break }}"), res.clone())
            }
            "find_map" => {
                let c = Self::closure_of(args.first().ok_or("find_map")?)?;
                let out_shape = self.closure_shape(c, &cur, &cur_shape).ok_or("find_map closure of an untyped value")?;
                let v = self.closure_in(&mut body, c, &cur, &cur_shape, &out_shape)?;
                let ty = self.e.odin(&out_shape);
                (format!("{res}: {ty}"), format!("if fm_ := {v}; fm_ != nil {{ {res} = fm_; break }}"), res.clone())
            }
            "position" => {
                let c = Self::closure_of(args.first().ok_or("position")?)?;
                let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res}: Maybe(int); p{n}_ := 0"), format!("if {cond} {{ {res} = p{n}_; break }}; p{n}_ += 1"), res.clone())
            }
            "count" if args.is_empty() => (format!("{res} := 0"), format!("{res} += 1"), res.clone()),
            "sum" if args.is_empty() => {
                let ty = self.e.odin(&cur_shape);
                (format!("{res}: {ty}"), format!("{res} += {cur}"), res.clone())
            }
            _ => return Err("iterator terminal".into()),
        };
        self.pre.push(init);
        let close = if pvec { "}}" } else { "}" };
        let _ = close;
        let mut lines = vec![format!("{head} {{")];
        lines.extend(body);
        lines.push(step);
        if pvec {
            lines.push("}}".into());
        } else {
            lines.push("}".into());
        }
        self.pre.push(lines.join("\n"));
        Ok(value)
    }

    /// Library methods on collections and options, by receiver shape. None when the method isn't one of them.
    fn library_method(&mut self, mc: &syn::ExprMethodCall) -> Option<R<String>> {
        let m = mc.method.to_string();
        let recv_shape = self.shape_of(&mc.receiver)?;
        let args: Vec<&Expr> = mc.args.iter().collect();
        let base = match &recv_shape {
            Shape::Ptr(i, _) => (**i).clone(),
            s => s.clone(),
        };
        let deref = if matches!(recv_shape, Shape::Ptr(..)) { "^" } else { "" };
        let (pre_len, temps) = (self.pre.len(), self.temps);
        let r = (|| -> R<String> {
            let recv = self.expr(&mc.receiver, &recv_shape)?;
            Ok(match (m.as_str(), &base, args.len()) {
                ("len", Shape::Vec(_) | Shape::Str | Shape::Map(..), 0) if deref.is_empty() => format!("len({recv})"),
                ("len", Shape::Vec(_) | Shape::Map(..), 0) => format!("(0 if {recv} == nil else len({recv}^))"),
                ("len", Shape::PVec(_), 0) => format!("{recv}.len"),
                ("is_empty", Shape::PVec(_), 0) => format!("({recv}.len == 0)"),
                ("is_empty", Shape::Vec(_) | Shape::Map(..), 0) if !deref.is_empty() => format!("({recv} == nil || len({recv}^) == 0)"),
                ("push", Shape::Vec(i), 1) if deref.is_empty() => {
                    let v = self.expr(args[0], i)?;
                    format!("append(&{recv}, {v})")
                }
                ("contains", Shape::Vec(i), 1) if deref.is_empty() => {
                    let v = self.expr(args[0], i)?;
                    format!("vec_contains({recv}[:], {v})")
                }
                ("first", Shape::Vec(_), 0) if deref.is_empty() => format!("vec_first({recv}[:])"),
                ("last", Shape::Vec(_), 0) if deref.is_empty() => format!("vec_last({recv}[:])"),
                ("unwrap" | "expect", Shape::Option(_), _) => format!("{recv}.?"),
                ("unwrap_or", Shape::Option(i), 1) => {
                    let d = self.expr(args[0], i)?;
                    format!("({recv}.? or_else {d})")
                }
                ("unwrap_or_default", Shape::Option(i), 0) => {
                    let d = self.e.default_expr(i).unwrap_or_else(|| format!("{}{{}}", self.e.odin(i)));
                    format!("({recv}.? or_else {d})")
                }
                ("as_ref" | "as_deref" | "copied" | "cloned" | "as_mut", Shape::Option(_), 0) => recv,
                ("is_some_and", Shape::Option(i), 1) | ("is_none_or", Shape::Option(i), 1) => {
                    let c = Self::closure_of(args[0])?;
                    self.temps += 1;
                    let t = format!("o{}_", self.temps);
                    let cond = self.closure_expr(c, &format!("{t}.?"), i, &Shape::Bool)?;
                    self.pre.push(format!("{t} := {recv}"));
                    if m == "is_some_and" {
                        format!("({t} != nil && ({cond}))")
                    } else {
                        format!("({t} == nil || ({cond}))")
                    }
                }
                _ => return Err(String::new()),
            })
        })();
        match r {
            Err(e) if e.is_empty() => {
                // Not a library method: undo whatever translating the receiver hoisted.
                self.pre.truncate(pre_len);
                self.temps = temps;
                None
            }
            other => Some(other),
        }
    }
}
