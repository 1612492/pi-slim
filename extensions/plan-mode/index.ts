import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import {
  extractTodoItems,
  isSafeCommand,
  markCompletedSteps,
  type TodoItem,
} from "./utils.js";

const PLAN_MODE_TOOLS = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "resolve-library-id",
  "query-docs",
  "web_search_exa",
  "web_fetch_exa",
];

function isAssistantMessage(
  message: AgentMessage,
): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];
  let normalModeTools: string[] = [];

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
      normalModeTools,
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((todo) => todo.completed).length;
      ctx.ui.setStatus(
        "plan-mode",
        ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
      );
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return (
            ctx.ui.theme.fg("success", "☑ ") +
            ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
          );
        }
        return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
      });
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function enablePlanMode(ctx: ExtensionContext): void {
    normalModeTools = pi.getActiveTools();
    if (normalModeTools.length === 0) {
      normalModeTools = pi.getAllTools().map((tool) => tool.name);
    }
    planModeEnabled = true;
    executionMode = false;
    todoItems = [];
    pi.setActiveTools(PLAN_MODE_TOOLS);
    ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
    updateStatus(ctx);
    persistState();
  }

  function disablePlanMode(ctx: ExtensionContext, preserveTodos = false): void {
    planModeEnabled = false;
    executionMode = preserveTodos && todoItems.length > 0;
    pi.setActiveTools(normalModeTools);
    if (!executionMode) todoItems = [];
    ctx.ui.notify("Plan mode disabled. Full access restored.");
    updateStatus(ctx);
    persistState();
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled) {
      disablePlanMode(ctx);
    } else {
      enablePlanMode(ctx);
    }
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems
        .map(
          (item, index) =>
            `${index + 1}. ${item.completed ? "✓" : "○"} ${item.text}`,
        )
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") return;
    const command = event.input.command as string;
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked (not allowlisted). Disable /plan first.\nCommand: ${command}`,
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
          content: `[PLAN MODE ACTIVE]\nYou are in plan mode - a read-only exploration mode for safe code analysis.\n\nRestrictions:\n- You can only use read-only tools currently enabled for planning.\n- You CANNOT edit or write files.\n- Bash is restricted to an allowlist of read-only commands.\n\nIf requirements are ambiguous, ask clarifying questions with the questionnaire tool before finalizing the plan.\n\nCreate a detailed numbered plan under a \"Plan:\" header:\n\nPlan:\n1. First step description\n2. Second step description\n...\n\nDo NOT attempt to make changes - just describe what you would do.`,
          display: false,
        },
      };
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((item) => !item.completed);
      const todoList = remaining
        .map((item) => `${item.step}. ${item.text}`)
        .join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN - Full tool access enabled]\n\nRemaining steps:\n${todoList}\n\nExecute each step in order.\nAfter completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;
    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
    }
    persistState();
  });

  pi.on("agent_end", async (event, ctx) => {
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((item) => item.completed)) {
        const completedList = todoItems
          .map((item) => `~~${item.text}~~`)
          .join("\n");
        pi.sendMessage(
          {
            customType: "plan-complete",
            content: `**Plan Complete!** ✓\n\n${completedList}`,
            display: true,
          },
          { triggerTurn: false },
        );
        executionMode = false;
        todoItems = [];
        pi.setActiveTools(normalModeTools);
        updateStatus(ctx);
        persistState();
      }
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    const lastAssistant = [...event.messages]
      .reverse()
      .find(isAssistantMessage);
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant));
      if (extracted.length > 0) {
        todoItems = extracted;
      }
    }

    if (todoItems.length > 0) {
      const todoListText = todoItems
        .map((item, index) => `${index + 1}. ☐ ${item.text}`)
        .join("\n");
      pi.sendMessage(
        {
          customType: "plan-todo-list",
          content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
          display: true,
        },
        { triggerTurn: false },
      );
    }

    const choice = await ctx.ui.select("Plan mode - what next?", [
      todoItems.length > 0
        ? "Execute the plan (track progress)"
        : "Execute the plan",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice?.startsWith("Execute")) {
      planModeEnabled = false;
      executionMode = todoItems.length > 0;
      pi.setActiveTools(normalModeTools);
      updateStatus(ctx);
      persistState();

      const execMessage =
        todoItems.length > 0
          ? `Execute the plan. Start with: ${todoItems[0].text}`
          : "Execute the plan you just created.";
      pi.sendMessage(
        {
          customType: "plan-mode-execute",
          content: execMessage,
          display: true,
        },
        { triggerTurn: true },
      );
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) {
        pi.sendUserMessage(refinement.trim());
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    normalModeTools = pi.getActiveTools();
    if (normalModeTools.length === 0) {
      normalModeTools = pi.getAllTools().map((tool) => tool.name);
    }

    if (pi.getFlag("plan") === true) {
      planModeEnabled = true;
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
            todos?: TodoItem[];
            executing?: boolean;
            normalModeTools?: string[];
          };
        }
      | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      todoItems = planModeEntry.data.todos ?? todoItems;
      executionMode = planModeEntry.data.executing ?? executionMode;
      normalModeTools = planModeEntry.data.normalModeTools ?? normalModeTools;
    }

    const isResume = planModeEntry !== undefined;
    if (isResume && executionMode && todoItems.length > 0) {
      let executeIndex = -1;
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index] as { type: string; customType?: string };
        if (entry.customType === "plan-mode-execute") {
          executeIndex = index;
          break;
        }
      }

      const messages: AssistantMessage[] = [];
      for (let index = executeIndex + 1; index < entries.length; index++) {
        const entry = entries[index];
        if (
          entry.type === "message" &&
          "message" in entry &&
          isAssistantMessage(entry.message as AgentMessage)
        ) {
          messages.push(entry.message as AssistantMessage);
        }
      }
      const allText = messages.map(getTextContent).join("\n");
      markCompletedSteps(allText, todoItems);
    }

    if (planModeEnabled) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
    }
    updateStatus(ctx);
  });
}
