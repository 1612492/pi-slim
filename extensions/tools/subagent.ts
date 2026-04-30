import { defineTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
  listBuiltInSubagents,
  loadBuiltInSubagent,
  type SubagentRole,
} from "./agents.js";
import { runPiSubagent, type RunPiSubagentResult } from "./child-pi.js";
import { buildCachedToolText, createCacheWriter } from "./cache.js";

const subagentActionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("run"),
]);

const subagentRoleSchema = Type.Union([
  Type.Literal("explorer"),
  Type.Literal("librarian"),
]);

export const spawnPiSubagentParams = Type.Object({
  action: Type.Optional(subagentActionSchema),
  role: Type.Optional(subagentRoleSchema),
  task: Type.Optional(
    Type.String({ description: "Focused task for the child Pi run" }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the child Pi process" }),
  ),
  contextFiles: Type.Optional(
    Type.Array(
      Type.String({ description: "File path to mention in the child prompt" }),
    ),
  ),
  model: Type.Optional(
    Type.String({ description: "Optional Pi model override" }),
  ),
});

export interface SpawnPiSubagentDetails extends Record<string, unknown> {
  action?: "list" | "run";
  role?: SubagentRole;
  command?: string;
  args?: string[];
  stderr?: string;
  exitCode?: number;
  fullOutputPath?: string;
  fullEventStreamPath?: string;
  truncation?: {
    truncated?: boolean;
  };
}

export function formatSubagentListOutput(
  definitions: Array<{ name: string; description: string; tools: string[] }>,
) {
  return definitions
    .map(
      (definition) =>
        `- ${definition.name}: ${definition.description}\n  Tools: ${definition.tools.join(", ")}`,
    )
    .join("\n\n");
}

export function formatSubagentRunOutput(input: {
  role: SubagentRole;
  task: string;
  result: RunPiSubagentResult;
  eventStreamPath: string;
}) {
  const lines = [
    `Role: ${input.role}`,
    `Task: ${input.task.trim()}`,
    `Command: ${input.result.command} ${input.result.args.join(" ")}`,
  ];
  if (input.result.stderr.trim())
    lines.push(`Stderr: ${input.result.stderr.trim()}`);
  lines.push(
    "",
    input.result.finalText.trim(),
    "",
    `[Raw JSON events saved to: ${input.eventStreamPath}]`,
  );
  return lines.join("\n");
}

function getCollapsedLabel(input: {
  action: "list" | "run";
  role?: string;
  truncated?: boolean;
}) {
  const parts = [input.action === "list" ? "Listed subagents" : "Ran subagent"];
  if (input.role) parts.push(input.role);
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export function createSpawnPiSubagentTool(
  getSessionName: () => string | undefined,
  options: {
    runner?: typeof runPiSubagent;
  } = {},
) {
  const cacheWriter = createCacheWriter(getSessionName);
  const runner = options.runner ?? runPiSubagent;

  return defineTool({
    name: "spawn_pi_subagent",
    label: "Spawn Pi Subagent",
    description:
      "Spawn a focused child Pi process for explorer or librarian work. Returns a compact preview plus cache paths.",
    promptSnippet:
      "Spawn an explorer or librarian child Pi run when focused recon or docs lookup is cheaper than broad main-session retrieval.",
    promptGuidelines: [
      "Use spawn_pi_subagent for focused explorer or librarian tasks only.",
      "Keep planner and builder work in the main session via /plan and /build.",
    ],
    parameters: spawnPiSubagentParams,
    async execute(_toolCallId, params) {
      const action = params.action ?? "run";

      if (action === "list") {
        const definitions = await listBuiltInSubagents();
        return {
          content: [
            {
              type: "text",
              text: formatSubagentListOutput(definitions),
            },
          ],
          details: {
            action,
          },
        };
      }

      if (!params.role) {
        throw new Error("spawn_pi_subagent requires role when action is run");
      }
      if (!params.task?.trim()) {
        throw new Error("spawn_pi_subagent requires task when action is run");
      }

      const definition = await loadBuiltInSubagent(params.role);
      const result = await runner({
        definition,
        task: params.task,
        cwd: params.cwd,
        contextFiles: params.contextFiles,
        model: params.model,
      });

      const { cacheFile: eventStreamPath } = await cacheWriter.writeCacheFile(
        result.stdout,
        {
          category: "subagents",
          prefix: `${params.role}-events`,
        },
      );
      const formatted = formatSubagentRunOutput({
        role: params.role,
        task: params.task,
        result,
        eventStreamPath,
      });
      const cached = await buildCachedToolText(
        cacheWriter,
        {
          action,
          role: params.role,
          command: result.command,
          args: result.args,
          stderr: result.stderr,
          exitCode: result.exitCode,
          fullEventStreamPath: eventStreamPath,
        },
        formatted,
        {
          category: "subagents",
          prefix: params.role,
        },
      );

      return {
        content: [{ type: "text", text: cached.text }],
        details: cached.details,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Running child Pi..."), 0, 0);
      }

      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as SpawnPiSubagentDetails;
      if (expanded) return new Text(output, 0, 0);

      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            action: details.action ?? "run",
            role: details.role,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));

      return new Text(summary, 0, 0);
    },
  });
}
