import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import lspExtension, {
  createLspDeclarationTool,
  createLspDefinitionTool,
  createLspDiagnosticsTool,
  createLspHoverTool,
  createLspImplementationTool,
  createLspReferencesTool,
  createLspTypeDefinitionTool,
} from "./index.ts";

const spawnMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: resolveMock }),
}));

function encodeMessage(message: Record<string, unknown>) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function createFakeServer(options?: {
  publishDiagnostics?: boolean;
  diagnosticsSequence?: Array<{
    delayMs?: number;
    diagnostics: Array<Record<string, unknown>>;
  }>;
  publishDiagnosticsOn?: "didOpen" | "didSave";
  capabilities?: Record<string, unknown>;
}) {
  const publishDiagnostics = options?.publishDiagnostics !== false;
  const diagnosticsSequence = options?.diagnosticsSequence;
  const capabilities = options?.capabilities ?? {
    textDocumentSync: 2,
    hoverProvider: true,
    definitionProvider: true,
    declarationProvider: true,
    typeDefinitionProvider: true,
    implementationProvider: true,
    referencesProvider: true,
  };
  const publishDiagnosticsOn =
    options?.publishDiagnosticsOn === "didSave"
      ? "textDocument/didSave"
      : "textDocument/didOpen";
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  (proc as any).messages = [];
  let buffer = "";
  proc.stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) return;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const payload = JSON.parse(buffer.slice(bodyStart, bodyStart + length));
      buffer = buffer.slice(bodyStart + length);
      (proc as any).messages.push(payload);
      if (payload.method === "initialize") {
        setImmediate(() =>
          proc.stdout.write(
            encodeMessage({
              jsonrpc: "2.0",
              id: payload.id,
              result: {
                capabilities,
              },
            }),
          ),
        );
      }
      if (payload.method === "textDocument/references") {
        setImmediate(() =>
          proc.stdout.write(
            encodeMessage({
              jsonrpc: "2.0",
              id: payload.id,
              result: [
                {
                  targetUri: "file:///tmp/ref.ts",
                  targetRange: { start: { line: 1, character: 2 } },
                },
              ],
            }),
          ),
        );
      }
      if (payload.method === "shutdown") {
        setImmediate(() =>
          proc.stdout.write(
            encodeMessage({ jsonrpc: "2.0", id: payload.id, result: null }),
          ),
        );
      }
      if (payload.method === publishDiagnosticsOn && publishDiagnostics) {
        const sequence = diagnosticsSequence ?? [
          {
            diagnostics: [
              {
                message: "boom",
                severity: 3,
                range: {
                  start: { line: 0, character: 1 },
                  end: { line: 0, character: 2 },
                },
              },
            ],
          },
        ];
        for (const item of sequence) {
          setTimeout(
            () =>
              proc.stdout.write(
                encodeMessage({
                  jsonrpc: "2.0",
                  method: "textDocument/publishDiagnostics",
                  params: {
                    uri: payload.params.textDocument.uri,
                    diagnostics: item.diagnostics,
                  },
                }),
              ),
            item.delayMs ?? 0,
          );
        }
      }
    }
  });
  return proc;
}

describe("lsp tools", () => {
  it("registers the expected tool set", () => {
    const registerTool = vi.fn();
    lspExtension({ registerTool } as never);

    expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
      "lsp_hover",
      "lsp_definition",
      "lsp_declaration",
      "lsp_type_definition",
      "lsp_implementation",
      "lsp_references",
      "lsp_diagnostics",
    ]);
  });

  it("exposes the seven tool factories", () => {
    expect(createLspHoverTool().name).toBe("lsp_hover");
    expect(createLspDefinitionTool().name).toBe("lsp_definition");
    expect(createLspDeclarationTool().name).toBe("lsp_declaration");
    expect(createLspTypeDefinitionTool().name).toBe("lsp_type_definition");
    expect(createLspImplementationTool().name).toBe("lsp_implementation");
    expect(createLspReferencesTool().name).toBe("lsp_references");
    expect(createLspDiagnosticsTool().name).toBe("lsp_diagnostics");
  });

  it("uses the nearest workspace root, sends references context, and waits for diagnostics", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-"));
    const project = path.join(tmp, "proj");
    const nested = path.join(project, "src", "nested");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), "{}");
    const filePath = path.join(nested, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    const packageJsonPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "package.json",
    );
    const binaryPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "bin",
      "cli.mjs",
    );
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ bin: { "typescript-language-server": "bin/cli.mjs" } }),
    );
    await fs.writeFile(binaryPath, "#!/usr/bin/env node\n");
    resolveMock.mockReturnValueOnce(packageJsonPath);

    const proc = createFakeServer();
    spawnMock.mockReturnValue(proc);

    const references = createLspReferencesTool();
    const diagnostics = createLspDiagnosticsTool();
    await (references.execute as any)(
      "1",
      { filePath, line: 1, character: 1 },
      undefined,
      undefined,
      undefined,
    );
    expect(spawnMock.mock.calls[0][1]).toEqual(["--stdio"]);
    expect(spawnMock.mock.calls[0][0]).toBe(binaryPath);
    expect((spawnMock.mock.calls[0][2] as { cwd: string }).cwd).toBe(project);

    const initializeMessage = (proc as any).messages.find(
      (message: { method?: string }) => message.method === "initialize",
    );
    expect(
      initializeMessage?.params?.capabilities?.textDocument?.publishDiagnostics,
    ).toBeTruthy();

    expect(JSON.stringify((proc as any).messages)).toContain(
      "includeDeclaration",
    );

    const diag = await (diagnostics.execute as any)(
      "2",
      { filePath },
      undefined,
      undefined,
      undefined,
    );
    expect(JSON.stringify(diag.content)).toContain("[info] boom");
    expect(JSON.stringify((proc as any).messages)).toContain("didClose");
  }, 10000);

  it("fails clearly when the local package is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-missing-"));
    const filePath = path.join(tmp, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    resolveMock.mockImplementationOnce(() => {
      throw new Error("missing");
    });

    await expect(
      (createLspHoverTool().execute as any)("1", {
        filePath,
        line: 1,
        character: 1,
      }),
    ).rejects.toThrow("typescript-language-server is not installed");
  });

  it("returns the latest settled diagnostics after multiple publish events", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-settle-"));
    const project = path.join(tmp, "proj");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), "{}");
    const filePath = path.join(project, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    const packageJsonPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "package.json",
    );
    const binaryPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "bin",
      "cli.mjs",
    );
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ bin: { "typescript-language-server": "bin/cli.mjs" } }),
    );
    await fs.writeFile(binaryPath, "#!/usr/bin/env node\n");
    resolveMock.mockReturnValueOnce(packageJsonPath);

    const proc = createFakeServer({
      diagnosticsSequence: [
        { diagnostics: [] },
        {
          delayMs: 50,
          diagnostics: [
            {
              message: "deprecated api",
              severity: 4,
              range: {
                start: { line: 2, character: 3 },
                end: { line: 2, character: 6 },
              },
            },
          ],
        },
      ],
    });
    spawnMock.mockReturnValue(proc);

    const diagnostics = createLspDiagnosticsTool();
    const diag = await (diagnostics.execute as any)(
      "4",
      { filePath },
      undefined,
      undefined,
      undefined,
    );

    expect(JSON.stringify(diag.content)).toContain("[hint] deprecated api");
  }, 10000);

  it("captures diagnostics that are only published after didSave", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-save-"));
    const project = path.join(tmp, "proj");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), "{}");
    const filePath = path.join(project, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    const packageJsonPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "package.json",
    );
    const binaryPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "bin",
      "cli.mjs",
    );
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ bin: { "typescript-language-server": "bin/cli.mjs" } }),
    );
    await fs.writeFile(binaryPath, "#!/usr/bin/env node\n");
    resolveMock.mockReturnValueOnce(packageJsonPath);

    const proc = createFakeServer({
      publishDiagnosticsOn: "didSave",
      diagnosticsSequence: [
        {
          diagnostics: [
            {
              message: "save-triggered diagnostic",
              severity: 2,
              range: {
                start: { line: 4, character: 5 },
                end: { line: 4, character: 8 },
              },
            },
          ],
        },
      ],
    });
    spawnMock.mockReturnValue(proc);

    const diagnostics = createLspDiagnosticsTool();
    const diag = await (diagnostics.execute as any)(
      "5",
      { filePath },
      undefined,
      undefined,
      undefined,
    );

    expect(JSON.stringify(diag.content)).toContain(
      "[warning] save-triggered diagnostic",
    );
    expect(JSON.stringify((proc as any).messages)).toContain("didSave");
  }, 10000);

  it("returns no diagnostics when the server stays silent", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-timeout-"));
    const project = path.join(tmp, "proj");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), "{}");
    const filePath = path.join(project, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    const packageJsonPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "package.json",
    );
    const binaryPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "bin",
      "cli.mjs",
    );
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ bin: { "typescript-language-server": "bin/cli.mjs" } }),
    );
    await fs.writeFile(binaryPath, "#!/usr/bin/env node\n");
    resolveMock.mockReturnValueOnce(packageJsonPath);

    const proc = createFakeServer({ publishDiagnostics: false });
    spawnMock.mockReturnValue(proc);

    const diagnostics = createLspDiagnosticsTool();
    const diag = await (diagnostics.execute as any)(
      "3",
      { filePath },
      undefined,
      undefined,
      undefined,
    );

    expect(JSON.stringify(diag.content)).toContain("No diagnostics reported.");
    expect(JSON.stringify((proc as any).messages)).toContain("didClose");
  }, 10000);

  it("returns an unsupported message when declaration is not advertised", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lsp-decl-"));
    const project = path.join(tmp, "proj");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), "{}");
    const filePath = path.join(project, "file.ts");
    await fs.writeFile(filePath, "const x = 1;\n");
    const packageJsonPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "package.json",
    );
    const binaryPath = path.join(
      project,
      "node_modules",
      "typescript-language-server",
      "bin",
      "cli.mjs",
    );
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ bin: { "typescript-language-server": "bin/cli.mjs" } }),
    );
    await fs.writeFile(binaryPath, "#!/usr/bin/env node\n");
    resolveMock.mockReturnValueOnce(packageJsonPath);

    const proc = createFakeServer({
      capabilities: {
        textDocumentSync: 2,
        hoverProvider: true,
        definitionProvider: true,
        typeDefinitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
      },
    });
    spawnMock.mockReturnValue(proc);

    const declaration = createLspDeclarationTool();
    const result = await (declaration.execute as any)(
      "6",
      { filePath, line: 1, character: 1 },
      undefined,
      undefined,
      undefined,
    );

    expect(JSON.stringify(result.content)).toContain(
      "does not advertise support for textDocument/declaration",
    );
  }, 10000);
});
