import { execSync, spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const isDev = args[0] === "dev";

if (isDev) {
  try {
    if (process.platform === "win32") {
      try {
        const out = execSync("netstat -ano | findstr :9955", { stdio: ["ignore", "pipe", "ignore"] })
          .toString()
          .trim();
        if (out) {
          const lines = out.split("\n");
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== "0") {
              try {
                execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
              } catch {}
            }
          }
        }
      } catch {}
    } else {
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
          } catch {}
        }
      }
    }
  } catch {}
}

const bin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);
const child = spawn(bin, args, { 
  stdio: "inherit",
  shell: process.platform === "win32"
});
child.on("exit", (code) => process.exit(code ?? 0));
