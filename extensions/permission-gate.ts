import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*777/i,
];

function canonicalizeExistingPath(targetPath: string): string {
  return existsSync(targetPath) ? realpathSync.native(targetPath) : targetPath;
}

function canonicalizeTargetPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (existsSync(resolved)) {
    return realpathSync.native(resolved);
  }

  const parent = path.dirname(resolved);
  if (existsSync(parent)) {
    return path.join(realpathSync.native(parent), path.basename(resolved));
  }

  return resolved;
}

function isOutsideCwd(cwd: string, targetPath: string): boolean {
  const base = canonicalizeExistingPath(path.resolve(cwd));
  const target = canonicalizeTargetPath(targetPath);
  const relative = path.relative(base, target);

  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function getCandidatePath(event: {
  toolName: string;
  input: Record<string, unknown>;
}): string | undefined {
  switch (event.toolName) {
    case "read":
    case "write":
    case "edit":
      return typeof event.input.path === "string"
        ? event.input.path
        : undefined;
    case "ls":
    case "find":
    case "grep": {
      const candidate = event.input.path;
      return typeof candidate === "string" ? candidate : ".";
    }
    default:
      return undefined;
  }
}

function stripShellQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function extractBashCandidatePaths(command: string): string[] {
  const matches = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  const candidates: string[] = [];

  for (const rawToken of matches) {
    const token = stripShellQuotes(rawToken).replace(/[;,]+$/, "");
    if (!token || token.startsWith("-")) continue;
    if (/^(?:[A-Za-z_][A-Za-z0-9_]*)=/.test(token)) continue;
    if (token === "." || token === "..") continue;

    if (
      token.startsWith("/") ||
      token.startsWith("~/") ||
      token.startsWith("../") ||
      token.startsWith("./../") ||
      token.includes("/../")
    ) {
      candidates.push(token);
    }
  }

  return candidates;
}

function resolveBashCandidatePath(cwd: string, candidatePath: string): string {
  if (candidatePath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "~", candidatePath.slice(2));
  }
  return path.resolve(cwd, candidatePath);
}

type PermissionContext = {
  cwd: string;
  hasUI: boolean;
  ui: { confirm(title: string, message: string): Promise<boolean> };
};

async function confirmOutsideCwdPath(
  ctx: PermissionContext,
  resolvedTarget: string,
) {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `Outside cwd access blocked: ${resolvedTarget}`,
    };
  }

  const allowed = await ctx.ui.confirm(
    "Allow outside-cwd access?",
    `The agent wants to access a path outside the current working directory.\n\ncwd: ${ctx.cwd}\npath: ${resolvedTarget}`,
  );

  if (!allowed) {
    return { block: true, reason: "Blocked by user" };
  }

  return undefined;
}

export default function permissionGateExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        `

RUNTIME PERMISSION GATE:
- For destructive shell actions or path access outside the current working directory, do not ask for confirmation in chat first.
- Proceed to the relevant tool call directly.
- Runtime permission gates will handle the user confirmation or blocking.
- Only ask follow-up questions in chat when the user's intent is ambiguous, not merely because the action is destructive.
`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command =
        typeof event.input.command === "string" ? event.input.command : "";

      if (DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: "Dangerous command blocked (no UI for confirmation)",
          };
        }

        const allowed = await ctx.ui.confirm(
          "Allow dangerous bash command?",
          `The agent wants to run a potentially dangerous shell command.\n\n${command}`,
        );

        if (!allowed) {
          return { block: true, reason: "Blocked by user" };
        }
      }

      for (const bashPath of extractBashCandidatePaths(command)) {
        const resolvedTarget = resolveBashCandidatePath(ctx.cwd, bashPath);
        if (isOutsideCwd(ctx.cwd, resolvedTarget)) {
          return await confirmOutsideCwdPath(ctx, resolvedTarget);
        }
      }

      return undefined;
    }

    const candidatePath = getCandidatePath(
      event as { toolName: string; input: Record<string, unknown> },
    );
    if (!candidatePath) return undefined;

    const resolvedTarget = path.resolve(ctx.cwd, candidatePath);
    if (!isOutsideCwd(ctx.cwd, resolvedTarget)) {
      return undefined;
    }

    return await confirmOutsideCwdPath(ctx, resolvedTarget);
  });
}
