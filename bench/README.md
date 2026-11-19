# Benchmarks

`baseline.json` is what `pnpm bench` compares against (docs/testing.md, section 6; D-049). It holds each measure's time
per operation in milliseconds and as a multiple of the reference loop, which is what's compared, plus the machine it
was made on. Update it only with `pnpm bench --update`, for a slowdown that's justified, and say why in the commit.
