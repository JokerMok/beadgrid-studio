import { chromium } from "playwright";
import fs from "node:fs";
const b = await chromium.launch({ headless: true }),
  p = await b.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
p.on("pageerror", (e) => console.log("ERROR", e.message));
try {
  await p.goto(process.env.TEST_URL || "http://127.0.0.1:4173/");
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p
    .getByTestId("image-input")
    .setInputFiles("tests/fixtures/synthetic-illustration.png");
  const d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.waitFor();
  await p.screenshot({
    animations: "disabled",
    path: "verification/v1.1-comparison/local-upload.png",
  });
  await d.getByLabel("导入宽度").fill("32");
  await d.getByLabel("导入高度").fill("32");
  await d.getByLabel("导入最大颜色数").fill("8");
  await d.getByRole("button", { name: "确认裁剪并生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  await p.getByRole("button", { name: "手型", exact: true }).click();
  await p.getByRole("button", { name: "关闭提示", exact: true }).click();
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.screenshot({
    animations: "disabled",
    path: "verification/v1.1-comparison/local-uploaded-32-8.png",
  });
  const data = await p.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      header: rect(document.querySelector(".app-header")),
      tools: rect(document.querySelector(".tool-rail")),
      editor: rect(document.querySelector(".editor-column")),
      tabs: rect(document.querySelector(".view-tabs")),
      canvas: rect(document.querySelector(".canvas-shell")),
      inspector: rect(document.querySelector(".settings-panel")),
      text: document.body.innerText,
    };
  });
  fs.writeFileSync(
    "verification/v1.1-comparison/local-layout.json",
    JSON.stringify(data, null, 2),
  );
  console.log(data);
  await p.getByRole("button", { name: "自选颜色", exact: true }).click();
  await p.screenshot({
    animations: "disabled",
    path: "verification/v1.1-comparison/local-color-picker.png",
  });
  await p.getByRole("button", { name: "关闭弹窗" }).click();
  await p.getByRole("button", { name: "下载图纸", exact: true }).click();
  await p.screenshot({
    animations: "disabled",
    path: "verification/v1.1-comparison/local-export-dialog.png",
  });
} finally {
  await b.close();
}
