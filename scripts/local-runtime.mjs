// A separate local sandbox. Never starts/stops production, old local servers, or tunnels.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dir = path.join(root, ".local-public/accounts-local"),
  stateFile = path.join(dir, "process.json"),
  command = process.argv[2] || "status";
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
  : null;
const running = () => {
  try {
    process.kill(state?.pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (command === "status") {
  console.log(
    state && running()
      ? { ...state, running: true }
      : { running: false, log: path.join(dir, "server.log") },
  );
} else if (command === "stop") {
  if (state && running()) {
    const ps = spawn("ps", ["-p", String(state.pid), "-o", "command="], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let text = "";
    ps.stdout.on("data", (b) => (text += b));
    ps.on("exit", () => {
      if (text.includes(path.join(root, "server/index.mjs"))) {
        process.kill(state.pid, "SIGTERM");
        console.log("已停止本项目本地沙箱");
      } else console.log("PID已不属于本项目，未停止");
    });
  } else console.log("未运行");
} else if (command === "start") {
  if (state && running()) {
    console.log("已运行 " + state.url);
    process.exit(0);
  }
  const buildDir = path.join(dir, "dist");
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    if (!fs.existsSync(path.join(root, "dist/index.html")))
      throw Error("请先 npm run build:local");
    fs.cpSync(path.join(root, "dist"), buildDir, { recursive: true });
  }
  if(!process.env.LOCAL_ENV_FILE) throw Error("请通过LOCAL_ENV_FILE指定此产品的私密OIDC环境配置；本地测试可运行npm run test:accounts，不会启动旧密码账号。");
  const port = Number(process.env.LOCAL_PORT || 4182);
  const log = fs.openSync(path.join(dir, "server.log"), "a");
  const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      ENV_FILE: process.env.LOCAL_ENV_FILE,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: path.join(dir, "data"),
      STATIC_DIR: buildDir,
      TRUSTED_PROXIES: "",
      COOKIE_SECURE: "0",
      PUBLIC_URL: "http://127.0.0.1:" + port,
    },
  });
  child.unref();
  const value = {
    pid: child.pid,
    url: "http://127.0.0.1:" + port,
    version: JSON.parse(fs.readFileSync(path.join(root, "package.json")))
      .version,
    data: path.join(dir, "data"),
    log: path.join(dir, "server.log"),
    started: new Date().toISOString(),
  };
  fs.writeFileSync(stateFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  console.log(value);
} else throw Error("start | stop | status");
