import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUBAGENT_ROLES = ["explorer", "librarian"] as const;

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

export interface BuiltInSubagentDefinition {
  name: SubagentRole;
  description: string;
  tools: string[];
  systemPrompt: string;
}

function isSubagentRole(value: string): value is SubagentRole {
  return SUBAGENT_ROLES.includes(value as SubagentRole);
}

function parseFrontmatterValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function parseBuiltInSubagentDefinition(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("Agent definition is missing frontmatter");

  const [, frontmatter, body] = match;
  const data: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = parseFrontmatterValue(trimmed.slice(colonIndex + 1));
    data[key] = value;
  }

  const name = data.name?.trim();
  const description = data.description?.trim();
  const tools = (data.tools || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const systemPrompt = body.trim();

  if (!name || !isSubagentRole(name)) {
    throw new Error(`Unknown built-in subagent role: ${JSON.stringify(name)}`);
  }
  if (!description) throw new Error(`Subagent ${name} is missing description`);
  if (tools.length === 0) throw new Error(`Subagent ${name} is missing tools`);
  if (!systemPrompt) throw new Error(`Subagent ${name} is missing prompt body`);

  return {
    name,
    description,
    tools,
    systemPrompt,
  } satisfies BuiltInSubagentDefinition;
}

export function getBuiltInSubagentPath(role: SubagentRole) {
  return fileURLToPath(new URL(`../../agents/${role}.md`, import.meta.url));
}

export async function loadBuiltInSubagent(role: SubagentRole) {
  const markdown = await readFile(getBuiltInSubagentPath(role), "utf8");
  return parseBuiltInSubagentDefinition(markdown);
}

export async function listBuiltInSubagents() {
  return await Promise.all(SUBAGENT_ROLES.map(loadBuiltInSubagent));
}
