import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { discoverAgents, type AgentConfig, type AgentScope } from "./utils.ts";
import {
  renderResult as renderSubagentResult,
  type SingleResult,
  type SubagentDetails,
} from "./format.ts";
import {
  extractPermissionRequiredFromEvent,
  getFinalOutput,
  getPermissionRequiredFromResult,
  getPreflightPermissionFromTask,
  type PermissionRequired,
} from "./permissions.ts";
import {
  getPiInvocation,
  mapWithConcurrencyLimit,
  spawnCaptured,
  writePromptToTempFile,
} from "./process.ts";

const MAX_PARALLEL_TASKS = 8,
  MAX_CONCURRENCY = 4;
const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory override" }),
  ),
});
const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({
    description: "Task with optional {previous} placeholder",
  }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory override" }),
  ),
});
const SubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({ description: "Name of the agent for single mode" }),
  ),
  task: Type.Optional(Type.String({ description: "Task for single mode" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel tasks" })),
  chain: Type.Optional(
    Type.Array(ChainItem, { description: "Sequential chain tasks" }),
  ),
  agentScope: Type.Optional(
    Type.Union([
      Type.Literal("user"),
      Type.Literal("builtin"),
      Type.Literal("both"),
    ]),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory override for single mode" }),
  ),
});
const emptyUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
  turns: 0,
});

async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd?: string,
  step?: number,
  permissionOverride?: PermissionRequired,
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName);
  if (!agent)
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: ${agentName}`,
      usage: emptyUsage(),
      step,
      errorMessage: `Unknown agent: ${agentName}`,
    };
  const args = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
  let tmp: { dir: string; filePath: string } | undefined;
  try {
    if (agent.systemPrompt.trim()) {
      tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      args.push("--append-system-prompt", tmp.filePath);
    }
    args.push(`Task: ${task}`);
    const inv = getPiInvocation(args);
    const { stdout, stderr, exitCode } = await spawnCaptured(
      inv.command,
      inv.args,
      cwd ?? defaultCwd,
      permissionOverride
        ? {
            ...process.env,
            PI_PERMISSION_GATE_OVERRIDE: JSON.stringify(permissionOverride),
          }
        : process.env,
    );
    const messages = [] as any[];
    let stopReason: string | undefined,
      errorMessage: string | undefined,
      permissionRequired: PermissionRequired | undefined;
    const usage = emptyUsage();
    for (const raw of stdout.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        permissionRequired ??= extractPermissionRequiredFromEvent(event);
        if (event.type === "message_end" && event.message)
          messages.push(event.message);
        if (event.type === "response_end") {
          if (typeof event.stopReason === "string")
            stopReason = event.stopReason;
          if (typeof event.errorMessage === "string")
            errorMessage = event.errorMessage;
          if (event.usage && typeof event.usage === "object") {
            const u = event.usage as Record<string, unknown>;
            usage.input += Number(u.inputTokens ?? 0);
            usage.output += Number(u.outputTokens ?? 0);
            usage.cacheRead += Number(u.cacheReadTokens ?? 0);
            usage.cacheWrite += Number(u.cacheWriteTokens ?? 0);
            usage.cost += Number(u.cost ?? 0);
            usage.contextTokens += Number(u.contextWindowTokens ?? 0);
            usage.turns += 1;
          }
        }
      } catch {
        permissionRequired ??= getPreflightPermissionFromTask(
          cwd ?? defaultCwd,
          line,
        );
      }
    }
    return {
      agent: agent.name,
      agentSource: agent.source,
      task,
      exitCode: exitCode ?? 0,
      messages,
      stderr,
      usage,
      model: agent.model,
      stopReason,
      errorMessage,
      permissionRequired,
      step,
    };
  } finally {
    if (tmp)
      await import("node:fs/promises")
        .then((fs) =>
          Promise.all([
            fs.rm(tmp!.filePath, { force: true }),
            fs.rm(tmp!.dir, { recursive: true, force: true }),
          ]),
        )
        .catch(() => {});
  }
}

async function runSingleAgentWithRetry(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  ctx: {
    hasUI: boolean;
    ui: { confirm(title: string, message: string): Promise<boolean> };
  },
  step?: number,
) {
  const preflight = getPreflightPermissionFromTask(cwd ?? defaultCwd, task);
  if (
    preflight &&
    ctx.hasUI &&
    !(await ctx.ui.confirm(
      preflight.kind === "outside-cwd"
        ? "Allow outside-cwd access for subagent?"
        : "Allow sensitive-file access for subagent?",
      `${preflight.kind}\npath: ${preflight.path}\n\nSpawn this subagent with a narrow permission override?`,
    ))
  )
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: "Blocked by user",
      usage: emptyUsage(),
      step,
      errorMessage: "Blocked by user",
    } as SingleResult;
  const first = await runSingleAgent(
    defaultCwd,
    agents,
    agentName,
    task,
    cwd,
    step,
    preflight,
  );
  const required = getPermissionRequiredFromResult(first);
  if (!required || !ctx.hasUI) return first;
  if (
    !(await ctx.ui.confirm(
      required.kind === "outside-cwd"
        ? "Allow outside-cwd access for subagent?"
        : "Allow sensitive-file access for subagent?",
      `${required.kind}\npath: ${required.path}\n\nRetry this subagent once with a narrow permission override?`,
    ))
  )
    return first;
  return await runSingleAgent(
    defaultCwd,
    agents,
    agentName,
    task,
    cwd,
    step,
    required,
  );
}

export default function subagentExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to specialized subagents with isolated context. Supports single, parallel, and chain modes.",
    promptSnippet: "Delegate focused work to a specialized subagent",
    promptGuidelines: [
      "Use subagent when the user asks in normal chat for focused exploration, isolated research, scoped implementation, or targeted review.",
      'Use `agent: "explorer"` for local code discovery, tracing behavior, or finding where something is implemented.',
      'Use `agent: "librarian"` for docs lookup or external research when isolated context is useful.',
      'Use `agent: "fixer"` for bounded implementation work in build mode that should stay out of the main session.',
      'Use `agent: "oracle"` for review, risk analysis, or strategy guidance.',
      "Use `chain` with fixer -> oracle -> fixer when the user wants implementation, review, then follow-up fixes.",
    ],
    parameters: SubagentParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const agentScope: AgentScope = params.agentScope ?? "builtin";
      const discovery = discoverAgents(agentScope);
      const agents = discovery.agents;
      const hasChain = (params.chain?.length ?? 0) > 0,
        hasTasks = (params.tasks?.length ?? 0) > 0,
        hasSingle = Boolean(params.agent && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
      const makeDetails = (
        mode: "single" | "parallel" | "chain",
        results: SingleResult[],
      ): SubagentDetails => ({
        mode,
        agentScope,
        builtInAgentsDir: discovery.builtInAgentsDir,
        results,
      });
      if (modeCount !== 1)
        return {
          content: [
            {
              type: "text",
              text: `Invalid parameters. Provide exactly one mode. Available agents: ${agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none"}`,
            },
          ],
          details: makeDetails("single", []),
          isError: true,
        };
      if (params.chain?.length) {
        const results: SingleResult[] = [];
        let previous = "";
        for (const [i, step] of params.chain.entries()) {
          const task = step.task.replace(/\{previous\}/g, previous);
          const result = await runSingleAgentWithRetry(
            ctx.cwd,
            agents,
            step.agent,
            task,
            step.cwd,
            ctx,
            i + 1,
          );
          results.push(result);
          if (
            result.exitCode !== 0 ||
            result.stopReason === "error" ||
            result.stopReason === "aborted"
          )
            return {
              content: [
                {
                  type: "text",
                  text: `Chain stopped at step ${i + 1} (${step.agent}): ${result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)"}`,
                },
              ],
              details: makeDetails("chain", results),
              isError: true,
            };
          previous = getFinalOutput(result.messages);
        }
        return {
          content: [
            {
              type: "text",
              text: getFinalOutput(results.at(-1)!.messages) || "(no output)",
            },
          ],
          details: makeDetails("chain", results),
        };
      }
      if (params.tasks?.length) {
        if (params.tasks.length > MAX_PARALLEL_TASKS)
          return {
            content: [
              {
                type: "text",
                text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              },
            ],
            details: makeDetails("parallel", []),
            isError: true,
          };
        const results = await mapWithConcurrencyLimit(
          params.tasks,
          MAX_CONCURRENCY,
          async (t) =>
            await runSingleAgentWithRetry(
              ctx.cwd,
              agents,
              t.agent,
              t.task,
              t.cwd,
              ctx,
            ),
        );
        const successCount = results.filter((r) => r.exitCode === 0).length;
        const summaries = results
          .map((r) => {
            const out = getFinalOutput(r.messages);
            const preview = out.length > 100 ? `${out.slice(0, 100)}...` : out;
            return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
          })
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries}`,
            },
          ],
          details: makeDetails("parallel", results),
          isError: successCount !== results.length,
        };
      }
      const result = await runSingleAgentWithRetry(
        ctx.cwd,
        agents,
        params.agent!,
        params.task!,
        params.cwd,
        ctx,
      );
      const failed =
        result.exitCode !== 0 ||
        result.stopReason === "error" ||
        result.stopReason === "aborted";
      return {
        content: [
          {
            type: "text",
            text: failed
              ? `Agent ${result.stopReason || "failed"}: ${result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)"}`
              : getFinalOutput(result.messages) || "(no output)",
          },
        ],
        details: makeDetails("single", [result]),
        isError: failed,
      };
    },
    renderCall(args, theme) {
      const scope: AgentScope = args.agentScope ?? "builtin";
      if (args.chain?.length) {
        let text = `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `chain (${args.chain.length} steps)`)}${theme.fg("muted", ` [${scope}]`)}`;
        for (const [i, step] of args.chain.slice(0, 3).entries()) {
          const clean = step.task.replace(/\{previous\}/g, "").trim();
          text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${clean.length > 40 ? `${clean.slice(0, 40)}...` : clean}`)}`;
        }
        return new Text(text, 0, 0);
      }
      if (args.tasks?.length) {
        let text = `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `parallel (${args.tasks.length} tasks)`)}${theme.fg("muted", ` [${scope}]`)}`;
        for (const task of args.tasks.slice(0, 3))
          text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task}`)}`;
        return new Text(text, 0, 0);
      }
      const preview = args.task
        ? args.task.length > 60
          ? `${args.task.slice(0, 60)}...`
          : args.task
        : "...";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.agent || "...")}${theme.fg("muted", ` [${scope}]`)}\n  ${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      return renderSubagentResult(result as any, expanded, theme);
    },
  });
}
