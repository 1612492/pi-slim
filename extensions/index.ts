import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createQueryDocsTool,
  createResolveLibraryIdTool,
} from "./tools/context7.js";
import { createCacheWriter } from "./tools/cache.js";
import { createWebFetchExaTool, createWebSearchExaTool } from "./tools/exa.js";
import planModeExtension from "./plan-mode/index.js";
import subagentExtension from "./subagent/index.js";

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
  subagentExtension(pi);
  planModeExtension(pi);
  pi.on("session_shutdown", async () => {
    await cacheWriter.clearCacheCategory("tools");
    currentSessionFile = undefined;
  });
}
