import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createQueryDocsTool,
  createResolveLibraryIdTool,
} from "./tools/context7.js";
import permissionGateExtension from "./permission-gate.js";
import { createWebFetchExaTool, createWebSearchExaTool } from "./tools/exa.js";
import planModeExtension from "./plan-mode/index.js";
import subagentExtension from "./subagent/index.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(createResolveLibraryIdTool());
  pi.registerTool(createQueryDocsTool());
  pi.registerTool(createWebSearchExaTool());
  pi.registerTool(createWebFetchExaTool());
  permissionGateExtension(pi);
  subagentExtension(pi);
  planModeExtension(pi);
}
