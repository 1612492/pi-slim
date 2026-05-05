import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import context7Extension from "./context7/index.js";
import exaExtension from "./exa/index.js";
import permissionGateExtension from "./permission-gate/index.js";
import planModeExtension from "./plan-mode/index.js";
import questionnaireExtension from "./questionnaire/index.js";
import subagentExtension from "./subagent/index.js";

export default function (pi: ExtensionAPI) {
  context7Extension(pi);
  exaExtension(pi);
  permissionGateExtension(pi);
  questionnaireExtension(pi);
  subagentExtension(pi);
  planModeExtension(pi);
}
