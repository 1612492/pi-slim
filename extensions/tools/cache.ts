import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";

export type CacheWriteOptions = {
  category?: string;
  path?: string;
  prefix?: string;
};

export type CacheWriter = ReturnType<typeof createCacheWriter>;

function sanitizePathSegment(input: string | undefined) {
  const value = input?.trim() || "default";
  const sanitized = value
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  return sanitized || "default";
}

function buildDefaultFileName(prefix?: string) {
  const safePrefix = sanitizePathSegment(prefix || "output");
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`;
}

function getSessionScopeParts(sessionFile: string | undefined) {
  if (!sessionFile) {
    return { bucket: "default", session: "default" };
  }

  const bucket = sanitizePathSegment(basename(dirname(sessionFile)));
  const fileName = basename(sessionFile);
  const session = sanitizePathSegment(
    fileName.slice(0, Math.max(0, fileName.length - extname(fileName).length)),
  );

  return {
    bucket: bucket || "default",
    session: session || "default",
  };
}

export function createCacheWriter(getSessionFile: () => string | undefined) {
  function getCacheRootDir() {
    return resolve(homedir(), ".cache", "pi");
  }

  function getCategoryCacheDir(category: string) {
    const scope = getSessionScopeParts(getSessionFile());
    return join(
      getCacheRootDir(),
      sanitizePathSegment(category),
      scope.bucket,
      scope.session,
    );
  }

  function getSessionCacheDir() {
    const scope = getSessionScopeParts(getSessionFile());
    return join(getCacheRootDir(), scope.bucket, scope.session);
  }

  async function removeDirIfEmpty(dir: string) {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) {
        await rm(dir, { recursive: true, force: true });
        return true;
      }
    } catch {
      // ignore missing/inaccessible directories
    }
    return false;
  }

  async function writeCacheFile(text: string, options: CacheWriteOptions = {}) {
    const category = sanitizePathSegment(options.category || "tools");
    const baseDir = getCategoryCacheDir(category);
    const outputPath = options.path?.trim();
    const cacheFile = outputPath
      ? isAbsolute(outputPath)
        ? outputPath
        : resolve(baseDir, outputPath)
      : join(baseDir, buildDefaultFileName(options.prefix));

    await mkdir(dirname(cacheFile), { recursive: true });
    await withFileMutationQueue(cacheFile, async () => {
      await writeFile(cacheFile, text, "utf8");
    });

    return {
      cacheFile,
      cacheDir: dirname(cacheFile),
      sessionCacheDir: getSessionCacheDir(),
    };
  }

  async function writeToolOutputFile(text: string, path?: string) {
    return writeCacheFile(text, { category: "tools", path });
  }

  async function clearCacheCategory(category: string) {
    const dir = getCategoryCacheDir(category);
    const sessionDir = getSessionCacheDir();
    const bucketDir = dirname(sessionDir);
    try {
      await rm(dir, { recursive: true, force: true });
      await removeDirIfEmpty(sessionDir);
      await removeDirIfEmpty(bucketDir);
    } catch {
      // ignore cleanup failures
    }
  }

  return {
    getCacheRootDir,
    getSessionCacheDir,
    writeCacheFile,
    writeToolOutputFile,
    clearCacheCategory,
  };
}

export async function buildCachedToolText(
  writer: Pick<CacheWriter, "writeCacheFile">,
  details: Record<string, unknown>,
  text: string,
  options: CacheWriteOptions = {},
) {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  const { cacheFile } = await writer.writeCacheFile(text, options);

  if (!truncation.truncated) {
    return {
      text: `${truncation.content}\n\n[Full output saved to: ${cacheFile}]`,
      details: { ...details, truncation, fullOutputPath: cacheFile },
    };
  }

  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  const message = `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted. Full output saved to: ${cacheFile}]`;

  return {
    text: message,
    details: { ...details, truncation, fullOutputPath: cacheFile },
  };
}
