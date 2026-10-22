import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fault } from "./accounts.mjs";
import { CenterRequestError } from "./center-client.mjs";
export function installExports({ app, db, dataDir, accounts }) {
  const { auth, account, rights } = accounts;
  const quotaFeature = process.env.EXPORT_QUOTA_FEATURE || "export",
    accessFeature = process.env.EXPORT_ACCESS_FEATURE || "export_member";
  db.exec(
    `CREATE TABLE IF NOT EXISTS export_jobs(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES identities(id),request_key TEXT NOT NULL,business_id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,intent TEXT NOT NULL DEFAULT 'hold',mode TEXT,reservation_id TEXT,center_status TEXT,access_token TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL,filename TEXT,extension TEXT,file_hash TEXT,error_code TEXT,UNIQUE(user_id,request_key));`,
  );
  const dir = path.join(dataDir, "exports");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const get = (id) =>
    db.prepare("SELECT * FROM export_jobs WHERE id=?").get(id);
  const view = (j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    charged: j.mode === "quota" ? 1 : 0,
    created: j.created,
    expires: j.expires,
    filename: j.filename,
    centerStatus: j.center_status,
    requestId: j.business_id,
    errorCode: j.error_code,
  });
  const update = (id, fields) => {
    const keys = Object.keys(fields);
    db.prepare(
      `UPDATE export_jobs SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
    ).run(...keys.map((k) => fields[k]), id);
    return get(id);
  };
  const lookup = (j) =>
    j.reservation_id
      ? { reservation_id: j.reservation_id }
      : { request_id: j.business_id };
  const file = (j) => path.join(dir, j.id + "." + j.extension);
  const validFile = (j) =>
    !!(
      j.file_hash &&
      ["png", "zip"].includes(j.extension) &&
      fs.existsSync(file(j)) &&
      createHash("sha256")
        .update(fs.readFileSync(file(j)))
        .digest("hex") === j.file_hash
    );
  const locked = new Map();
  async function exclusive(id, fn) {
    const before = locked.get(id) || Promise.resolve();
    const task = before.catch(() => {}).then(fn);
    locked.set(id, task);
    try {
      return await task;
    } finally {
      if (locked.get(id) === task) locked.delete(id);
    }
  }
  async function progress(id) {
    let j = get(id);
    if (["cancelled", "expired", "refunded", "rejected"].includes(j.status))
      return j;
    // A staged artifact, not a browser claim, determines whether delivery can proceed.
    if (j.status === "ready" && validFile(j)) return j;
    try {
      if (!j.mode) {
        if (j.intent === "cancel")
          return update(id, { status: "cancelled", access_token: null });
        const e = await rights.get(j.access_token);
        const access = e.features.find(
          (f) => f.id === accessFeature && f.kind === "access" && f.allowed,
        );
        j = update(id, { mode: access ? "access" : "quota" });
      }
      if (j.mode === "access") {
        if (
          j.intent === "cancel" ||
          (j.expires <= Date.now() && j.intent === "hold")
        )
          return update(id, { status: "cancelled", access_token: null });
        if (j.intent === "deliver") {
          if (!validFile(j))
            return update(id, {
              status: "rejected",
              error_code: "ARTIFACT_MISSING",
              access_token: null,
            });
          await rights.check(j.access_token, accessFeature);
          return update(id, {
            status: "ready",
            center_status: "access_allowed",
            access_token: null,
          });
        }
        // Not inferred from membership: the center must allow this explicit access feature.
        await rights.check(j.access_token, accessFeature);
        return update(id, { status: "reserved" });
      }
      let r;
      try {
        r = await rights.status(lookup(j));
      } catch (error) {
        if (error.status !== 404) throw error;
        if (j.intent === "cancel" || j.expires <= Date.now()) {
          // Recheck later if a timed-out reserve may still be in flight. The same business ID is never reused.
          if (j.status === "initiating" && j.intent === "cancel")
            return update(id, { status: "cancelled", access_token: null });
          return update(id, {
            status: "pending_recovery",
            error_code: "RESERVATION_UNRESOLVED",
          });
        }
        r = await rights.reserve(
          j.access_token,
          quotaFeature,
          j.business_id,
          1,
        );
      }
      j = update(id, {
        reservation_id: r.id,
        center_status: r.status,
        expires: new Date(r.expires_at).getTime() || j.expires,
      });
      if (["cancelled", "expired", "refunded"].includes(r.status))
        return update(id, { status: r.status, access_token: null });
      if (r.status === "confirmed") {
        if (validFile(j) && j.intent === "deliver")
          return update(id, {
            status: "ready",
            access_token: null,
            error_code: null,
          });
        // Verified server-side missing/corrupt artifact after a committed debit.
        r = await rights.recover(
          lookup(j),
          "refund",
          "拼豆服务端核实已确认任务没有可交付文件",
        );
        return update(id, {
          center_status: r.status,
          status: r.status,
          access_token: null,
        });
      }
      if (r.status !== "reserved")
        throw Error("Unknown center reservation state");
      if (j.intent === "cancel" || j.expires <= Date.now()) {
        r = await rights.recover(
          lookup(j),
          "cancel",
          "拼豆任务未执行或生成阶段已取消/到期",
        );
        return update(id, {
          center_status: r.status,
          status: r.status,
          access_token: null,
        });
      }
      if (j.intent === "deliver") {
        if (!validFile(j)) {
          update(id, { intent: "cancel" });
          return progress(id);
        }
        try {
          r = await rights.confirmKnown(j.access_token, r.id);
        } catch (error) {
          // A rejected or unknown confirmation may follow a prior committed attempt.
          const known = await rights.status(lookup(j));
          if (known.status === "confirmed") r = known;
          else if (
            known.status === "reserved" &&
            error.outcome === "rejected"
          ) {
            r = await rights.recover(
              lookup(j),
              "cancel",
              "交付确认被权威服务拒绝，未交付文件",
            );
          } else throw error;
        }
        return update(id, {
          center_status: r.status,
          status:
            r.status === "confirmed"
              ? "ready"
              : r.status === "reserved"
                ? "pending_recovery"
                : r.status,
          access_token: r.status === "confirmed" ? null : j.access_token,
          error_code: null,
        });
      }
      return update(id, { status: "reserved", error_code: null });
    } catch (error) {
      const definitive =
        error instanceof CenterRequestError &&
        error.outcome === "rejected" &&
        !j.reservation_id &&
        [
          "INSUFFICIENT_QUOTA",
          "QUOTA_EXHAUSTED",
          "MEMBERSHIP_REQUIRED",
          "FEATURE_NOT_FOUND",
          "USER_BLOCKED",
          "LOGIN_REQUIRED",
          "INVALID_TOKEN",
        ].includes(error.code);
      if (definitive)
        return update(id, {
          status: "rejected",
          error_code: error.code,
          access_token: null,
        });
      return update(id, {
        status: "pending_recovery",
        error_code: error.code || "CENTER_UNKNOWN",
      });
    }
  }
  const run = (id) => exclusive(id, () => progress(id));
  app.get("/api/account", auth, async (req, res) =>
    res.json({
      user: await accounts.userView(req),
      jobs: db
        .prepare(
          "SELECT * FROM export_jobs WHERE user_id=? ORDER BY created DESC LIMIT 30",
        )
        .all(req.user.id)
        .map(view),
      rules: accounts.rules,
    }),
  );
  app.post("/api/exports/reserve", auth, account, async (req, res) => {
    const b = req.body;
    if (
      !/^[a-zA-Z0-9-]{8,80}$/.test(b.requestKey || "") ||
      !["chart", "mosaic", "palette", "assembly", "sections", "blank"].includes(
        b.kind,
      ) ||
      !/^[0-9a-f]{64}$/.test(b.fingerprint || "")
    )
      throw fault(400, "INVALID_EXPORT", "导出请求无效");
    let j = db
      .prepare("SELECT * FROM export_jobs WHERE user_id=? AND request_key=?")
      .get(req.user.id, b.requestKey);
    if (j && (j.kind !== b.kind || j.fingerprint !== b.fingerprint))
      throw fault(409, "REQUEST_MISMATCH", "重复请求参数不同");
    if (!j) {
      // An unresolved identical task must be recovered rather than charged under a new key.
      j = db
        .prepare(
          "SELECT * FROM export_jobs WHERE user_id=? AND fingerprint=? AND kind=? AND status IN ('initiating','pending_recovery','reserved') ORDER BY created DESC LIMIT 1",
        )
        .get(req.user.id, b.fingerprint, b.kind);
    }
    if (!j) {
      if (
        db
          .prepare(
            "SELECT count(*) n FROM export_jobs WHERE user_id=? AND status IN ('initiating','pending_recovery','reserved')",
          )
          .get(req.user.id).n >= 3
      )
        throw fault(429, "TASKS_PENDING", "请先完成或取消已有任务");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO export_jobs(id,user_id,request_key,business_id,fingerprint,kind,status,access_token,created,expires) VALUES(?,?,?,?,?,?,'initiating',?,?,?)",
      ).run(
        id,
        req.user.id,
        b.requestKey,
        "beadgrid-" + id,
        b.fingerprint,
        b.kind,
        req.accessToken,
        Date.now(),
        Date.now() + 300000,
      );
      j = get(id);
    }
    const result = await run(j.id);
    if (result.status === "rejected")
      throw fault(
        403,
        result.error_code,
        "导出权益不足或不可用，请在公共个人中心查看拼豆权益",
      );
    if (["cancelled", "expired", "refunded"].includes(result.status))
      throw fault(409, "TASK_CLOSED", "该任务已结束，请重新确认生成");
    res
      .status(result.status === "pending_recovery" ? 202 : 200)
      .json(view(result));
  });
  app.get("/api/exports/:id", auth, async (req, res) => {
    const j = get(req.params.id);
    if (!j || j.user_id !== req.user.id)
      throw fault(404, "NOT_FOUND", "任务不存在");
    res.json(view(await run(j.id)));
  });
  app.post("/api/exports/:id/cancel", auth, account, async (req, res) => {
    const j = get(req.params.id);
    if (!j || j.user_id !== req.user.id)
      throw fault(404, "NOT_FOUND", "任务不存在");
    const result = await exclusive(j.id, async () => {
      const fresh = get(j.id);
      if (fresh.intent === "hold") update(j.id, { intent: "cancel" });
      // Submission already staged: finish/recover its authoritative outcome; never trust a client refund claim.
      return progress(j.id);
    });
    res
      .status(result.status === "pending_recovery" ? 202 : 200)
      .json(view(result));
  });
  app.put(
    "/api/exports/:id/file",
    auth,
    (req, res, next) => {
      if (String(req.get("x-studio-user")) !== String(req.user.id))
        return next(fault(412, "ACCOUNT_CHANGED", "登录身份已改变"));
      next();
    },
    express.raw({ type: "application/octet-stream", limit: "128mb" }),
    async (req, res) => {
      const j = get(req.params.id);
      if (!j || j.user_id !== req.user.id)
        throw fault(404, "NOT_FOUND", "任务不存在或无权访问");
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length < 8)
        throw fault(400, "INVALID_FILE", "文件内容无效");
      const ext = data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "png"
        : data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
          ? "zip"
          : null;
      if (!ext) throw fault(400, "INVALID_FILE", "仅接受PNG或ZIP");
      const digest = createHash("sha256").update(data).digest("hex");
      let name;
      try {
        name = decodeURIComponent(req.get("x-filename") || "图纸");
      } catch {
        throw fault(400, "INVALID_FILENAME", "文件名无效");
      }
      name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
      if (!name.endsWith("." + ext)) name += "." + ext;
      const result = await exclusive(j.id, async () => {
        const fresh = get(j.id);
        if (fresh.file_hash && fresh.file_hash !== digest)
          throw fault(409, "ARTIFACT_CHANGED", "同一任务不能更换文件");
        if (
          ["cancelled", "expired", "refunded", "rejected"].includes(
            fresh.status,
          )
        )
          throw fault(409, "TASK_CLOSED", "任务已结束");
        if (!fresh.file_hash) {
          if (fresh.intent !== "hold")
            throw fault(409, "TASK_CLOSED", "任务不可提交");
          const target = path.join(dir, j.id + "." + ext),
            temp = target + ".tmp";
          fs.writeFileSync(temp, data, { mode: 0o600 });
          fs.renameSync(temp, target);
          update(j.id, {
            filename: name,
            extension: ext,
            file_hash: digest,
            intent: "deliver",
          });
        }
        return progress(j.id);
      });
      res
        .status(
          result.status === "pending_recovery"
            ? 202
            : result.status === "ready"
              ? 200
              : 409,
        )
        .json({
          ...view(result),
          ok: result.status === "ready",
          error:
            result.status === "ready"
              ? undefined
              : "结算结果待核实或任务已结束，请查询原任务",
        });
    },
  );
  app.get("/api/exports/:id/download", auth, async (req, res) => {
    let j = get(req.params.id);
    if (!j || j.user_id !== req.user.id)
      throw fault(404, "NOT_FOUND", "文件不存在或无权访问");
    j = await run(j.id);
    if (j.status !== "ready")
      throw fault(
        j.status === "pending_recovery" ? 503 : 409,
        "TASK_NOT_READY",
        "原任务尚未确认可交付，请在账号模块查看恢复状态",
      );
    res.set(
      "Content-Type",
      j.extension === "png" ? "image/png" : "application/zip",
    );
    if (req.query.preview === "1")
      res.set(
        "Content-Disposition",
        "inline; filename*=UTF-8''" + encodeURIComponent(j.filename),
      );
    else res.attachment(j.filename);
    res.sendFile(file(j));
  });
  async function recoverPending() {
    for (const j of db
      .prepare(
        "SELECT id FROM export_jobs WHERE status IN ('initiating','reserved','pending_recovery') ORDER BY created LIMIT 100",
      )
      .all())
      await run(j.id);
  }
  const timer = setInterval(() => recoverPending().catch(() => {}), 30000);
  timer.unref();
  setTimeout(() => recoverPending().catch(() => {}), 100).unref();
  return { run, recoverPending, view };
}
