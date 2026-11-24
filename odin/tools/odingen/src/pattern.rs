//! The pattern compiler (docs/odin-port.md, "The translator's next layer"): a Rust pattern against an Odin subject
//! becomes statements that test it, jumping to a failure label when it doesn't match, plus the bindings it makes.
//! body.rs places them for `match`, `if let`, `let .. else`, `let` and `for`.
//!
//! Binding modes follow Rust's. A pattern matched through a mutable reference (`Mode::Mut`) binds pointers into the
//! subject (`x := &..`, used as `x^`), so writes through them land in place; otherwise bindings are copies taken
//! when the pattern matches, which is what Rust's by-value and shared-reference bindings read.

use syn::{Expr, Pat};

use crate::emit::Shape;
use crate::model::Fields;
use crate::translate::Tx;

type R<T> = Result<T, String>;

/// Where a failed test jumps: replaced by the caller (`break arm_3`, ...).
pub const FAIL: &str = "\u{1}FAIL\u{1}";

#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Value,
    Mut,
}

#[derive(Default)]
pub struct PatCode {
    /// Tests and temporaries, in order; tests contain FAIL.
    pub stmts: Vec<String>,
    /// (Rust name, Odin initializer, shape, pointer): a pointer binding is declared `x := &..` and used as `x^`.
    pub binds: Vec<(String, String, Shape, bool)>,
}

impl PatCode {
    pub fn refutable(&self) -> bool {
        self.stmts.iter().any(|s| s.contains(FAIL))
    }
}

pub fn compile(tx: &mut Tx, pat: &Pat, subj: &str, shape: &Shape, mode: Mode) -> R<PatCode> {
    let mut c = PatCode::default();
    pat_into(tx, pat, subj, shape, mode, &mut c)?;
    Ok(c)
}

fn temp(tx: &mut Tx, base: &str) -> String {
    tx.temps += 1;
    format!("{base}{}_", tx.temps)
}

fn pat_into(tx: &mut Tx, pat: &Pat, s: &str, shape: &Shape, mode: Mode, c: &mut PatCode) -> R<()> {
    // A shared or owned pointer (Box/Arc) is matched through.
    if let Shape::Ptr(inner, _) = shape {
        return pat_into(tx, pat, &format!("{s}^"), inner, mode, c);
    }
    // Through a `&mut` result: the pointee, in Mut mode (bindings point into it).
    if let Shape::MutRef(inner) = shape {
        if matches!(pat, Pat::Ident(pi) if pi.subpat.is_none() && pi.by_ref.is_none()) {
            // A plain binding of the pointer itself: used as `x^`.
            let Pat::Ident(pi) = pat else { unreachable!() };
            c.binds.push((pi.ident.to_string(), s.to_string(), (**inner).clone(), true));
            return Ok(());
        }
        return pat_into(tx, pat, &format!("{s}^"), inner, Mode::Mut, c);
    }
    match pat {
        Pat::Wild(_) | Pat::Rest(_) => Ok(()),
        Pat::Paren(p) => pat_into(tx, &p.pat, s, shape, mode, c),
        Pat::Reference(r) => pat_into(tx, &r.pat, s, shape, mode, c),
        Pat::Type(t) => pat_into(tx, &t.pat, s, shape, mode, c),
        Pat::Ident(pi) => {
            let name = pi.ident.to_string();
            // `None` and unit variants or constants written bare are paths, not bindings.
            if pi.subpat.is_none() && (name == "None" || name.chars().next().is_some_and(char::is_uppercase)) {
                return path_test(tx, &[name], s, shape, c);
            }
            if let Some((_, sp)) = &pi.subpat {
                pat_into(tx, sp, s, shape, mode, c)?;
            }
            let by_ptr = mode == Mode::Mut || (pi.by_ref.is_some() && pi.mutability.is_some());
            if by_ptr {
                c.binds.push((name, format!("&{s}"), shape.clone(), true));
            } else {
                c.binds.push((name, s.to_string(), shape.clone(), false));
            }
            Ok(())
        }
        Pat::Lit(l) => {
            let v = tx.expr(&Expr::Lit(syn::ExprLit { attrs: vec![], lit: l.lit.clone() }), shape)?;
            c.stmts.push(format!("if {s} != {v} do {FAIL}"));
            Ok(())
        }
        Pat::Range(r) => {
            let mut conds = Vec::new();
            if let Some(lo) = &r.start {
                let v = tx.expr(lo, shape)?;
                conds.push(format!("{s} < {v}"));
            }
            if let Some(hi) = &r.end {
                let v = tx.expr(hi, shape)?;
                let op = if matches!(r.limits, syn::RangeLimits::Closed(_)) { ">" } else { ">=" };
                conds.push(format!("{s} {op} {v}"));
            }
            c.stmts.push(format!("if {} do {FAIL}", conds.join(" || ")));
            Ok(())
        }
        Pat::Tuple(t) => {
            let Shape::Tuple(es) = shape else { return Err("tuple pattern on a non-tuple".into()) };
            let es = es.clone();
            positional(tx, t.elems.iter().collect(), &es, |i| format!("{s}._{i}"), mode, c)
        }
        Pat::Path(pp) => {
            let segs: Vec<String> = pp.path.segments.iter().map(|x| x.ident.to_string()).collect();
            path_test(tx, &segs, s, shape, c)
        }
        Pat::TupleStruct(ts) => {
            let segs: Vec<String> = ts.path.segments.iter().map(|x| x.ident.to_string()).collect();
            let last = segs.last().cloned().unwrap_or_default();
            let elems: Vec<&Pat> = ts.elems.iter().collect();
            match (last.as_str(), shape) {
                ("Some", Shape::Option(i)) if elems.len() == 1 => {
                    let v = temp(tx, "pv");
                    let amp = if mode == Mode::Mut { "&" } else { "" };
                    c.stmts.push(format!("{v}, {v}ok := {amp}{s}.?"));
                    c.stmts.push(format!("if !{v}ok do {FAIL}"));
                    let inner = if mode == Mode::Mut { format!("{v}^") } else { v };
                    pat_into(tx, elems[0], &inner, i, mode, c)
                }
                ("Some", Shape::OptPtr(i, _)) if elems.len() == 1 => {
                    c.stmts.push(format!("if {s} == nil do {FAIL}"));
                    pat_into(tx, elems[0], &format!("{s}^"), i, mode, c)
                }
                ("Ok", Shape::Result(v, _)) if elems.len() == 1 => {
                    c.stmts.push(format!("if {s}.err != nil do {FAIL}"));
                    pat_into(tx, elems[0], &format!("{s}.ok"), v, mode, c)
                }
                ("Err", Shape::Result(_, e)) if elems.len() == 1 => {
                    if mode == Mode::Mut {
                        return Err("Err pattern through a mutable reference".into());
                    }
                    let v = temp(tx, "pe");
                    c.stmts.push(format!("{v}, {v}ok := {s}.err.?"));
                    c.stmts.push(format!("if !{v}ok do {FAIL}"));
                    pat_into(tx, elems[0], &v, e, mode, c)
                }
                _ => {
                    let Shape::Named(tn, _) = shape else { return Err("tuple-struct pattern on this shape".into()) };
                    let tn = tn.clone();
                    if let Some((unit_only, _)) = tx.enum_variants_pub(&tn) {
                        if unit_only {
                            return Err("tuple pattern on a unit-only enum".into());
                        }
                        let fields = tx.named_fields_pub(&tn, Some(&last)).ok_or("pattern variant")?;
                        let Fields::Tuple(fs) = fields else { return Err("tuple pattern on a struct variant".into()) };
                        let v = temp(tx, "pv");
                        let amp = if mode == Mode::Mut { "&" } else { "" };
                        c.stmts.push(format!("{v}, {v}ok := {amp}{s}.({tn}_{last})"));
                        c.stmts.push(format!("if !{v}ok do {FAIL}"));
                        let shapes: Vec<Shape> = fs.iter().map(|f| tx.e.shape(&f.ty, &[])).collect();
                        // Through a pointer (Mut), `v._0` reads the pointee's field.
                        positional(tx, elems, &shapes, |i| format!("{v}._{i}"), mode, c)
                    } else {
                        // A struct with unnamed fields: a newtype is an Odin `distinct` type, read by a cast.
                        let fields = tx.named_fields_pub(&tn, None).ok_or("tuple-struct pattern type")?;
                        let Fields::Tuple(fs) = fields else { return Err("tuple pattern on a named struct".into()) };
                        let shapes: Vec<Shape> = fs.iter().map(|f| tx.e.shape(&f.ty, &[])).collect();
                        if shapes.len() == 1 {
                            if mode == Mode::Mut {
                                return Err("newtype pattern through a mutable reference".into());
                            }
                            let inner = format!("({})({s})", tx.e.odin(&shapes[0]));
                            return pat_into(tx, elems[0], &inner, &shapes[0], mode, c);
                        }
                        positional(tx, elems, &shapes, |i| format!("{s}._{i}"), mode, c)
                    }
                }
            }
        }
        Pat::Struct(ps) => {
            let segs: Vec<String> = ps.path.segments.iter().map(|x| x.ident.to_string()).collect();
            let last = segs.last().cloned().unwrap_or_default();
            let Shape::Named(tn, _) = shape else { return Err("struct pattern on this shape".into()) };
            let tn = tn.clone();
            let (base, fields) = match tx.enum_variants_pub(&tn) {
                Some((true, _)) => return Err("struct pattern on a unit-only enum".into()),
                Some((false, _)) => {
                    let fields = tx.named_fields_pub(&tn, Some(&last)).ok_or("pattern variant")?;
                    let v = temp(tx, "pv");
                    let amp = if mode == Mode::Mut { "&" } else { "" };
                    c.stmts.push(format!("{v}, {v}ok := {amp}{s}.({tn}_{last})"));
                    c.stmts.push(format!("if !{v}ok do {FAIL}"));
                    (v, fields)
                }
                None => (s.to_string(), tx.named_fields_pub(&tn, None).ok_or("struct pattern type")?),
            };
            let Fields::Named(fs) = fields else { return Err("struct pattern on a tuple variant".into()) };
            for fp in &ps.fields {
                let syn::Member::Named(id) = &fp.member else { return Err("pattern member".into()) };
                let fname = id.to_string();
                let f = fs.iter().find(|f| f.name.as_deref() == Some(fname.as_str())).ok_or("pattern field")?;
                let fsh = tx.e.shape(&f.ty, &[]);
                let place = format!("{base}.{}", crate::emit::field_ident(&fname));
                pat_into(tx, &fp.pat, &place, &fsh, mode, c)?;
            }
            Ok(())
        }
        Pat::Slice(sl) => {
            let elem = match shape {
                Shape::Vec(i) | Shape::Array(i, _) => (**i).clone(),
                _ => return Err("slice pattern on this shape".into()),
            };
            let rest = sl.elems.iter().position(|p| matches!(p, Pat::Rest(_)));
            let n = sl.elems.len() - rest.is_some() as usize;
            let cmp = if rest.is_some() { "<" } else { "!=" };
            c.stmts.push(format!("if len({s}) {cmp} {n} do {FAIL}"));
            for (i, p) in sl.elems.iter().enumerate() {
                match rest {
                    Some(r) if i == r => continue,
                    Some(r) if i > r => {
                        let from_end = sl.elems.len() - i;
                        pat_into(tx, p, &format!("{s}[len({s}) - {from_end}]"), &elem, mode, c)?;
                    }
                    _ => pat_into(tx, p, &format!("{s}[{i}]"), &elem, mode, c)?,
                }
            }
            Ok(())
        }
        Pat::Or(o) => {
            // Inside a larger pattern: any alternative, none binding (alternatives at the top are separate arms).
            if o.cases.iter().any(pat_binds) {
                return Err("nested or-pattern with bindings".into());
            }
            let ok = temp(tx, "por");
            c.stmts.push(format!("{ok} := false"));
            for alt in &o.cases {
                let mut sub = PatCode::default();
                pat_into(tx, alt, s, shape, mode, &mut sub)?;
                let label = temp(tx, "alt");
                let body: Vec<String> = sub.stmts.iter().map(|st| st.replace(FAIL, &format!("break {label}"))).collect();
                c.stmts.push(format!("if !{ok} {{ {label}: {{\n{}\n{ok} = true\n}} }}", body.join("\n")));
            }
            c.stmts.push(format!("if !{ok} do {FAIL}"));
            Ok(())
        }
        _ => Err("pattern kind".into()),
    }
}

/// Tuple-like element patterns (`(a, .., z)`, `V(a, b)`): `..` skips the middle, later patterns count from the end.
fn positional(tx: &mut Tx, elems: Vec<&Pat>, shapes: &[Shape], place: impl Fn(usize) -> String, mode: Mode, c: &mut PatCode) -> R<()> {
    let rest = elems.iter().position(|p| matches!(p, Pat::Rest(_)));
    for (i, p) in elems.iter().enumerate() {
        let idx = match rest {
            Some(r) if i == r => continue,
            Some(r) if i > r => shapes.len() - (elems.len() - i),
            _ => i,
        };
        let sh = shapes.get(idx).ok_or("pattern arity")?;
        pat_into(tx, p, &place(idx), sh, mode, c)?;
    }
    Ok(())
}

/// A path pattern: `None`, a unit variant, or a constant.
fn path_test(tx: &mut Tx, segs: &[String], s: &str, shape: &Shape, c: &mut PatCode) -> R<()> {
    let last = segs.last().cloned().unwrap_or_default();
    match (last.as_str(), shape) {
        ("None", Shape::Option(_) | Shape::OptPtr(..)) => {
            c.stmts.push(format!("if {s} != nil do {FAIL}"));
            return Ok(());
        }
        _ => {}
    }
    if let Shape::Named(tn, _) = shape {
        let tn = tn.clone();
        if let Some((unit_only, vs)) = tx.enum_variants_pub(&tn) {
            if vs.iter().any(|v| v.name == last) {
                if unit_only {
                    c.stmts.push(format!("if {s} != {tn}.{last} do {FAIL}"));
                } else {
                    c.stmts.push(format!("if !is_variant({s}, {tn}_{last}) do {FAIL}"));
                }
                return Ok(());
            }
        }
    }
    // A constant: compared by value.
    let path = syn::parse_str::<Expr>(&segs.join("::")).map_err(|_| "pattern path")?;
    if !tx.comparable_pub(shape) {
        return Err("constant pattern on a type Odin can't compare".into());
    }
    let v = tx.expr(&path, shape)?;
    c.stmts.push(format!("if {s} != {v} do {FAIL}"));
    Ok(())
}

/// Whether a pattern binds a name.
pub fn pat_binds(p: &Pat) -> bool {
    match p {
        Pat::Ident(pi) => {
            let n = pi.ident.to_string();
            pi.subpat.is_some() || !(n == "None" || n.chars().next().is_some_and(char::is_uppercase))
        }
        Pat::Or(o) => o.cases.iter().any(pat_binds),
        Pat::Paren(pp) => pat_binds(&pp.pat),
        Pat::Reference(r) => pat_binds(&r.pat),
        Pat::Struct(s) => s.fields.iter().any(|f| pat_binds(&f.pat)),
        Pat::Tuple(t) => t.elems.iter().any(pat_binds),
        Pat::TupleStruct(t) => t.elems.iter().any(pat_binds),
        Pat::Slice(s) => s.elems.iter().any(pat_binds),
        Pat::Type(t) => pat_binds(&t.pat),
        _ => false,
    }
}
