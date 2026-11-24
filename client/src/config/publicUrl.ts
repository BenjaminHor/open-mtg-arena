/**
 * The URL of a file in `public/`, under the site's base path: "/" locally, "/open-mtg-arena/" on GitHub Pages (Vite's
 * `base`, set from BASE_PATH at build time). Every reference to a public file goes through here, so the app works
 * from a subpath.
 */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
