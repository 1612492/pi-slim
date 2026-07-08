import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildToolText } from "../shared/tool-output.ts";

type JsonRpcId = number;

type PositionParams = {
  filePath: string;
  line: number;
  character: number;
};

type LspClient = {
  request<T>(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
  diagnostics(uri: string): Diagnostic[];
  diagnosticVersion(uri: string): number;
  supports(method: string): boolean;
};

type WorkspaceState = {
  client: Promise<LspClient>;
};

type Diagnostic = {
  message: string;
  severity?: number;
  source?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const POSITION_PARAMS = Type.Object({
  filePath: Type.String({ description: "Absolute path to the file" }),
  line: Type.Number({ description: "1-based line number" }),
  character: Type.Number({ description: "1-based character offset" }),
});

const DIAGNOSTICS_PARAMS = Type.Object({
  workspaceRoot: Type.Optional(
    Type.String({ description: "Workspace root path" }),
  ),
  filePath: Type.Optional(
    Type.String({ description: "File path to inspect first" }),
  ),
});

const WORKSPACES = new Map<string, WorkspaceState>();
const WORKSPACE_MARKERS = ["tsconfig.json", "package.json"];
const require = createRequire(import.meta.url);
const TYPESCRIPT_LANGUAGE_SERVER_BINARY = "typescript-language-server";

function toUri(filePath: string) {
  return pathToFileURL(path.resolve(filePath)).toString();
}

function pathToFileURL(filePath: string) {
  return new URL(`file://${path.resolve(filePath).replace(/#/g, "%23")}`);
}

async function pathExists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot(filePath: string) {
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

type LocationLike =
  | { uri: string; range?: { start: { line: number; character: number } } }
  | {
      targetUri?: string;
      targetRange?: { start: { line: number; character: number } };
    };

function formatLocation(loc: {
  uri: string;
  range?: { start: { line: number; character: number } };
}) {
  const filePath = new URL(loc.uri).pathname;
  const line = (loc.range?.start.line ?? 0) + 1;
  const character = (loc.range?.start.character ?? 0) + 1;
  return `${filePath}:${line}:${character}`;
}

function formatLocations(
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

function normalizeLocation(item: LocationLike): {
  uri: string;
  range?: { start: { line: number; character: number } };
} | null {
  if ("uri" in item) return item;
  if (item.targetUri) return { uri: item.targetUri, range: item.targetRange };
  return null;
}

function formatDiagnostics(filePath: string, diagnostics: Diagnostic[]) {
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

function formatDiagnosticSeverity(severity?: number) {
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

async function readFileText(filePath: string) {
  return fs.readFile(filePath, "utf8");
}

async function resolveTypescriptLanguageServerBinary() {
  let packageJsonPath: string;
  try {
    packageJsonPath =
      require.resolve("typescript-language-server/package.json");
  } catch {
    throw new Error(
      "typescript-language-server is not installed. Add it to dependencies and run pnpm install.",
    );
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf8"),
  ) as { bin?: string | Record<string, string> };
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.[TYPESCRIPT_LANGUAGE_SERVER_BINARY];

  if (!bin) {
    throw new Error(
      "typescript-language-server package does not declare a binary entry.",
    );
  }

  const binaryPath = path.resolve(packageDir, bin);
  try {
    await fs.access(binaryPath);
  } catch {
    throw new Error(
      `typescript-language-server binary not found at ${binaryPath}`,
    );
  }

  return binaryPath;
}

function encodeMessage(message: Record<string, unknown>) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function createClient(workspaceRoot: string): Promise<LspClient> {
  return createClientWithBinary(workspaceRoot);
}

async function createClientWithBinary(
  workspaceRoot: string,
): Promise<LspClient> {
  const binaryPath = await resolveTypescriptLanguageServerBinary();
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, ["--stdio"], {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let id = 0;
    const pending = new Map<
      JsonRpcId,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >();
    const diagnostics = new Map<string, Diagnostic[]>();
    const diagnosticVersions = new Map<string, number>();
    const supportedMethods = new Set<string>();
    let buffer = Buffer.alloc(0);
    let initialized = false;

    proc.once("error", reject);
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length: (\d+)/i);
        if (!match) return;
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const payload = JSON.parse(
          buffer.subarray(bodyStart, bodyStart + length).toString("utf8"),
        ) as Record<string, unknown>;
        buffer = buffer.subarray(bodyStart + length);
        if (typeof payload.id === "number" && pending.has(payload.id)) {
          const entry = pending.get(payload.id)!;
          pending.delete(payload.id);
          if (payload.error)
            entry.reject(
              new Error(
                String(
                  (payload.error as { message?: string }).message ??
                    "LSP error",
                ),
              ),
            );
          else entry.resolve(payload.result);
          continue;
        }
        if (payload.method === "textDocument/publishDiagnostics") {
          const params = payload.params as {
            uri?: string;
            diagnostics?: Diagnostic[];
          };
          if (params.uri) {
            diagnostics.set(params.uri, params.diagnostics ?? []);
            diagnosticVersions.set(
              params.uri,
              (diagnosticVersions.get(params.uri) ?? 0) + 1,
            );
          }
        }
      }
    });

    proc.stderr.on("data", () => {});

    const send = (message: Record<string, unknown>) =>
      proc.stdin.write(encodeMessage(message));
    const request = <T>(
      method: string,
      params: Record<string, unknown> | undefined,
    ) =>
      new Promise<T>((resolveReq, rejectReq) => {
        const requestId = ++id;
        pending.set(requestId, { resolve: resolveReq, reject: rejectReq });
        send({ jsonrpc: "2.0", id: requestId, method, params });
      });

    const client: LspClient = {
      request,
      notify(method, params) {
        send({ jsonrpc: "2.0", method, params });
      },
      diagnostics(uri: string) {
        return diagnostics.get(uri) ?? [];
      },
      diagnosticVersion(uri: string) {
        return diagnosticVersions.get(uri) ?? 0;
      },
      supports(method: string) {
        return supportedMethods.has(method);
      },
      async close() {
        try {
          send({ jsonrpc: "2.0", method: "shutdown", id: ++id });
          send({ jsonrpc: "2.0", method: "exit" });
        } finally {
          proc.kill();
        }
      },
    };

    void (async () => {
      const initializeResult = await request<Record<string, unknown> | null>(
        "initialize",
        {
          processId: process.pid,
          rootUri: pathToFileURL(workspaceRoot).toString(),
          capabilities: {
            textDocument: {
              publishDiagnostics: {
                relatedInformation: true,
                codeDescriptionSupport: true,
                dataSupport: true,
                tagSupport: {
                  valueSet: [1, 2],
                },
              },
            },
          },
          workspaceFolders: [
            {
              uri: pathToFileURL(workspaceRoot).toString(),
              name: path.basename(workspaceRoot),
            },
          ],
        },
      );
      const capabilities =
        (initializeResult?.capabilities as
          | Record<string, unknown>
          | undefined) ?? undefined;
      const textDocumentSync = capabilities?.textDocumentSync;
      if (
        typeof textDocumentSync === "number"
          ? textDocumentSync > 0
          : Boolean(textDocumentSync)
      ) {
        supportedMethods.add("textDocument/didOpen");
        supportedMethods.add("textDocument/didClose");
      }
      if (typeof textDocumentSync === "number" ? textDocumentSync >= 2 : true) {
        supportedMethods.add("textDocument/didSave");
      }
      const capabilityByMethod: Record<string, string> = {
        "textDocument/hover": "hoverProvider",
        "textDocument/definition": "definitionProvider",
        "textDocument/declaration": "declarationProvider",
        "textDocument/typeDefinition": "typeDefinitionProvider",
        "textDocument/implementation": "implementationProvider",
        "textDocument/references": "referencesProvider",
      };
      for (const [method, capabilityName] of Object.entries(
        capabilityByMethod,
      )) {
        if (capabilities?.[capabilityName]) {
          supportedMethods.add(method);
        }
      }
      client.notify("initialized", {});
      initialized = true;
      resolve({
        ...client,
      });
    })().catch(reject);

    proc.on("close", () => {
      if (!initialized)
        reject(
          new Error("typescript-language-server exited before initialize"),
        );
    });
  });
}

async function getClient(filePath: string) {
  const workspaceRoot = await findWorkspaceRoot(filePath);
  const existing = WORKSPACES.get(workspaceRoot);
  if (existing) return existing.client;
  const client = createClient(workspaceRoot);
  WORKSPACES.set(workspaceRoot, { client });
  return client;
}

async function withDocument<T>(
  filePath: string,
  fn: (client: LspClient, uri: string) => Promise<T>,
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

function formatUnsupportedMethod(method: string) {
  return `LSP server does not advertise support for ${method}.`;
}

async function requestLocations(method: string, params: PositionParams) {
  return withDocument(params.filePath, async (client, uri) => {
    if (!client.supports(method)) return formatUnsupportedMethod(method);
    const result = await client.request<
      Array<LocationLike> | LocationLike | null
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
    if (!client.supports("textDocument/hover")) {
      return `File: ${params.filePath}\n\n${formatUnsupportedMethod("textDocument/hover")}`;
    }
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
  if (client.supports("textDocument/didSave")) {
    client.notify("textDocument/didSave", {
      textDocument: { uri },
      text,
    });
  }

  try {
    while (
      client.diagnosticVersion(uri) <= diagnosticVersionBeforeOpen &&
      Date.now() < overallDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

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

export default function lspExtension(_pi: ExtensionAPI): void {
  _pi.registerTool(createLspHoverTool());
  _pi.registerTool(createLspDefinitionTool());
  _pi.registerTool(createLspDeclarationTool());
  _pi.registerTool(createLspTypeDefinitionTool());
  _pi.registerTool(createLspImplementationTool());
  _pi.registerTool(createLspReferencesTool());
  _pi.registerTool(createLspDiagnosticsTool());
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

export function createLspDefinitionTool() {
  return createLocationTool(
    "lsp_definition",
    "textDocument/definition",
    "Find TypeScript definitions for a file position.",
  );
}

export function createLspDeclarationTool() {
  return createLocationTool(
    "lsp_declaration",
    "textDocument/declaration",
    "Find TypeScript declarations for a file position.",
  );
}

export function createLspTypeDefinitionTool() {
  return createLocationTool(
    "lsp_type_definition",
    "textDocument/typeDefinition",
    "Find TypeScript type definitions for a file position.",
  );
}

export function createLspImplementationTool() {
  return createLocationTool(
    "lsp_implementation",
    "textDocument/implementation",
    "Find TypeScript implementations for a file position.",
  );
}

export function createLspReferencesTool() {
  return createLocationTool(
    "lsp_references",
    "textDocument/references",
    "Find TypeScript references for a file position.",
  );
}

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
