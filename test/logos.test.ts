// Diagram logos (src/shared/logos.ts): the table matches the installed pack, logos keep their own
// fills inside Pele's outline-style icon box, and saves refuse unknown names and hint at missing ones.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "pele";
import table from "../src/shared/logos.json";
import { logoRefs, logoSvg, type LogoTreatment } from "../src/shared/logos.ts";
import { buildArtifact } from "../src/worker/compile.ts";
import { loadLogoSet } from "../scripts/logo-icons.ts";
import { logoErrors, logoHints, nearLogos } from "../src/worker/logos.ts";

const ROOT = join(import.meta.dir, "..");
const PKG = join(ROOT, "node_modules/@iconify-json/logos");
const set = await loadLogoSet();
const svg = (name: string) => {
  const t = table.logos[name as keyof typeof table.logos];
  const target = t.startsWith("=") ? t.slice(1) : name;
  return logoSvg(target, set.icons[target], set.size, table.logos[target as keyof typeof table.logos] as LogoTreatment);
};

describe("logo table", () => {
  test("was made from the installed pack (bun scripts/logos.ts after a bump)", () => {
    const version = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
    expect(table.v.split("-")[0]).toBe(version);
    for (const [name, t] of Object.entries(table.logos)) {
      const target = t.startsWith("=") ? t.slice(1) : name;
      expect(set.icons[target], name).toBeDefined();
      if (t.startsWith("=")) expect(table.logos[target as keyof typeof table.logos], name).toMatch(/^[bmp]$/);
    }
  });

  test("plain names draw the square mark and common guesses resolve", () => {
    expect(table.logos.nextjs).toBe("=nextjs-icon");
    expect(table.logos.postgres).toBe("=postgresql");
    expect(table.logos.k8s).toBe("=kubernetes");
    // Marks the pack lacks, vendored from svgl.
    expect([table.logos.convex, table.logos["better-auth"], table.logos.render, table.logos.turso, table.logos.shadcn]).toEqual(["b", "p", "p", "m", "m"]);
    expect(table.logos["shadcn-ui"]).toBe("=shadcn");
    expect(svg("better-auth")).toContain('viewBox="0 0 500 500"');
  });

  test("black marks turn to the text colour; multi-colour marks that vanish on dark get a plate", () => {
    expect(table.logos["vercel-icon"]).toBe("m");
    expect(table.logos["github-icon"]).toBe("m");
    expect(table.logos.redis).toBe("p");
    // Mostly one colour, but with white lettering that recolouring would erase.
    expect(table.logos.dotnet).toBe("p");
    expect(table.logos.hono).toBe("b");
    expect(table.logos["supabase-icon"]).toBe("b");
  });
});

describe("logo markup", () => {
  test("restores the logo's own fill and stroke inside Pele's icon box", () => {
    const out = svg("hono");
    expect(out).toStartWith('<g fill="#000" stroke="none" stroke-width="1"');
    expect(out).toContain('viewBox="0 0 256 330"');
  });

  test("a one-colour mark is drawn in currentColor, keeping fill=none and other properties", () => {
    const out = logoSvg("x", { body: '<path fill="#161614" d="M0 0h1"/><path fill="none" stroke="#000" d="M0 0"/><path data-fill="keep" style="fill:#222;fill-opacity:1" d="M0 0"/>' }, 256, "m");
    expect(out).not.toContain("#161614");
    expect(out).not.toContain("#222");
    expect(out).toContain('fill="none" stroke="currentColor"');
    expect(out).toContain('data-fill="keep"');
    expect(out).toContain('style="fill:currentColor;fill-opacity:1"');
  });

  test("a plated logo sits inset on a muted square", () => {
    expect(svg("redis")).toContain('<rect width="24" height="24" rx="4" style="fill:var(--_m)"/><svg x="3" y="3" width="18" height="18"');
  });

  test("ids are the logo's own, so two logos on a page can't paint with each other's gradients", () => {
    const out = logoSvg("realm", { body: '<defs><linearGradient id="g1"/></defs><path fill="url(#g1)"/><use xlink:href="#g1"/><use href="#g1"/>' }, 256, "b");
    expect(out).toContain('id="logo-realm-g1"');
    expect(out).toContain('fill="url(#logo-realm-g1)"');
    expect(out).toContain('xlink:href="#logo-realm-g1"');
    expect(out).toContain(' href="#logo-realm-g1"');
    // Every gradient a logo in the table uses is defined under its own name.
    for (const name of ["nextjs-icon", "realm", "moon"]) {
      const markup = svg(name);
      for (const [, id] of markup.matchAll(/url\(#([^)]+)\)/g)) {
        expect(id).toStartWith(`logo-${name}-`);
        expect(markup).toContain(`id="${id}"`);
      }
    }
  });

  test("Pele draws it in architecture-beta and flowcharts, and keeps its built-in icons", async () => {
    const icons = (n: string) => (n.startsWith("logos:") ? svg(n.slice(6)) : undefined);
    const arch = await render("architecture-beta\n  service api(logos:hono)[Hono]\n  service db(database)[DB]\n  api:R --> L:db", { icons, links: false, images: false });
    expect(arch.svg).toContain('data-icon="logos:hono"');
    expect(arch.svg).toContain('viewBox="0 0 256 330"');
    expect(arch.svg).toContain('data-icon="database"');
    const flow = await render('flowchart LR\n  A@{ icon: "logos:hono", label: "Hono" } --> B[DB]', { icons, links: false, images: false });
    expect(flow.svg).toContain('viewBox="0 0 256 330"');
  });

  test("logoRefs finds each name once", () => {
    expect(logoRefs('service a(logos:hono)[A]\nB@{ icon: "logos:aws-lambda" }\nservice c(logos:hono)[C]')).toEqual(["hono", "aws-lambda"]);
    // Loose, so the save refuses a mis-cased name instead of drawing nothing.
    expect(logoRefs("service a(logos:Hono)[A]")).toEqual(["Hono"]);
  });
});

describe("save checks", () => {
  test("an unknown name is refused with the nearest ones", () => {
    const [err] = logoErrors({ "index.md": "```mermaid\narchitecture-beta\n  service db(logos:postgress)[DB]\n```" });
    expect(err.line).toBe(3);
    expect(err.message).toContain("no logo named logos:postgress; did you mean logos:postgres, logos:postgresql?");
    expect(nearLogos("nextjs")).toContain("nextjs");
    expect(logoErrors({ "index.md": "service a(logos:hono)[A]\nA@{ icon: \"logos:nextjs\" }" })).toEqual([]);
  });

  test("a mis-cased name is refused, and prose about logos isn't checked", () => {
    expect(logoErrors({ "index.md": "```mermaid\narchitecture-beta\n  service a(logos:Hono)[A]\n```" })[0].message).toContain("did you mean logos:hono");
    expect(logoErrors({ "index.md": "Write `logos:my-product` in a diagram.\n\n```mermaid\nflowchart LR\n  A --> B\n```" })).toEqual([]);
  });

  test("checks TSX diagrams and ChangeGuide maps too", () => {
    expect(logoErrors({ "page.tsx": '<Diagram code={`architecture-beta\n service a(logos:nope-nope)[A]`} />' })).toHaveLength(1);
    expect(logoErrors({ "data/guide.json": '{"map": "architecture-beta\\n service a(logos:nope-nope)[A]"}' })).toHaveLength(1);
  });

  test("products drawn with a generic icon get a hint; generic parts and lone coincidences don't", () => {
    const hints = logoHints({
      "index.md": "```mermaid\narchitecture-beta\n  service db(database)[Neon]\n  service web(server)[Next.js]\n  service q(disk)[Queue]\n  service ai(cloud)[AI]\n  service s(logos:stripe)[Stripe]\n```",
    });
    expect(hints).toEqual([
      "index.md:3: Neon has a logo, which reads faster than its label: service db(logos:neon)[Neon]",
      "index.md:4: Next.js has a logo, which reads faster than its label: service web(logos:nextjs)[Next.js]",
    ]);
    // One match in a diagram with no logos is as likely an ordinary word.
    expect(logoHints({ "index.md": "```mermaid\narchitecture-beta\n  service t(server)[Kafka]\n  service q(disk)[Queue]\n```" })).toEqual([]);
    expect(logoHints({ "index.md": "```mermaid\narchitecture-beta\n  service t(server)[Kafka]\n  service s(logos:stripe)[Stripe]\n```" })).toHaveLength(1);
  });

  test("a save with an unknown logo fails; a hint saves with a warning", async () => {
    const bad = await buildArtifact({ "index.md": "# T\n\n```mermaid\narchitecture-beta\n  service a(logos:nope-nope)[A]\n```\n" });
    expect(bad.errors.map((e) => e.message).join()).toContain("no logo named logos:nope-nope");
    const ok = await buildArtifact({ "index.md": "# T\n\n```mermaid\narchitecture-beta\n  service a(database)[Neon]\n  service b(server)[Hono]\n  a:L --> R:b\n```\n" });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings?.join()).toContain("service a(logos:neon)[Neon]");
  });
});
