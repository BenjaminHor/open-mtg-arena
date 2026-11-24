//! `odingen census <crates-dir>`: which Rust constructs the engine's functions use, to order the translator's work
//! by how many functions each construct unlocks (docs/odin-port.md, "How the engine logic gets ported").
use std::collections::{BTreeMap, BTreeSet};

use syn::visit::Visit;

use crate::model::Registry;

#[derive(Default)]
struct Features(BTreeSet<String>);

impl<'ast> Visit<'ast> for Features {
    fn visit_expr(&mut self, e: &'ast syn::Expr) {
        use syn::Expr::*;
        let k = match e {
            Array(_) => "array literal",
            Assign(_) => "assign",
            Async(_) => "async",
            Await(_) => "await",
            Binary(b) => match b.op {
                syn::BinOp::AddAssign(_) | syn::BinOp::SubAssign(_) | syn::BinOp::MulAssign(_) | syn::BinOp::DivAssign(_)
                | syn::BinOp::RemAssign(_) | syn::BinOp::BitOrAssign(_) | syn::BinOp::BitAndAssign(_)
                | syn::BinOp::BitXorAssign(_) | syn::BinOp::ShlAssign(_) | syn::BinOp::ShrAssign(_) => "compound assign",
                _ => "binary op",
            },
            Block(_) => "block",
            Break(_) => "break",
            Call(_) => "call",
            Cast(_) => "as cast",
            Closure(_) => "closure",
            Const(_) => "const block",
            Continue(_) => "continue",
            Field(_) => "field",
            ForLoop(_) => "for loop",
            If(i) => {
                if matches!(*i.cond, Let(_)) { "if let" } else { "if" }
            }
            Index(_) => "index",
            Let(_) => "let pattern",
            Lit(_) => "literal",
            Loop(_) => "loop",
            Macro(m) => {
                let name = m.mac.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
                self.0.insert(format!("macro {name}!"));
                "macro"
            }
            Match(_) => "match",
            MethodCall(mc) => {
                self.0.insert(format!("method .{}()", mc.method));
                "method call"
            }
            Paren(_) => "paren",
            Path(_) => "path",
            Range(_) => "range",
            Reference(r) => if r.mutability.is_some() { "&mut" } else { "&" },
            Repeat(_) => "repeat array",
            Return(_) => "return",
            Struct(s) => if s.rest.is_some() { "struct update (..)" } else { "struct literal" },
            Try(_) => "? operator",
            TryBlock(_) => "try block",
            Tuple(_) => "tuple",
            Unary(u) => match u.op { syn::UnOp::Deref(_) => "deref *", _ => "unary op" },
            Unsafe(_) => "unsafe",
            While(w) => if matches!(*w.cond, Let(_)) { "while let" } else { "while" },
            Yield(_) => "yield",
            _ => "other expr",
        };
        self.0.insert(k.to_string());
        syn::visit::visit_expr(self, e);
    }
    fn visit_local(&mut self, l: &'ast syn::Local) {
        if l.init.as_ref().map(|i| i.diverge.is_some()).unwrap_or(false) {
            self.0.insert("let else".into());
        }
        syn::visit::visit_local(self, l);
    }
    fn visit_item(&mut self, _: &'ast syn::Item) {
        self.0.insert("nested item".into());
    }
}

pub fn census(reg: &Registry, only: Option<&str>) {
    let mut per_fn: Vec<(String, BTreeSet<String>, usize)> = Vec::new();
    for ((owner, name), defs) in &reg.fns {
        for d in defs {
            let file = d.file.to_string_lossy();
            if only.is_some_and(|o| !file.contains(o)) {
                continue;
            }
            let mut f = Features::default();
            f.visit_block(&d.block);
            let block = &d.block;
            let lines = quote::quote!(#block).to_string().len() / 40;
            per_fn.push((format!("{}::{name}", owner.clone().unwrap_or_default()), f.0, lines));
        }
    }
    let total = per_fn.len();
    let mut freq: BTreeMap<String, usize> = BTreeMap::new();
    for (_, fs, _) in &per_fn {
        for f in fs {
            *freq.entry(f.clone()).or_default() += 1;
        }
    }
    println!("functions: {total}");
    // Greedily pick the construct whose support completes the most functions, given those already supported.
    let mut supported: BTreeSet<String> = BTreeSet::new();
    let mut covered = 0;
    println!("constructs in the order that completes the most functions (cumulative functions fully covered):");
    for step in 0..60 {
        let mut best: Option<(String, usize)> = None;
        for cand in freq.keys().filter(|k| !supported.contains(*k)) {
            let n = per_fn.iter().filter(|(_, fs, _)| fs.iter().all(|f| supported.contains(f) || f == cand)).count();
            if best.as_ref().map(|b| n > b.1).unwrap_or(true) {
                best = Some((cand.clone(), n));
            }
        }
        let Some((c, n)) = best else { break };
        supported.insert(c.clone());
        covered = n;
        println!("  {:>2}. {:<28} {:>6} ({:.1}%)  used by {}", step + 1, c, n, 100.0 * n as f64 / total as f64, freq[&c]);
    }
    let _ = covered;
}
