import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { discoverAgents, type AgentConfig, type AgentScope } from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
}

interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

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
      Type.Literal("project"),
      Type.Literal("both"),
    ]),
  ),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({ description: "Prompt before running project-local agents" }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory override for single mode" }),
  ),
});

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens)
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function getFinalOutput(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

async function writePromptToTempFile(agentName: string, prompt: string) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(dir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { dir, filePath };
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step?: number,
): Promise<SingleResult> {
  const agent = agents.find((item) => item.name === agentName);
  if (!agent) {
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: ${agentName}`,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      step,
      errorMessage: `Unknown agent: ${agentName}`,
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);
    const invocation = getPiInvocation(args);

    return await new Promise<SingleResult>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      proc.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      proc.on("close", (exitCode) => {
        const messages: Message[] = [];
        let stopReason: string | undefined;
        let errorMessage: string | undefined;
        const usage: UsageStats = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        };

        for (const rawLine of stdout.split("\n")) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === "message_end" && event.message) {
              messages.push(event.message as Message);
            }
            if (event.type === "response_end") {
              stopReason =
                typeof event.stopReason === "string"
                  ? event.stopReason
                  : stopReason;
              if (typeof event.errorMessage === "string") {
                errorMessage = event.errorMessage;
              }
              if (event.usage && typeof event.usage === "object") {
                const usageEvent = event.usage as Record<string, unknown>;
                usage.input += Number(usageEvent.inputTokens ?? 0);
                usage.output += Number(usageEvent.outputTokens ?? 0);
                usage.cacheRead += Number(usageEvent.cacheReadTokens ?? 0);
                usage.cacheWrite += Number(usageEvent.cacheWriteTokens ?? 0);
                usage.cost += Number(usageEvent.cost ?? 0);
                usage.contextTokens += Number(
                  usageEvent.contextWindowTokens ?? 0,
                );
                usage.turns += 1;
              }
            }
          } catch {
            continue;
          }
        }

        resolve({
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
          step,
        });
      });
    });
  } finally {
    if (tmpPromptPath) await fs.promises.rm(tmpPromptPath, { force: true });
    if (tmpPromptDir)
      await fs.promises.rm(tmpPromptDir, { recursive: true, force: true });
  }
}

export default function subagentExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to specialized subagents with isolated context. Supports single, parallel, and chain modes.",
    parameters: SubagentParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const agentScope: AgentScope = params.agentScope ?? "project";
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;
      const confirmProjectAgents = params.confirmProjectAgents ?? false;

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasTasks = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.agent && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
      const makeDetails = (
        mode: "single" | "parallel" | "chain",
        results: SingleResult[],
      ): SubagentDetails => ({
        mode,
        agentScope,
        projectAgentsDir: discovery.projectAgentsDir,
        results,
      });

      if (modeCount !== 1) {
        const available =
          agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") ||
          "none";
        return {
          content: [
            {
              type: "text",
              text: `Invalid parameters. Provide exactly one mode. Available agents: ${available}`,
            },
          ],
          details: makeDetails("single", []),
          isError: true,
        };
      }

      if (
        (agentScope === "project" || agentScope === "both") &&
        confirmProjectAgents &&
        ctx.hasUI
      ) {
        const requestedAgentNames = new Set<string>();
        if (params.chain)
          for (const step of params.chain) requestedAgentNames.add(step.agent);
        if (params.tasks)
          for (const task of params.tasks) requestedAgentNames.add(task.agent);
        if (params.agent) requestedAgentNames.add(params.agent);

        const projectAgentsRequested = Array.from(requestedAgentNames)
          .map((name) => agents.find((agent) => agent.name === name))
          .filter((agent): agent is AgentConfig => agent?.source === "project");

        if (projectAgentsRequested.length > 0) {
          const names = projectAgentsRequested
            .map((agent) => agent.name)
            .join(", ");
          const dir = discovery.projectAgentsDir ?? "(unknown)";
          const ok = await ctx.ui.confirm(
            "Run project-local agents?",
            `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
          );
          if (!ok) {
            return {
              content: [
                {
                  type: "text",
                  text: "Canceled: project-local agents not approved.",
                },
              ],
              details: makeDetails(
                hasChain ? "chain" : hasTasks ? "parallel" : "single",
                [],
              ),
            };
          }
        }
      }

      if (params.chain && params.chain.length > 0) {
        const results: SingleResult[] = [];
        let previousOutput = "";
        for (let index = 0; index < params.chain.length; index++) {
          const step = params.chain[index];
          const task = step.task.replace(/\{previous\}/g, previousOutput);
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            step.agent,
            task,
            step.cwd,
            index + 1,
          );
          results.push(result);

          const failed =
            result.exitCode !== 0 ||
            result.stopReason === "error" ||
            result.stopReason === "aborted";
          if (failed) {
            const errorText =
              result.errorMessage ||
              result.stderr ||
              getFinalOutput(result.messages) ||
              "(no output)";
            return {
              content: [
                {
                  type: "text",
                  text: `Chain stopped at step ${index + 1} (${step.agent}): ${errorText}`,
                },
              ],
              details: makeDetails("chain", results),
              isError: true,
            };
          }
          previousOutput = getFinalOutput(result.messages);
        }

        return {
          content: [
            {
              type: "text",
              text:
                getFinalOutput(results[results.length - 1].messages) ||
                "(no output)",
            },
          ],
          details: makeDetails("chain", results),
        };
      }

      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
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
        }

        const results = await mapWithConcurrencyLimit(
          params.tasks,
          MAX_CONCURRENCY,
          async (task) =>
            await runSingleAgent(
              ctx.cwd,
              agents,
              task.agent,
              task.task,
              task.cwd,
            ),
        );
        const successCount = results.filter(
          (result) => result.exitCode === 0,
        ).length;
        const summaries = results
          .map((result) => {
            const output = getFinalOutput(result.messages);
            const preview =
              output.length > 100 ? `${output.slice(0, 100)}...` : output;
            return `[${result.agent}] ${result.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
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

      const result = await runSingleAgent(
        ctx.cwd,
        agents,
        params.agent!,
        params.task!,
        params.cwd,
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
      const scope: AgentScope = args.agentScope ?? "project";
      if (args.chain && args.chain.length > 0) {
        let text = `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `chain (${args.chain.length} steps)`)}${theme.fg("muted", ` [${scope}]`)}`;
        for (const [index, step] of args.chain.slice(0, 3).entries()) {
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          const preview =
            cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
          text += `\n  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${preview}`)}`;
        }
        return new Text(text, 0, 0);
      }

      if (args.tasks && args.tasks.length > 0) {
        let text = `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `parallel (${args.tasks.length} tasks)`)}${theme.fg("muted", ` [${scope}]`)}`;
        for (const task of args.tasks.slice(0, 3)) {
          const preview =
            task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
          text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
        }
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
      const details = result.details as SubagentDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "(no output)",
          0,
          0,
        );
      }

      const mdTheme = getMarkdownTheme();
      const aggregate = details.results.reduce(
        (totals, entry) => ({
          input: totals.input + entry.usage.input,
          output: totals.output + entry.usage.output,
          cacheRead: totals.cacheRead + entry.usage.cacheRead,
          cacheWrite: totals.cacheWrite + entry.usage.cacheWrite,
          cost: totals.cost + entry.usage.cost,
          contextTokens: totals.contextTokens + entry.usage.contextTokens,
          turns: totals.turns + entry.usage.turns,
        }),
        {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      );

      if (!expanded) {
        const successCount = details.results.filter(
          (entry) => entry.exitCode === 0,
        ).length;
        let text = `${theme.fg("success", successCount === details.results.length ? "✓" : "◐")} ${theme.fg("toolTitle", theme.bold(details.mode + " "))}${theme.fg("accent", `${successCount}/${details.results.length}`)}`;
        for (const entry of details.results.slice(0, 4)) {
          const icon =
            entry.exitCode === 0
              ? theme.fg("success", "✓")
              : theme.fg("error", "✗");
          const output = getFinalOutput(entry.messages);
          const preview =
            output.split("\n").slice(0, 2).join("\n") ||
            entry.errorMessage ||
            entry.stderr ||
            "(no output)";
          text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", entry.agent)} ${icon}\n${theme.fg("toolOutput", preview)}`;
        }
        const usage = formatUsageStats(aggregate, undefined);
        if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
        text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
        return new Text(text, 0, 0);
      }

      const container = new Container();
      const successCount = details.results.filter(
        (entry) => entry.exitCode === 0,
      ).length;
      container.addChild(
        new Text(
          `${theme.fg("success", successCount === details.results.length ? "✓" : "◐")} ${theme.fg("toolTitle", theme.bold(details.mode + " "))}${theme.fg("accent", `${successCount}/${details.results.length}`)}`,
          0,
          0,
        ),
      );

      for (const entry of details.results) {
        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            `${theme.fg("muted", "─── ")}${theme.fg("accent", entry.agent)}${theme.fg("muted", ` (${entry.agentSource})`)}`,
            0,
            0,
          ),
        );
        container.addChild(
          new Text(
            theme.fg("muted", "Task: ") + theme.fg("dim", entry.task),
            0,
            0,
          ),
        );
        const output =
          getFinalOutput(entry.messages) ||
          entry.errorMessage ||
          entry.stderr ||
          "(no output)";
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(output.trim(), 0, 0, mdTheme));
        const usage = formatUsageStats(entry.usage, entry.model);
        if (usage) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
      }

      const totalUsage = formatUsageStats(aggregate, undefined);
      if (totalUsage) {
        container.addChild(new Spacer(1));
        container.addChild(
          new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0),
        );
      }
      return container;
    },
  });
}
