// ```mermaid fences in MDX/Markdown become <Diagram code="…"/>, and their
// syntax is checked at write time so agents get Pele's error with a line
// number in the tool result instead of a broken block for viewers.
import { detectType, load, parse, PeleError, renderAsync } from "pele/lazy";
import type { CompileError } from "./compile.ts";

export type MermaidBlock = { code: string; line: number };

type Node = {
  type: string;
  lang?: string | null;
  value?: string;
  children?: Node[];
  position?: { start: { line: number } };
  [key: string]: unknown;
};

/** Data charts belong to <Chart>, which reads data files and matches the kit. */
const CHART_TYPES: Record<string, string> = {
  pie: '<Chart type="pie">',
  xychart: '<Chart type="line"> or <Chart type="bar">',
};

/** remark plugin; `out` receives every converted fence. */
export function remarkMermaid(out: MermaidBlock[]) {
  return () => (tree: Node) => {
    const visit = (node: Node) => {
      const children = node.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "code" && child.lang?.toLowerCase() === "mermaid") {
          const code = child.value ?? "";
          out.push({ code, line: child.position?.start.line ?? 0 });
          children[i] = {
            type: "mdxJsxFlowElement",
            name: "Diagram",
            attributes: [{ type: "mdxJsxAttribute", name: "code", value: code }],
            children: [],
            position: child.position,
          };
        } else visit(child);
      }
    };
    visit(tree);
  };
}

export async function checkMermaid(path: string, blocks: MermaidBlock[]): Promise<CompileError[]> {
  const errors: CompileError[] = [];
  for (const { code, line } of blocks) {
    const type = detectType(code);
    if (type && CHART_TYPES[type]) {
      errors.push({ path, line, message: `\`${type}\` is a data chart, not a diagram. Use ${CHART_TYPES[type]} with the data instead.` });
      continue;
    }
    try {
      await load(type);
      parse(code);
    } catch (err) {
      if (!(err instanceof PeleError)) throw err;
      const at = err.line ? line + err.line : line;
      errors.push({ path, line: at, message: `mermaid diagram (fence on line ${line}; Pele counts lines from the fence): ${err.message}` });
    }
  }
  return errors;
}

/** A diagram's node ids, from Pele's parse, for checking what a ChangeGuide step's `focus` names. Undefined if unknown. */
export async function mermaidNodeIds(code: string): Promise<Set<string> | undefined> {
  try {
    await load(detectType(code));
    const model = parse(code) as { nodes?: Map<string, unknown> | unknown[] };
    if (model.nodes instanceof Map) return new Set(model.nodes.keys());
  } catch {
    // checkMermaid reports syntax errors.
  }
  return undefined;
}

/** The width a diagram renders at, in px, before it is scaled to fit its card. Undefined if it can't be rendered. */
export async function mermaidWidth(code: string): Promise<number | undefined> {
  try {
    return (await renderAsync(code, { links: false, images: false })).width;
  } catch {
    return undefined;
  }
}
