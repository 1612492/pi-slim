import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import permissionGateExtension from "./index.ts";

const originalOverride = process.env.PI_PERMISSION_GATE_OVERRIDE;

afterEach(() => {
  process.env.PI_PERMISSION_GATE_OVERRIDE = originalOverride;
});

function setupExtension() {
  const handlers = new Map<
    string,
    (event?: unknown, ctx?: unknown) => unknown
  >();

  const pi = {
    on: vi.fn(
      (name: string, handler: (event?: unknown, ctx?: unknown) => unknown) => {
        handlers.set(name, handler);
      },
    ),
  } as unknown as ExtensionAPI;

  permissionGateExtension(pi);

  const handler = handlers.get("tool_call");
  if (!handler) throw new Error("tool_call handler was not registered");

  return { handler };
}

function createCtx(hasUI: boolean) {
  return {
    cwd: "/repo",
    hasUI,
    ui: { confirm: vi.fn().mockResolvedValue(true) },
  };
}

describe("permission-gate extension", () => {
  it("allows normal reads inside cwd", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/repo/src/index.ts" } },
      ctx,
    );

    expect(result).toBeUndefined();
  });

  it("blocks .env reads even inside cwd", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/repo/.env" } },
      ctx,
    );

    expect(result).toEqual({
      block: true,
      reason:
        'PERMISSION_REQUIRED:{"kind":"sensitive-file","path":"/repo/.env"}',
    });
  });

  it("blocks .env.local reads even inside cwd", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/repo/.env.local" } },
      ctx,
    );

    expect(result).toEqual({
      block: true,
      reason:
        'PERMISSION_REQUIRED:{"kind":"sensitive-file","path":"/repo/.env.local"}',
    });
  });

  it("allows .env.example reads inside cwd", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/repo/.env.example" } },
      ctx,
    );

    expect(result).toBeUndefined();
  });

  it("blocks outside-cwd reads using filePath", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/other/file.txt" } },
      ctx,
    );

    expect(result).toEqual({
      block: true,
      reason:
        'PERMISSION_REQUIRED:{"kind":"outside-cwd","path":"/other/file.txt"}',
    });
  });

  it("blocks sensitive bash candidate paths without UI", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "bash", input: { command: "cat ./.env.local" } },
      ctx,
    );

    expect(result).toEqual({
      block: true,
      reason:
        'PERMISSION_REQUIRED:{"kind":"sensitive-file","path":"/repo/.env.local"}',
    });
  });

  it("blocks outside-cwd bash candidate paths without UI", async () => {
    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "bash", input: { command: "cat ../secret.txt" } },
      ctx,
    );

    expect(result).toEqual({
      block: true,
      reason: 'PERMISSION_REQUIRED:{"kind":"outside-cwd","path":"/secret.txt"}',
    });
  });

  it("allows exact-path overrides for no-UI sensitive-file blocks", async () => {
    process.env.PI_PERMISSION_GATE_OVERRIDE = JSON.stringify({
      kind: "sensitive-file",
      path: "/repo/.env.local",
    });

    const { handler } = setupExtension();
    const ctx = createCtx(false);

    const result = await handler(
      { toolName: "read", input: { filePath: "/repo/.env.local" } },
      ctx,
    );

    expect(result).toBeUndefined();
  });
});
