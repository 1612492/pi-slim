import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import type { Diagnostic, LocationLike } from "./types.ts";

export const POSITION_PARAMS = Type.Object({
  filePath: Type.String({ description: "Absolute path to the file" }),
  line: Type.Number({ description: "1-based line number" }),
  character: Type.Number({ description: "1-based character offset" }),
});

export const DIAGNOSTICS_PARAMS = Type.Object({
  workspaceRoot: Type.Optional(
    Type.String({ description: "Workspace root path" }),
  ),
  filePath: Type.Optional(
    Type.String({ description: "File path to inspect first" }),
  ),
});

export const WORKSPACE_MARKERS = ["tsconfig.json", "package.json"];

export function pathToFileURL(filePath: string) {
  return new URL(`file://${path.resolve(filePath).replace(/#/g, "%23")}`);
}
export function toUri(filePath: string) {
  return pathToFileURL(path.resolve(filePath)).toString();
}
export async function pathExists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
export async function findWorkspaceRoot(filePath: string) {
  let current = path.dirname(path.resolve(filePath));
  const parsed = path.parse(current);
  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      if (await pathExists(path.join(current, marker))) return current;
    }
    if (current === parsed.root) break;
    current = path.dirname(current);
  }
  return path.dirname(path.resolve(filePath));
}
export function formatLocation(loc: {
  uri: string;
  range?: { start: { line: number; character: number } };
}) {
  const filePath = new URL(loc.uri).pathname;
  const line = (loc.range?.start.line ?? 0) + 1;
  const character = (loc.range?.start.character ?? 0) + 1;
  return `${filePath}:${line}:${character}`;
}
export function formatLocations(
  items: Array<{
    uri: string;
    range?: { start: { line: number; character: number } };
  }>,
) {
  if (items.length === 0) return "No results found.";
  return items
    .map((item, index) => `${index + 1}. ${formatLocation(item)}`)
    .join("\n");
}
export function normalizeLocation(item: LocationLike): {
  uri: string;
  range?: { start: { line: number; character: number } };
} | null {
  if ("uri" in item) return item;
  if (item.targetUri) return { uri: item.targetUri, range: item.targetRange };
  return null;
}
export function formatDiagnosticSeverity(severity?: number) {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return undefined;
  }
}
export function formatDiagnostics(filePath: string, diagnostics: Diagnostic[]) {
  if (diagnostics.length === 0)
    return `File: ${filePath}\n\nNo diagnostics reported.`;
  return [
    `File: ${filePath}`,
    "",
    ...diagnostics.map((diag, index) => {
      const loc = diag.range
        ? `${diag.range.start.line + 1}:${diag.range.start.character + 1}`
        : "?";
      const severity = formatDiagnosticSeverity(diag.severity);
      return `${index + 1}. ${loc}${severity ? ` [${severity}]` : ""} ${diag.message}${diag.source ? ` (${diag.source})` : ""}`;
    }),
  ].join("\n");
}
