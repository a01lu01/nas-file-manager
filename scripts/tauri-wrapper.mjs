import { execSync, spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const isDev = args[0] === "dev";

if (isDev) {
  try {
    const out = execSync("lsof -ti tcp:9955", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out) {
      const pids = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
        }
      }
    }
  } catch {
  }
}

const bin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);
const child = spawn(bin, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
