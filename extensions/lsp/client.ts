import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import type {
  Diagnostic,
  JsonRpcId,
  LspClient,
  WorkspaceState,
} from "./types.ts";
import { findWorkspaceRoot, pathToFileURL } from "./helpers.ts";

const require = createRequire(import.meta.url);
const TYPESCRIPT_LANGUAGE_SERVER_BINARY = "typescript-language-server";
const WORKSPACES = new Map<string, WorkspaceState>();

function encodeMessage(message: Record<string, unknown>) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
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
  if (!bin)
    throw new Error(
      "typescript-language-server package does not declare a binary entry.",
    );
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

export async function getClient(filePath: string) {
  const workspaceRoot = await findWorkspaceRoot(filePath);
  const existing = WORKSPACES.get(workspaceRoot);
  if (existing) return existing.client;
  const client = createClient(workspaceRoot);
  WORKSPACES.set(workspaceRoot, { client });
  return client;
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
                tagSupport: { valueSet: [1, 2] },
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
      if (typeof textDocumentSync === "number" ? textDocumentSync >= 2 : true)
        supportedMethods.add("textDocument/didSave");
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
        if (capabilities?.[capabilityName]) supportedMethods.add(method);
      }
      client.notify("initialized", {});
      initialized = true;
      resolve({ ...client });
    })().catch(reject);
    proc.on("close", () => {
      if (!initialized)
        reject(
          new Error("typescript-language-server exited before initialize"),
        );
    });
  });
}
