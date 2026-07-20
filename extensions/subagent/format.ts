import type { Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { AgentScope } from "./utils.ts";
import { getFinalOutput } from "./permissions.ts";
import type { PermissionRequired } from "./permissions.ts";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}
export interface SingleResult {
  agent: string;
  agentSource: "user" | "builtin" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  permissionRequired?: PermissionRequired;
  step?: number;
}
export interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  agentScope: AgentScope;
  builtInAgentsDir: string;
  results: SingleResult[];
}
export const emptyUsage = (): UsageStats => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
  turns: 0,
});
const fmt = (n: number) =>
  n < 1000
    ? `${n}`
    : n < 10000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1000000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1000000).toFixed(1)}M`;
export const usageText = (u: UsageStats, model?: string) =>
  [
    u.turns ? `${u.turns} turn${u.turns > 1 ? "s" : ""}` : "",
    u.input ? `↑${fmt(u.input)}` : "",
    u.output ? `↓${fmt(u.output)}` : "",
    u.cacheRead ? `R${fmt(u.cacheRead)}` : "",
    u.cacheWrite ? `W${fmt(u.cacheWrite)}` : "",
    u.cost ? `$${u.cost.toFixed(4)}` : "",
    u.contextTokens ? `ctx:${fmt(u.contextTokens)}` : "",
    model ?? "",
  ]
    .filter(Boolean)
    .join(" ");
export function renderResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  expanded: boolean,
  theme: any,
) {
  const details = result.details as SubagentDetails | undefined;
  if (!details || !details.results.length)
    return new Text(
      result.content[0]?.type === "text"
        ? (result.content[0].text ?? "(no output)")
        : "(no output)",
      0,
      0,
    );
  const mdTheme = getMarkdownTheme();
  const aggregate = details.results.reduce(
    (t, e) => ({
      input: t.input + e.usage.input,
      output: t.output + e.usage.output,
      cacheRead: t.cacheRead + e.usage.cacheRead,
      cacheWrite: t.cacheWrite + e.usage.cacheWrite,
      cost: t.cost + e.usage.cost,
      contextTokens: t.contextTokens + e.usage.contextTokens,
      turns: t.turns + e.usage.turns,
    }),
    emptyUsage(),
  );
  const success = details.results.filter((e) => e.exitCode === 0).length;
  if (!expanded) {
    let text = `${theme.fg("success", success === details.results.length ? "✓" : "◐")} ${theme.fg("toolTitle", theme.bold(details.mode + " "))}${theme.fg("accent", `${success}/${details.results.length}`)}`;
    for (const e of details.results.slice(0, 4))
      text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", e.agent)} ${e.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗")}\n${theme.fg("toolOutput", getFinalOutput(e.messages).split("\n").slice(0, 2).join("\n") || e.errorMessage || e.stderr || "(no output)")}`;
    const u = usageText(aggregate);
    if (u) text += `\n\n${theme.fg("dim", `Total: ${u}`)}`;
    return new Text(
      `${text}\n${theme.fg("muted", "(Ctrl+O to expand)")}`,
      0,
      0,
    );
  }
  const c = new Container();
  c.addChild(
    new Text(
      `${theme.fg("success", success === details.results.length ? "✓" : "◐")} ${theme.fg("toolTitle", theme.bold(details.mode + " "))}${theme.fg("accent", `${success}/${details.results.length}`)}`,
      0,
      0,
    ),
  );
  for (const e of details.results) {
    c.addChild(new Spacer(1));
    c.addChild(
      new Text(
        `${theme.fg("muted", "─── ")}${theme.fg("accent", e.agent)}${theme.fg("muted", ` (${e.agentSource})`)}`,
        0,
        0,
      ),
    );
    c.addChild(
      new Text(theme.fg("muted", "Task: ") + theme.fg("dim", e.task), 0, 0),
    );
    c.addChild(new Spacer(1));
    c.addChild(
      new Markdown(
        (
          getFinalOutput(e.messages) ||
          e.errorMessage ||
          e.stderr ||
          "(no output)"
        ).trim(),
        0,
        0,
        mdTheme,
      ),
    );
    const u = usageText(e.usage, e.model);
    if (u) c.addChild(new Text(theme.fg("dim", u), 0, 0));
  }
  const total = usageText(aggregate);
  if (total) {
    c.addChild(new Spacer(1));
    c.addChild(new Text(theme.fg("dim", `Total: ${total}`), 0, 0));
  }
  return c;
}
