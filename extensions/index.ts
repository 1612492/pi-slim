import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import context7Extension from "./context7/index.ts";
import exaExtension from "./exa/index.ts";
import lspExtension from "./lsp/index.ts";
import permissionGateExtension from "./permission-gate/index.ts";
import planModeExtension from "./plan-mode/index.ts";
import questionnaireExtension from "./questionnaire/index.ts";
import timelineExtension from "./timeline/index.ts";
import subagentExtension from "./subagent/index.ts";

export default function (pi: ExtensionAPI) {
  context7Extension(pi);
  exaExtension(pi);
  lspExtension(pi);
  permissionGateExtension(pi);
  questionnaireExtension(pi);
  timelineExtension(pi);
  subagentExtension(pi);
  planModeExtension(pi);
}
