import { spawn } from "node:child_process";
import type { BuiltInSubagentDefinition } from "./agents.js";

export interface RunPiSubagentParams {
  definition: BuiltInSubagentDefinition;
  task: string;
  cwd?: string;
  contextFiles?: string[];
  model?: string;
}

export interface RunPiSubagentResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  finalText: string;
}

function buildTask(task: string, contextFiles?: string[]) {
  const lines = [task.trim()];
  const files = (contextFiles ?? []).map((item) => item.trim()).filter(Boolean);
  if (files.length > 0) {
    lines.push(
      "",
      "Use these file paths as starting context. Read only what you need:",
      ...files.map((file) => `- ${file}`),
    );
  }
  return lines.join("\n").trim();
}

export function buildPiSubagentInvocation(params: RunPiSubagentParams) {
  const command = process.env.PI_SUBAGENT_BIN?.trim() || "pi";
  const args = [
    "--mode",
    "json",
    "--no-session",
    "--system-prompt",
    params.definition.systemPrompt,
    "--tools",
    params.definition.tools.join(","),
  ];

  if (params.model?.trim()) {
    args.push("--model", params.model.trim());
  }

  args.push(buildTask(params.task, params.contextFiles));

  return {
    command,
    args,
    cwd: params.cwd,
  };
}

function readTextFromContentParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];

  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const text =
      "text" in part && typeof part.text === "string"
        ? part.text
        : "content" in part && typeof part.content === "string"
          ? part.content
          : undefined;
    if (text?.trim()) parts.push(text.trim());
  }

  return parts;
}

export function extractFinalTextFromPiJsonl(stdout: string) {
  const assistantTexts: string[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!event || typeof event !== "object") continue;
    if (!("type" in event) || event.type !== "message_end") continue;
    if (
      !("message" in event) ||
      !event.message ||
      typeof event.message !== "object"
    )
      continue;
    if (!("role" in event.message) || event.message.role !== "assistant")
      continue;
    if (!("content" in event.message)) continue;

    const text = readTextFromContentParts(event.message.content)
      .join("\n\n")
      .trim();
    if (text) assistantTexts.push(text);
  }

  return assistantTexts.at(-1) || "";
}

export async function runPiSubagent(params: RunPiSubagentParams) {
  const invocation = buildPiSubagentInvocation(params);

  return await new Promise<RunPiSubagentResult>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const finalText = extractFinalTextFromPiJsonl(stdout);
      const result = {
        command: invocation.command,
        args: invocation.args,
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        finalText,
      } satisfies RunPiSubagentResult;

      if ((exitCode ?? 0) !== 0) {
        const errorText =
          stderr.trim() || finalText || stdout.trim() || "Unknown error";
        reject(
          new Error(
            `Child pi run failed for ${params.definition.name} (${result.exitCode}): ${errorText}`,
          ),
        );
        return;
      }

      if (!finalText) {
        reject(
          new Error(
            `Child pi run for ${params.definition.name} completed without assistant output`,
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}
