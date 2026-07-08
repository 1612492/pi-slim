import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { isSafeCommand } from "./utils.ts";

const PLAN_MODE_TOOLS = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "subagent",
  "resolve-library-id",
  "query-docs",
  "web_search_exa",
  "web_fetch_exa",
];

const PLAN_MODE_CONTEXT_PROMPT = `[PLAN MODE ACTIVE]
CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use write/edit tools or
ANY bash command to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. ZERO exceptions.

Responsibility:
Your current responsibility is to think, read, search, and construct a well-formed
plan that accomplishes the user's goal. The plan should be comprehensive yet concise,
detailed enough to execute effectively while avoiding unnecessary verbosity.

Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.
Do not make large assumptions about user intent.

While investigating, narrate your progress with short, factual updates about what
you are inspecting, what you found, and why you are checking the next thing.

You may use bounded read-only delegation via subagents during planning: use
"explorer" for local code discovery, "librarian" for docs/research, and
"oracle" for analysis/review. Use "fixer" for build mode / implementation, not
plan mode.

After you have enough context, end with a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`;

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let normalModeTools: string[] = [];

  function setPlanModeStatus(ctx: ExtensionContext): void {
    const theme = ctx.ui.theme;
    const label = planModeEnabled ? "PLAN MODE" : "BUILD MODE";
    const color = planModeEnabled ? "accent" : "success";
    ctx.ui.setStatus("plan-mode", theme.fg(color, label));
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      normalModeTools,
    });
  }

  function enablePlanMode(ctx: ExtensionContext): void {
    normalModeTools = pi.getActiveTools();
    if (normalModeTools.length === 0) {
      normalModeTools = pi.getAllTools().map((tool) => tool.name);
    }
    planModeEnabled = true;
    pi.setActiveTools(PLAN_MODE_TOOLS);
    setPlanModeStatus(ctx);
    persistState();
  }

  function disablePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = false;
    pi.setActiveTools(normalModeTools);
    setPlanModeStatus(ctx);
    persistState();
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled) {
      disablePlanMode(ctx);
    } else {
      enablePlanMode(ctx);
    }
  }

  pi.registerShortcut(Key.ctrl("\\"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") return;
    const command = event.input.command as string;
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked (not allowlisted). Turn off plan mode first.\nCommand: ${command}`,
      };
    }
  });

  pi.on("context", async (event) => {
    if (planModeEnabled) return;

    return {
      messages: event.messages.filter((message) => {
        const custom = message as AgentMessage & { customType?: string };
        if (custom.customType === "plan-mode-context") return false;
        if (message.role !== "user") return true;

        const content = message.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (part) =>
              part.type === "text" &&
              (part as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  });

  pi.on("before_agent_start", async () => {
    if (planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: PLAN_MODE_CONTEXT_PROMPT,
          display: false,
        },
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    normalModeTools = pi.getActiveTools();
    if (normalModeTools.length === 0) {
      normalModeTools = pi.getAllTools().map((tool) => tool.name);
    }

    const entries = ctx.sessionManager.getEntries();
    const planModeEntry = entries
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === "plan-mode",
      )
      .pop() as
      | {
          data?: {
            enabled: boolean;
            normalModeTools?: string[];
          };
        }
      | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      normalModeTools = planModeEntry.data.normalModeTools ?? normalModeTools;
    }

    if (planModeEnabled) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
    }

    setPlanModeStatus(ctx);
  });
}
