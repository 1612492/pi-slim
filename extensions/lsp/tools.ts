import { defineTool } from "@earendil-works/pi-coding-agent";
import { buildToolText } from "../shared/tool-output.ts";
import type { PositionParams } from "./types.ts";
import {
  DIAGNOSTICS_PARAMS,
  POSITION_PARAMS,
  formatDiagnostics,
  formatLocations,
  normalizeLocation,
  toUri,
} from "./helpers.ts";
import { getClient } from "./client.ts";

async function readFileText(filePath: string) {
  return (await import("node:fs/promises")).readFile(filePath, "utf8");
}
function formatUnsupportedMethod(method: string) {
  return `LSP server does not advertise support for ${method}.`;
}
async function withDocument<T>(
  filePath: string,
  fn: (
    client: Awaited<ReturnType<typeof getClient>>,
    uri: string,
  ) => Promise<T>,
) {
  const client = await getClient(filePath);
  const uri = toUri(filePath);
  const text = await readFileText(filePath);
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typescript", version: 1, text },
  });
  try {
    return await fn(client, uri);
  } finally {
    client.notify("textDocument/didClose", { textDocument: { uri } });
  }
}
async function requestLocations(method: string, params: PositionParams) {
  return withDocument(params.filePath, async (client, uri) => {
    if (!client.supports(method)) return formatUnsupportedMethod(method);
    const result = await client.request<
      | Array<import("./types.ts").LocationLike>
      | import("./types.ts").LocationLike
      | null
    >(method, {
      textDocument: { uri },
      position: { line: params.line - 1, character: params.character - 1 },
      context:
        method === "textDocument/references"
          ? { includeDeclaration: true }
          : undefined,
    });
    const items = (Array.isArray(result) ? result : result ? [result] : [])
      .map(normalizeLocation)
      .filter(
        (
          item,
        ): item is {
          uri: string;
          range?: { start: { line: number; character: number } };
        } => Boolean(item),
      );
    return formatLocations(items);
  });
}
async function requestHover(params: PositionParams) {
  return withDocument(params.filePath, async (client, uri) => {
    if (!client.supports("textDocument/hover"))
      return `File: ${params.filePath}\n\n${formatUnsupportedMethod("textDocument/hover")}`;
    const result = await client.request<{ contents?: unknown } | null>(
      "textDocument/hover",
      {
        textDocument: { uri },
        position: { line: params.line - 1, character: params.character - 1 },
      },
    );
    if (!result)
      return `File: ${params.filePath}\n\nNo hover information available.`;
    return [
      `File: ${params.filePath}`,
      "",
      typeof result.contents === "string"
        ? result.contents
        : JSON.stringify(result.contents, null, 2),
    ].join("\n");
  });
}
async function collectDiagnostics(filePath: string) {
  const client = await getClient(filePath);
  const uri = toUri(filePath);
  const text = await readFileText(filePath);
  const diagnosticVersionBeforeOpen = client.diagnosticVersion(uri);
  const overallDeadline = Date.now() + 8000;
  const settleWindowMs = 1500;
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typescript", version: 1, text },
  });
  if (client.supports("textDocument/didSave"))
    client.notify("textDocument/didSave", { textDocument: { uri }, text });
  try {
    while (
      client.diagnosticVersion(uri) <= diagnosticVersionBeforeOpen &&
      Date.now() < overallDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (client.diagnosticVersion(uri) <= diagnosticVersionBeforeOpen) {
      const diagnostics = client.diagnostics(uri);
      if (diagnostics.length > 0)
        return formatDiagnostics(filePath, diagnostics);
      return `File: ${filePath}\n\nNo diagnostics reported.`;
    }
    let lastSeenVersion = client.diagnosticVersion(uri);
    let settleDeadline = Math.min(Date.now() + settleWindowMs, overallDeadline);
    while (Date.now() < settleDeadline && Date.now() < overallDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const nextVersion = client.diagnosticVersion(uri);
      if (nextVersion > lastSeenVersion) {
        lastSeenVersion = nextVersion;
        settleDeadline = Math.min(Date.now() + settleWindowMs, overallDeadline);
      }
    }
    return formatDiagnostics(filePath, client.diagnostics(uri));
  } finally {
    client.notify("textDocument/didClose", { textDocument: { uri } });
  }
}
function createLocationTool(name: string, method: string, description: string) {
  return defineTool({
    name,
    label: name,
    description,
    parameters: POSITION_PARAMS,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      const text = await requestLocations(method, params as PositionParams);
      const result = buildToolText(
        {
          filePath: params.filePath,
          line: params.line,
          character: params.character,
        },
        text,
      );
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });
}
export function createLspHoverTool() {
  return defineTool({
    name: "lsp_hover",
    label: "lsp_hover",
    description: "Get TypeScript hover information for a file position.",
    parameters: POSITION_PARAMS,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      const text = await requestHover(params as PositionParams);
      const result = buildToolText(
        {
          filePath: params.filePath,
          line: params.line,
          character: params.character,
        },
        text,
      );
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });
}
export const createLspDefinitionTool = () =>
  createLocationTool(
    "lsp_definition",
    "textDocument/definition",
    "Find TypeScript definitions for a file position.",
  );
export const createLspDeclarationTool = () =>
  createLocationTool(
    "lsp_declaration",
    "textDocument/declaration",
    "Find TypeScript declarations for a file position.",
  );
export const createLspTypeDefinitionTool = () =>
  createLocationTool(
    "lsp_type_definition",
    "textDocument/typeDefinition",
    "Find TypeScript type definitions for a file position.",
  );
export const createLspImplementationTool = () =>
  createLocationTool(
    "lsp_implementation",
    "textDocument/implementation",
    "Find TypeScript implementations for a file position.",
  );
export const createLspReferencesTool = () =>
  createLocationTool(
    "lsp_references",
    "textDocument/references",
    "Find TypeScript references for a file position.",
  );
export function createLspDiagnosticsTool() {
  return defineTool({
    name: "lsp_diagnostics",
    label: "lsp_diagnostics",
    description: "Read TypeScript diagnostics for a file.",
    parameters: DIAGNOSTICS_PARAMS,
    async execute(_toolCallId, params) {
      if (!params.filePath) throw new Error("filePath is required");
      const text = await collectDiagnostics(params.filePath);
      const result = buildToolText({ filePath: params.filePath }, text);
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });
}
