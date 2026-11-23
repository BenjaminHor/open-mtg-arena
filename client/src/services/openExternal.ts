/** The single URL authority for document and direct external-link routing. */
export function isOpenableExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Open a validated HTTP(S) URL in the user's default browser. */
export function openExternal(url: string): void {
  if (!isOpenableExternalUrl(url)) return;

  window.open(url, "_blank", "noopener,noreferrer");
}
