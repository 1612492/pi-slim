import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentScope = "builtin" | "user" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "builtin";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  builtInAgentsDir: string;
}

function parseFrontmatterValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseMarkdownAgent(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return undefined;
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

  if (!data.name || !data.description || !body.trim()) return undefined;
  const tools = (data.tools || "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);

  return {
    name: data.name,
    description: data.description,
    tools: tools.length > 0 ? tools : undefined,
    model: data.model,
    systemPrompt: body.trim(),
  };
}

function loadAgentsFromDir(
  dir: string,
  source: "user" | "builtin",
): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = parseMarkdownAgent(content);
      if (!parsed) continue;
      agents.push({ ...parsed, source, filePath });
    } catch {
      continue;
    }
  }

  return agents;
}

function isDirectory(value: string) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function getBuiltInAgentsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "agents",
  );
}

export function discoverAgents(scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
  const builtInAgentsDir = getBuiltInAgentsDir();
  const userAgents =
    scope === "builtin" ? [] : loadAgentsFromDir(userDir, "user");
  const builtInAgents = loadAgentsFromDir(builtInAgentsDir, "builtin");

  const map = new Map<string, AgentConfig>();
  if (scope === "both") {
    for (const agent of builtInAgents) map.set(agent.name, agent);
    for (const agent of userAgents) map.set(agent.name, agent);
  } else if (scope === "user") {
    for (const agent of userAgents) map.set(agent.name, agent);
  } else {
    for (const agent of builtInAgents) map.set(agent.name, agent);
  }

  return { agents: Array.from(map.values()), builtInAgentsDir };
}
