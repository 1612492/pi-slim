export type JsonRpcId = number;

export type PositionParams = {
  filePath: string;
  line: number;
  character: number;
};

export type Diagnostic = {
  message: string;
  severity?: number;
  source?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type LocationLike =
  | { uri: string; range?: { start: { line: number; character: number } } }
  | {
      targetUri?: string;
      targetRange?: { start: { line: number; character: number } };
    };

export type LspClient = {
  request<T>(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
  diagnostics(uri: string): Diagnostic[];
  diagnosticVersion(uri: string): number;
  supports(method: string): boolean;
};

export type WorkspaceState = {
  client: Promise<LspClient>;
};
