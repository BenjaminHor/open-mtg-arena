/**
 * Copy `text` to the clipboard, reporting whether the write actually happened.
 * Callers that assume success paint a "copied" confirmation over a clipboard
 * that never changed, so the result is returned rather than thrown away.
 *
 * The async clipboard API goes first, where it is the supported path; the
 * `execCommand("copy")` fallback covers a missing or rejecting clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // Reaching through a missing `navigator.clipboard` throws synchronously
    // here, so one catch covers both "absent" and "rejected".
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // `execCommand("copy")` copies the selection, and an element that is
  // `display:none` or detached cannot hold one — so it has to be in the
  // document and merely invisible.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  // `select()` takes focus in a real engine; hand it back so copying does not
  // knock the user out of whatever they were typing in.
  const previous = document.activeElement;
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}
