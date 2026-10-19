import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, ".local-public");
const stateFile = path.join(stateDir, "runtime.json");
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version;
fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true, mode: 0o700 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function command(file, args) {
  try { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function identity(pid) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  const started = command("ps", ["-p", String(pid), "-o", "lstart="]);
  if (!started) return null;
  const cmd = command("ps", ["-p", String(pid), "-o", "command="]);
  const cwd = command("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((s) => s.startsWith("n"))?.slice(1);
  return { pid, started, command: cmd, cwd };
}
function matches(record) {
  const actual = identity(record?.pid);
  return actual && actual.started === record.started && actual.command === record.command && actual.cwd === root;
}
function read() {
  return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
}
function write(state) {
  fs.writeFileSync(stateFile + ".tmp", JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(stateFile + ".tmp", stateFile);
}
function note(message) {
  fs.appendFileSync(path.join(stateDir, "service-observations.log"), `${new Date().toISOString()} ${message}\n`);
}
async function fetchText(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  return { status: response.status, text: await response.text() };
}
async function checkService() {
  const expected = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  const result = await fetchText(origin + "/");
  if (result.status !== 200 || result.text !== expected) throw Error("4173端口未提供当前dist构建，未启动Tunnel");
  const api = await fetchText(origin + "/api/me");
  if (api.status !== 200 || !Object.hasOwn(JSON.parse(api.text), "user")) throw Error("同源账号API未就绪");
  return { index: 200, api: 200 };
}
function detached(binary, args, log) {
  const fd = fs.openSync(log, "a", 0o600);
  try {
    const child = spawn(binary, args, {
      cwd: root, detached: true, stdio: ["ignore", fd, fd],
      env: {
        ...process.env, HOST: "127.0.0.1", PORT: String(port),
        ...(args[0] === path.join(root, "server/index.mjs") ? {
          TRUSTED_PROXIES: process.env.TRUSTED_PROXIES || "127.0.0.1/32,::1/128",
          CLIENT_IP_HEADER: "cf-connecting-ip",
        } : {}),
      },
    });
    // No shell, broad process matching, global Cloudflare config or service install.
    child.on("error", (e) => note(`spawn failed: ${e.message}`));
    child.unref();
    return child.pid;
  } finally { fs.closeSync(fd); }
}
async function findUrl(tunnel, seconds = 0) {
  const until = Date.now() + seconds * 1000;
  do {
    if (tunnel.log && fs.existsSync(tunnel.log)) {
      const text = fs.readFileSync(tunnel.log, "utf8");
      const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
      if (url) return url;
    }
    if (!matches(tunnel) || Date.now() >= until) return null;
    await pause(500);
  } while (true);
}
async function start() {
  if (!fs.existsSync(path.join(root, "dist/index.html"))) throw Error("缺少dist，请先npm run build");
  const cloudflared = command("which", ["cloudflared"]);
  if (!cloudflared) throw Error("未找到cloudflared，请按Cloudflare官方安装方式安装");
  const state = read();
  const listeners = command("lsof", ["-t", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).split("\n").filter(Boolean).map(Number);
  if (listeners.length) {
    const existing = identity(listeners[0]);
    if (listeners.length !== 1 || existing?.cwd !== root || !existing.command.includes("server/index.mjs"))
      throw Error("4173被其他服务占用，未停止或替换该进程");
    const owned = !!state.service?.owned && matches(state.service);
    state.service = { ...existing, owned, reused: !owned, log: owned ? state.service.log : null };
  } else {
    const log = path.join(stateDir, "logs", `server-${Date.now()}.log`);
    const pid = detached(process.execPath, [path.join(root, "server/index.mjs")], log);
    for (let n = 0; n < 40; n++) {
      await pause(250);
      try { await checkService();break; } catch { /* wait for startup */ }
    }
    state.service = { ...identity(pid), owned: true, reused: false, log };
  }
  state.local = origin;state.version = version;
  state.checked = await checkService();
  note(`service ready PID=${state.service.pid} reused=${state.service.reused} version=${version}`);
  if (!matches(state.tunnel)) {
    const log = path.join(stateDir, "logs", `tunnel-${Date.now()}.log`);
    const args = ["tunnel", "--url", origin, "--protocol", "http2", "--no-autoupdate", "--metrics", "127.0.0.1:0"];
    const pid = detached(cloudflared, args, log);
    await pause(200);
    const record = identity(pid);
    state.tunnel = { ...record, owned: true, log, binary: cloudflared, args };
    state.publicUrl = null;state.createdAt = new Date().toISOString();
  }
  write(state);
  const url = await findUrl(state.tunnel, 60);
  if (!url) throw Error(`Tunnel尚未取得地址，请检查 ${state.tunnel.log}；进程信息已保存`);
  state.publicUrl = `${url}/?v=${encodeURIComponent(version)}`;
  write(state);fs.writeFileSync(path.join(stateDir, "URL.txt"), state.publicUrl + "\n");
  note(`tunnel running PID=${state.tunnel.pid} URL=${state.publicUrl}`);
  console.log(JSON.stringify({ url: state.publicUrl, local: origin, version, servicePid: state.service.pid, serviceReused: state.service.reused, tunnelPid: state.tunnel.pid, log: state.tunnel.log }, null, 2));
}
async function stopOne(record, label) {
  if (!record?.owned || !matches(record)) return;
  process.kill(record.pid, "SIGTERM");
  for (let n = 0; n < 40 && matches(record); n++) await pause(100);
  if (matches(record)) throw Error(`${label}未响应停止，请检查PID ${record.pid}；未强杀其他进程`);
  note(`${label} stopped PID=${record.pid}`);
}
async function stop() {
  const state = read();
  await stopOne(state.tunnel, "tunnel");
  await stopOne(state.service, "owned service");
  state.stoppedAt = new Date().toISOString();write(state);
  fs.writeFileSync(path.join(stateDir, "URL.txt"), "已停止；重新运行npm run public:start获取新地址\n");
  console.log(state.service?.reused ? "本项目Tunnel已停止；复用的本地服务保留，其他项目未改动。" : "本项目管理的Tunnel及服务已停止。其他项目未改动。");
}
async function status() {
  const state = read();
  const tunnelAlive = !!matches(state.tunnel), serviceAlive = !!matches(state.service);
  let health;
  try { health = await checkService(); } catch (e) { health = e.message; }
  console.log(JSON.stringify({ version, url: tunnelAlive ? state.publicUrl : null, local: origin, tunnelAlive, tunnelPid: state.tunnel?.pid, serviceAlive, servicePid: state.service?.pid, serviceReused: state.service?.reused, localHealth: health, tunnelLog: state.tunnel?.log, serviceLog: state.service?.log || "复用服务的原stdout为管道；状态记录在service-observations.log", state: stateFile }, null, 2));
}
const action = process.argv[2] || "status";
let locked = false;
try {
  if (action !== "status") { fs.mkdirSync(path.join(stateDir,"control.lock"));locked = true; }
  if (action === "start") await start();
  else if (action === "stop") await stop();
  else if (action === "restart") { await stop();await start(); }
  else if (action === "status") await status();
  else throw Error("用法：node scripts/public-tunnel.mjs start|status|stop|restart");
} catch(e) {
  console.error(e.code === "EEXIST" ? "本项目另一条启停命令正在运行；未重复启动。" : e.message);process.exitCode = 1;
} finally { if (locked) fs.rmdirSync(path.join(stateDir,"control.lock")); }
