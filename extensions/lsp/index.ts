import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createLspDeclarationTool,
  createLspDefinitionTool,
  createLspDiagnosticsTool,
  createLspHoverTool,
  createLspImplementationTool,
  createLspReferencesTool,
  createLspTypeDefinitionTool,
} from "./tools.ts";

export {
  createLspDeclarationTool,
  createLspDefinitionTool,
  createLspDiagnosticsTool,
  createLspHoverTool,
  createLspImplementationTool,
  createLspReferencesTool,
  createLspTypeDefinitionTool,
} from "./tools.ts";

export default function lspExtension(_pi: ExtensionAPI): void {
  _pi.registerTool(createLspHoverTool());
  _pi.registerTool(createLspDefinitionTool());
  _pi.registerTool(createLspDeclarationTool());
  _pi.registerTool(createLspTypeDefinitionTool());
  _pi.registerTool(createLspImplementationTool());
  _pi.registerTool(createLspReferencesTool());
  _pi.registerTool(createLspDiagnosticsTool());
}
