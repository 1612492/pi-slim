import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createQueryDocsTool,
  createResolveLibraryIdTool,
} from "./tools/context7.js";
import { createCacheWriter } from "./tools/cache.js";
import { createWebFetchExaTool, createWebSearchExaTool } from "./tools/exa.js";
import {
  createReadCurrentPlanTool,
  createWritePlanTool,
} from "./tools/plan.js";
import { createSpawnPiSubagentTool } from "./tools/subagent.js";

export default function (pi: ExtensionAPI) {
  let currentSessionFile: string | undefined;
  const getSessionFile = () => currentSessionFile;
  const cacheWriter = createCacheWriter(getSessionFile);

  pi.on("session_start", async (_event, ctx) => {
    currentSessionFile = ctx.sessionManager.getSessionFile();
  });

  pi.registerTool(createResolveLibraryIdTool(getSessionFile));
  pi.registerTool(createQueryDocsTool(getSessionFile));
  pi.registerTool(createWebSearchExaTool(getSessionFile));
  pi.registerTool(createWebFetchExaTool(getSessionFile));
  pi.registerTool(createSpawnPiSubagentTool(getSessionFile));
  pi.registerTool(createWritePlanTool(getSessionFile));
  pi.registerTool(createReadCurrentPlanTool(getSessionFile));
  pi.on("session_shutdown", async () => {
    await cacheWriter.clearCacheCategory("tools");
    await cacheWriter.clearCacheCategory("subagents");
    currentSessionFile = undefined;
  });
}
