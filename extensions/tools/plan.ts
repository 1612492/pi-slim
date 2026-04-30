import { access, readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import { defineTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { buildCachedToolText, createCacheWriter } from "./cache.js";

export const writePlanParams = Type.Object({
  title: Type.String({ description: "Short title for the finalized plan" }),
  body: Type.String({
    description:
      "The approved plan body to persist. Include goal, assumptions, findings, implementation plan, and risks.",
  }),
});

export const readCurrentPlanParams = Type.Object({
  includeVersionHistory: Type.Optional(
    Type.Boolean({ description: "Whether to include available plan versions" }),
  ),
});

export interface PlanToolDetails extends Record<string, unknown> {
  version?: number;
  title?: string;
  slug?: string;
  currentPlanPath?: string;
  versionPlanPath?: string;
  availableVersions?: string[];
  truncation?: {
    truncated?: boolean;
  };
  fullOutputPath?: string;
}

function buildSessionId(sessionFile: string | undefined) {
  if (!sessionFile) return "default";
  return basename(sessionFile);
}

export function slugifyPlanTitle(title: string) {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "plan";
}

export function formatPlanDocument(input: {
  title: string;
  body: string;
  version: number;
  sessionFile?: string;
  finalizedAt?: Date;
}) {
  const finalizedAt = (input.finalizedAt ?? new Date()).toISOString();
  return [
    "# Finalized Plan",
    "",
    `- Title: ${input.title.trim()}`,
    `- Version: ${input.version}`,
    `- Finalized At: ${finalizedAt}`,
    `- Session: ${buildSessionId(input.sessionFile)}`,
    "",
    input.body.trim(),
  ].join("\n");
}

export function parsePlanVersionNumber(fileName: string) {
  const match = /(?:^|-)v(\d+)\.md$/.exec(fileName.trim());
  return match ? Number(match[1]) : undefined;
}

export async function getNextPlanVersion(
  readdirImpl: typeof readdir,
  plansDir: string,
) {
  try {
    const entries = await readdirImpl(plansDir);
    const versions = entries
      .map(parsePlanVersionNumber)
      .filter((value): value is number => typeof value === "number");
    return (versions.length > 0 ? Math.max(...versions) : 0) + 1;
  } catch {
    return 1;
  }
}

export async function readCurrentPlanText(
  readFileImpl: typeof readFile,
  accessImpl: typeof access,
  currentPlanPath: string,
) {
  await accessImpl(currentPlanPath);
  return await readFileImpl(currentPlanPath, "utf8");
}

function getCollapsedLabel(input: {
  prefix: string;
  version?: number;
  truncated?: boolean;
}) {
  const parts = [input.prefix];
  if (typeof input.version === "number") parts.push(`v${input.version}`);
  if (input.truncated) parts.push("[truncated]");
  return parts.join(" ");
}

export function createWritePlanTool(getSessionFile: () => string | undefined) {
  const cacheWriter = createCacheWriter(getSessionFile);

  return defineTool({
    name: "write_plan",
    label: "Write Plan",
    description:
      "Persist the current session's finalized plan under the plans cache as both current-plan.md and a versioned snapshot.",
    promptSnippet:
      "Write an approved session plan to the persistent plans cache only after planning is complete.",
    promptGuidelines: [
      "Use write_plan when the user approves the plan and wants it finalized.",
    ],
    parameters: writePlanParams,
    async execute(_toolCallId, params) {
      const plansDir = cacheWriter.getCategoryCacheDir("plans");
      const version = await getNextPlanVersion(readdir, plansDir);
      const slug = slugifyPlanTitle(params.title);
      const currentPlanPath = `${plansDir}/current-plan.md`;
      const versionFileName = `${slug}-v${version}.md`;
      const versionPlanPath = `${plansDir}/${versionFileName}`;
      const document = formatPlanDocument({
        title: params.title,
        body: params.body,
        version,
        sessionFile: getSessionFile(),
      });

      await cacheWriter.writeCacheFile(document, {
        category: "plans",
        path: versionFileName,
      });
      await cacheWriter.writeCacheFile(document, {
        category: "plans",
        path: "current-plan.md",
      });

      const output = [
        `Finalized plan saved as version ${version}.`,
        `Current plan path: ${currentPlanPath}`,
        `Versioned snapshot path: ${versionPlanPath}`,
        "",
        document,
      ].join("\n");

      const cached = await buildCachedToolText(
        cacheWriter,
        {
          version,
          title: params.title,
          slug,
          currentPlanPath,
          versionPlanPath,
        },
        output,
        {
          category: "tools",
          prefix: `write-plan-v${version}`,
        },
      );

      return {
        content: [{ type: "text", text: cached.text }],
        details: cached.details,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Writing plan..."), 0, 0);
      }

      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as PlanToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Finalized plan",
            version: details.version,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));

      return new Text(summary, 0, 0);
    },
  });
}

export function createReadCurrentPlanTool(
  getSessionFile: () => string | undefined,
) {
  const cacheWriter = createCacheWriter(getSessionFile);

  return defineTool({
    name: "read_current_plan",
    label: "Read Current Plan",
    description:
      "Read the current session's finalized plan from the persistent plans cache.",
    promptSnippet:
      "Read the current finalized session plan before building or revising it.",
    promptGuidelines: [
      "Use read_current_plan before /build and when revising an existing session plan.",
    ],
    parameters: readCurrentPlanParams,
    async execute(_toolCallId, params) {
      const plansDir = cacheWriter.getCategoryCacheDir("plans");
      const currentPlanPath = `${plansDir}/current-plan.md`;
      const planText = await readCurrentPlanText(
        readFile,
        access,
        currentPlanPath,
      );
      const entries = params.includeVersionHistory
        ? await readdir(plansDir).catch(() => [])
        : [];
      const availableVersions = entries
        .filter(
          (entry) => entry === "current-plan.md" || /-v\d+\.md$/.test(entry),
        )
        .sort();
      const version = availableVersions
        .map(parsePlanVersionNumber)
        .filter((value): value is number => typeof value === "number")
        .sort((a, b) => b - a)[0];
      const output = [
        `Current plan path: ${currentPlanPath}`,
        ...(params.includeVersionHistory
          ? [
              `Available versions: ${availableVersions.join(", ") || "none"}`,
              "",
            ]
          : [""]),
        planText,
      ].join("\n");

      const cached = await buildCachedToolText(
        cacheWriter,
        {
          version,
          currentPlanPath,
          availableVersions,
        },
        output,
        {
          category: "tools",
          prefix: "read-current-plan",
        },
      );

      return {
        content: [{ type: "text", text: cached.text }],
        details: cached.details,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Reading plan..."), 0, 0);
      }

      const output =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = (result.details ?? {}) as PlanToolDetails;
      if (expanded) return new Text(output, 0, 0);

      const summary =
        theme.fg("success", "✓ ") +
        theme.fg(
          "muted",
          getCollapsedLabel({
            prefix: "Read current plan",
            version: details.version,
            truncated: !!details.truncation?.truncated,
          }),
        ) +
        "\n" +
        theme.fg("dim", keyHint("app.tools.expand", "to expand"));

      return new Text(summary, 0, 0);
    },
  });
}
