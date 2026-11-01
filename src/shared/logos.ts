// Product logos in diagrams: `service db(logos:postgresql)[Neon]` in architecture-beta, or
// `A@{ icon: "logos:hono", label: "Hono" }` in a flowchart. The names and how each is drawn on
// the dark theme are in logos.json (bun scripts/logos.ts); scripts/build-kit.ts writes one small
// module per name under /kit/v1/logos/<digest>/, and the diagram loads only the ones it names.

/** Every `logos:<name>` a diagram's source names, once each, in order. Loose, so a save can refuse `logos:Hono`. */
export function logoRefs(code: string): string[] {
  return [...new Set([...code.matchAll(/\blogos:([\w.-]+)/g)].map((m) => m[1].replace(/[.-]+$/, "")))];
}

/** A name a logo module can have; anything else is refused before it reaches a URL. */
export const LOGO_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** How a logo is drawn on the kit's dark surface: as is, in the text colour, or on a muted plate. */
export type LogoTreatment = "b" | "m" | "p";

type Icon = { body: string; width?: number; height?: number; left?: number; top?: number };

const PAINT_ATTR = /(\s)(fill|stroke|stop-color)="(?!none")[^"]*"/g;
const STYLE_ATTR = /(\s)style="([^"]*)"/g;
const PAINT_DECL = /(^|;)(\s*)(fill|stroke|stop-color)(\s*):(?!\s*none\b)[^;]*/g;

/** The paints a logo names in its markup (attributes and inline styles), other than none. */
export function logoPaints(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/\s(?:fill|stroke|stop-color)="([^"]*)"/g)) out.add(m[1].toLowerCase());
  for (const [, , css] of body.matchAll(STYLE_ATTR)) for (const m of css.matchAll(/(?:^|;)\s*(?:fill|stroke|stop-color)\s*:\s*([^;]*)/g)) out.add(m[1].trim().toLowerCase());
  out.delete("none");
  return out;
}

/**
 * A logo as markup for Pele's 24-unit icon box. Pele draws icons inside `fill="none"
 * stroke="currentColor" stroke-width="2"`, which would turn a logo that relies on SVG's default
 * black fill into an outline, so the logo's own defaults are restored first. Ids get the logo's
 * name as a prefix: logos share one document, and some in the pack reuse the same gradient ids.
 */
export function logoSvg(name: string, icon: Icon, packSize: number, treatment: LogoTreatment): string {
  const w = icon.width ?? packSize, h = icon.height ?? packSize;
  const box = `viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}"`;
  const reset = `stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter"`;
  let body = icon.body
    .replace(/(\s)id="([^"]+)"/g, `$1id="logo-${name}-$2"`)
    .replace(/url\(#([^)]+)\)/g, `url(#logo-${name}-$1)`)
    .replace(/(\s(?:xlink:)?href)="#([^"]+)"/g, `$1="#logo-${name}-$2"`);
  if (treatment === "m") {
    // One-colour marks take the text colour, as brands draw their black marks on dark grounds.
    body = body
      .replace(PAINT_ATTR, '$1$2="currentColor"')
      .replace(STYLE_ATTR, (_, sp: string, css: string) => `${sp}style="${css.replace(PAINT_DECL, "$1$2$3$4:currentColor")}"`);
    return `<g fill="currentColor" ${reset}><svg width="24" height="24" ${box}>${body}</svg></g>`;
  }
  if (treatment === "p") {
    // The plate is the muted text colour, not moon white: moon white is the agent's light.
    return `<g fill="#000" ${reset}><rect width="24" height="24" rx="4" style="fill:var(--_m)"/><svg x="3" y="3" width="18" height="18" ${box}>${body}</svg></g>`;
  }
  return `<g fill="#000" ${reset}><svg width="24" height="24" ${box}>${body}</svg></g>`;
}
