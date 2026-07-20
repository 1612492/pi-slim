import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTimelineCommand } from "./command.ts";

export default function timelineExtension(pi: ExtensionAPI): void {
  registerTimelineCommand(pi as any);
}
