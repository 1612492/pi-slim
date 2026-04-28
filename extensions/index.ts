import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { context7Tool } from "./tools/context7.js";
import { cleanupTempOutputFiles } from "./tools/temp-output.js";
import { websearchTool } from "./tools/websearch.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(websearchTool);
  pi.registerTool(context7Tool);
  pi.on("session_shutdown", async () => {
    await cleanupTempOutputFiles();
  });
}
