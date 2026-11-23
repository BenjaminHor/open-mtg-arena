// Text with mana symbols in it ("Add {G}", "{2}{R}, {T}") drawn as symbols, never as letters in braces: each a small
// disc in its colour with its letter or number on it, so the shape and the letter carry it, not the colour alone
// (ui.md, "Never color alone").

const SYMBOL = /(\{[^}]+\})/;

export function ManaText({ text }: { text: string }) {
  // The parts of one label never reorder, so their position is a stable key.
  const parts = text.split(SYMBOL).map((part, at) => ({ part, key: `${at}:${part}` }));
  return (
    <>
      {parts.map(({ part, key }) => {
        const symbol = /^\{([^}]+)\}$/.exec(part)?.[1];
        if (symbol === undefined) return <span key={key}>{part}</span>;
        return (
          <span
            key={key}
            className={`mana-sym mana-${symbol}`}
            role="img"
            aria-label={symbol === "T" ? "tap" : `${symbol} mana`}
          >
            {symbol === "T" ? "↷" : symbol}
          </span>
        );
      })}
    </>
  );
}
