import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const runtime = JSON.parse(fs.readFileSync(".local-public/runtime.json"));
const origin = new URL(runtime.publicUrl).origin;
const out = "verification/public-tunnel-20261017";
fs.mkdirSync(out, { recursive: true });
const checks = [];
function get(route, extra = []) {
  const dest = path.join(out, `http-${checks.length}.body`);
  const status = Number(execFileSync("curl", [
    "-sS", "--retry", "3", "--retry-all-errors", "--retry-delay", "1",
    "--connect-timeout", "10", "--max-time", "25", "-o", dest, "-w", "%{http_code}",
    ...extra, origin + route,
  ], { encoding: "utf8" }));
  const body = fs.readFileSync(dest);
  checks.push({ route, status, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") });
  console.log(`${status} ${route} (${body.length} bytes)`);
  return { status, body };
}
try {
  const index = get(`/?v=${runtime.version}`);
  if (index.status !== 200 || !index.body.equals(fs.readFileSync("dist/index.html"))) throw Error("public index differs");
  for (const name of fs.readdirSync("dist/assets")) {
    const r = get("/assets/" + name);
    if (r.status !== 200 || !r.body.equals(fs.readFileSync("dist/assets/" + name))) throw Error("asset mismatch " + name);
  }
  for (const route of ["/api/health", "/api/me"]) {
    const r = get(route);if (r.status !== 200) throw Error("API not reachable");JSON.parse(r.body);
  }
  if (get("/api/works").status !== 401) throw Error("anonymous works authorization changed");
  const post = get("/api/logout", ["-X", "POST", "-H", "Origin: " + origin, "-H", "Content-Type: application/json", "--data", "{}"]);
  if (post.status !== 200) throw Error("same-origin POST rejected");
  const wrong = get("/api/logout", ["-X", "POST", "-H", "Origin: https://example.invalid", "-H", "Content-Type: application/json", "--data", "{}"]);
  if (wrong.status !== 403) throw Error("cross-origin guard ineffective");
  fs.writeFileSync(path.join(out, "http-checks.json"), JSON.stringify({ status: "passed", date: new Date().toISOString(), url: runtime.publicUrl, version: runtime.version, checks }, null, 2) + "\n");
} catch (e) {
  fs.writeFileSync(path.join(out, "http-checks.json"), JSON.stringify({ status: "failed", error: e.message, checks }, null, 2));
  throw e;
}
