export const SNAPSHOT_ENTRY_TYPE = "timeline-snapshot";
export const RESUME_ENTRY_TYPE = "timeline-resume";

export type TextPart = { type?: string; text?: string };

export type SessionMessageEntry = {
  id: string;
  type: "message";
  timestamp?: string;
  message: {
    role: string;
    content: string | TextPart[];
  };
};

export type SessionCustomEntry = {
  type: "custom";
  customType?: string;
  data?: {
    entryId?: string;
    snapshotRef?: string;
    kind?: "resume" | "turn";
  };
};

export type SessionEntry = SessionMessageEntry | SessionCustomEntry;

export type GitRepoInfo = {
  root: string;
  gitDir: string;
  objectsDir: string;
};
