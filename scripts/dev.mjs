import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/index.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ALLOWED_ORIGINS:
        process.env.ALLOWED_ORIGINS ||
        "http://127.0.0.1:5173,http://localhost:5173",
    },
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", ...process.argv.slice(2)],
    { stdio: "inherit" },
  ),
];
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    children.forEach((c) => c.kill(signal));
    process.exit(0);
  });
for (const child of children)
  child.on("exit", (code) => {
    if (code) {
      children.forEach((c) => c.kill());
      process.exit(code);
    }
  });
