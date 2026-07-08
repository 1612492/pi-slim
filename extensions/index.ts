import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import context7Extension from "./context7/index.ts";
import exaExtension from "./exa/index.ts";
import permissionGateExtension from "./permission-gate/index.ts";
import planModeExtension from "./plan-mode/index.ts";
import questionnaireExtension from "./questionnaire/index.ts";
import subagentExtension from "./subagent/index.ts";

export default function (pi: ExtensionAPI) {
  context7Extension(pi);
  exaExtension(pi);
  permissionGateExtension(pi);
  questionnaireExtension(pi);
  subagentExtension(pi);
  planModeExtension(pi);
}
