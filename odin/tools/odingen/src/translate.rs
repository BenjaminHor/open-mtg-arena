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
}

fn path_segs(p: &syn::Path) -> Vec<String> {
    p.segments.iter().map(|s| s.ident.to_string()).collect()
}

fn lit(l: &Lit) -> R<String> {
    Ok(match l {
        Lit::Int(i) => i.base10_digits().to_string(),
        Lit::Float(f) => f.base10_digits().to_string(),
        Lit::Bool(b) => b.value.to_string(),
        Lit::Str(s) => format!("{:?}", s.value()),
        Lit::Char(c) => format!("'{}'", c.value()),
        other => return Err(format!("literal {}", quote::quote!(#other))),
    })
}

impl<'a, 'b> Tx<'a, 'b> {
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

    fn named_fields(&self, ty: &str, variant: Option<&str>) -> Option<Fields> {
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
            Expr::Paren(p) => self.expr(&p.expr, want),
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
                    Shape::Ptr(i) | Shape::OptPtr(i) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                if let Some((e, v)) = self.variant_of(&segs, &target) {
                    let (unit, _) = self.enum_variants(&e).unwrap();
                    let val = if unit { format!("{e}.{v}") } else { format!("{e}_{v}{{}}") };
                    return Ok(match want {
                        Shape::Ptr(_) | Shape::OptPtr(_) => format!("new_clone({e}({val}))"),
                        _ => val,
                    });
                }
                Err(format!("path {}", segs.join("::")))
            }
            Expr::Call(c) => {
                let Expr::Path(fp) = &*c.func else { return Err("call target".into()) };
                let segs = path_segs(&fp.path);
                let last = segs.last().cloned().unwrap_or_default();
                let args: Vec<&Expr> = c.args.iter().collect();
                match (segs.as_slice(), last.as_str()) {
                    (_, "Some") if args.len() == 1 => {
                        let inner = match want {
                            Shape::Option(i) => (**i).clone(),
                            Shape::OptPtr(i) => Shape::Ptr(i.clone()),
                            s => s.clone(),
                        };
                        return self.expr(args[0], &inner);
                    }
                    (_, "new") if segs.len() == 2 && matches!(segs[0].as_str(), "Box" | "Arc" | "Rc") => {
                        let inner = match want {
                            Shape::Ptr(i) | Shape::OptPtr(i) => (**i).clone(),
                            s => s.clone(),
                        };
                        let v = self.expr(args[0], &inner)?;
                        return Ok(format!("new_clone({}({v}))", self.e.odin(&inner)));
                    }
                    (_, "new" | "default" | "with_capacity") if args.len() <= 1 => return Ok("{}".into()),
                    _ => {}
                }
                let target = match want {
                    Shape::Ptr(i) | Shape::OptPtr(i) | Shape::Option(i) => (**i).clone(),
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
                        Shape::Ptr(_) | Shape::OptPtr(_) => format!("new_clone({e}({val}))"),
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
                Err(format!("call {}", segs.join("::")))
            }
            Expr::Struct(st) => {
                let segs = path_segs(&st.path);
                let target = match want {
                    Shape::Ptr(i) | Shape::OptPtr(i) | Shape::Option(i) => (**i).clone(),
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
                    Shape::Ptr(i) | Shape::OptPtr(i) => format!("new_clone({}({val}))", self.e.odin(i)),
                    _ => val,
                })
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
                            return Err("== on a data enum".into());
                        }
                    }
                }
                Ok(format!("({l} {op} {r})"))
            }
            Expr::MethodCall(mc) => {
                let recv_shape = self.shape_of(&mc.receiver).unwrap_or(Shape::Bool);
                let recv = self.expr(&mc.receiver, &recv_shape)?;
                match mc.method.to_string().as_str() {
                    "is_empty" => Ok(format!("(len({recv}) == 0)")),
                    "is_none" => Ok(format!("({recv} == nil)")),
                    "is_some" => Ok(format!("({recv} != nil)")),
                    "clone" | "into" | "to_owned" | "to_string" => Ok(recv),
                    m => Err(format!("method {m}")),
                }
            }
            other => Err(format!("expression {}", quote::quote!(#other).to_string().chars().take(60).collect::<String>())),
        }
    }

    /// The shape of a variable reference (parameters and `self`), for comparisons.
    fn shape_of(&self, ex: &Expr) -> Option<Shape> {
        match ex {
            Expr::Path(p) if p.path.segments.len() == 1 => self.vars.get(&p.path.segments[0].ident.to_string()).map(|v| v.1.clone()),
            Expr::Unary(u) => self.shape_of(&u.expr),
            Expr::Reference(r) => self.shape_of(&r.expr),
            Expr::Paren(p) => self.shape_of(&p.expr),
            _ => None,
        }
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
                let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: f.self_ty.clone() };
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
            let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: Some(ty.clone()) };
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
