import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function getPiInvocation(args: string[]) {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript))
    return { command: process.execPath, args: [currentScript, ...args] };
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName))
    return { command: process.execPath, args };
  return { command: "pi", args };
}
export async function writePromptToTempFile(agentName: string, prompt: string) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const filePath = path.join(
    dir,
    `prompt-${agentName.replace(/[^\w.-]+/g, "_")}.md`,
  );
  await fs.promises.writeFile(filePath, prompt, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { dir, filePath };
}
export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
) {
  if (!items.length) return [] as TOut[];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOut>(items.length);
  let next = 0;
  await Promise.all(
    new Array(limit).fill(null).map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}
export async function spawnCaptured(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "",
      stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c: string) => (stdout += c));
    proc.stderr.on("data", (c: string) => (stderr += c));
    proc.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}
