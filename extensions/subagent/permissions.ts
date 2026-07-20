import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";

export type PermissionRequired = {
  kind: "outside-cwd" | "sensitive-file";
  path: string;
};
export type PermissionPreflight = PermissionRequired;

export function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const p of m.content) if (p.type === "text") return p.text;
  }
  return "";
}

function isSensitiveEnvPath(targetPath: string) {
  const base = path.basename(targetPath);
  return (
    base === ".env" || (base.startsWith(".env.") && base !== ".env.example")
  );
}
function isOutsideCwd(cwd: string, targetPath: string) {
  const rel = path.relative(path.resolve(cwd), path.resolve(targetPath));
  return (
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
  );
}
function extractExplicitPathTokens(text: string) {
  return (text.match(/"[^"]+"|'[^']+'|\S+/g) ?? [])
    .map((raw) => raw.replace(/^['"]|['"]$/g, "").replace(/[;,]+$/, ""))
    .filter(
      (t) =>
        t &&
        !t.startsWith("-") &&
        !t.includes("{") &&
        !t.includes("}") &&
        (t.startsWith("/") ||
          t.startsWith("~/") ||
          t.startsWith("./") ||
          t.startsWith("../") ||
          t.startsWith(".env")),
    );
}
function resolveExplicitPath(cwd: string, token: string) {
  return token.startsWith("~/")
    ? path.join(process.env.HOME ?? "~", token.slice(2))
    : path.resolve(cwd, token);
}

export function getPreflightPermissionFromTask(
  cwd: string,
  task: string,
): PermissionPreflight | undefined {
  for (const token of extractExplicitPathTokens(task)) {
    const resolved = resolveExplicitPath(cwd, token);
    if (isSensitiveEnvPath(resolved))
      return { kind: "sensitive-file", path: resolved };
    if (isOutsideCwd(cwd, resolved))
      return { kind: "outside-cwd", path: resolved };
  }
  return undefined;
}

export function parsePermissionRequired(
  text: string,
): PermissionRequired | undefined {
  const m = text.match(/PERMISSION_REQUIRED:(\{.*\})/s);
  if (!m) return undefined;
  try {
    const p = JSON.parse(m[1]) as Partial<PermissionRequired>;
    if (
      (p.kind === "outside-cwd" || p.kind === "sensitive-file") &&
      typeof p.path === "string"
    )
      return { kind: p.kind, path: p.path };
  } catch {}
  return undefined;
}

export function extractPermissionRequiredFromEvent(
  event: Record<string, unknown>,
): PermissionRequired | undefined {
  const content =
    typeof event.content === "string"
      ? event.content
      : Array.isArray(event.content)
        ? event.content
            .map((part) =>
              part &&
              typeof part === "object" &&
              "text" in part &&
              typeof (part as Record<string, unknown>).text === "string"
                ? (part as Record<string, unknown>).text
                : "",
            )
            .join("\n")
        : "";
  return (
    parsePermissionRequired(
      typeof event.errorMessage === "string" ? event.errorMessage : "",
    ) ??
    parsePermissionRequired(
      typeof event.stderr === "string" ? event.stderr : "",
    ) ??
    parsePermissionRequired(
      typeof event.reason === "string" ? event.reason : "",
    ) ??
    parsePermissionRequired(content)
  );
}

export function getPermissionRequiredFromResult(result: {
  permissionRequired?: PermissionRequired;
  errorMessage?: string;
  stderr?: string;
  messages: Message[];
}) {
  return (
    result.permissionRequired ??
    parsePermissionRequired(result.errorMessage ?? "") ??
    parsePermissionRequired(result.stderr ?? "") ??
    parsePermissionRequired(getFinalOutput(result.messages))
  );
}
