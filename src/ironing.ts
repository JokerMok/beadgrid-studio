export const IRON_STYLES = [
  ["regular", "常规烫", "圆孔保留 · 紧密熔接"],
  ["cinderella", "仙度瑞拉烫", "连续横向熔纹"],
  ["waffle", "华夫格烫", "连片立体方格"],
  ["baking-paper", "烘焙纸烫", "连片柔和褶皱"],
  ["towel", "毛巾烫", "连片蓬松绒圈"],
  ["wet-towel", "漂巾烫", "连片细密波纹"],
  ["glitter-fine", "细网格丽特烫", "融合均匀细闪"],
  ["glitter-coarse", "粗网格丽特烫", "融合明显粗闪"],
] as const;
export type IronStyle = (typeof IRON_STYLES)[number][0];
// Surface simulation only. Palette/grid/export values remain unchanged.
export function drawIron(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: number,
  hex: string,
  style: IronStyle,
  col: number,
  row: number,
) {
  g.save();
  g.fillStyle = hex;
  g.lineJoin = "round";
  g.fillRect(x - c * 0.018, y - c * 0.018, c * 1.036, c * 1.036);
  const cx = x + c / 2,
    cy = y + c / 2,
    thin = Math.max(0.42, c * 0.045),
    seed = (col * 17 + row * 29) % 37;
  const line = (ax: number, ay: number, bx: number, by: number) => {
    g.beginPath();
    g.moveTo(x + ax * c, y + ay * c);
    g.lineTo(x + bx * c, y + by * c);
    g.stroke();
  };
  if (style === "regular") {
    g.strokeStyle = "rgba(20,31,46,.16)";
    g.lineWidth = Math.max(0.4, c * 0.035);
    g.beginPath();
    g.arc(cx, cy, c * 0.385, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,.3)";
    g.beginPath();
    g.arc(
      cx - c * 0.025,
      cy - c * 0.035,
      c * 0.33,
      Math.PI * 1.08,
      Math.PI * 1.83,
    );
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, c * 0.12, 0, Math.PI * 2);
    g.fillStyle = "rgba(18,27,34,.32)";
    g.fill();
    g.beginPath();
    g.arc(cx - c * 0.025, cy - c * 0.035, c * 0.072, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,.24)";
    g.fill();
  } else if (style === "cinderella") {
    for (let n = 1; n <= 4; n++) {
      const yy = y + (c * n) / 5;
      g.strokeStyle = "rgba(18,28,38,.16)";
      g.lineWidth = Math.max(0.45, c * 0.075);
      g.beginPath();
      g.moveTo(x - c * 0.03, yy + c * 0.025);
      g.lineTo(x + c * 1.03, yy + c * 0.025);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,.42)";
      g.lineWidth = thin;
      g.beginPath();
      g.moveTo(x - c * 0.03, yy);
      g.lineTo(x + c * 1.03, yy);
      g.stroke();
    }
  } else if (style === "waffle") {
    g.strokeStyle = "rgba(255,255,255,.3)";
    g.lineWidth = thin;
    g.strokeRect(x + c * 0.055, y + c * 0.055, c * 0.89, c * 0.89);
    g.strokeStyle = "rgba(20,31,46,.16)";
    g.strokeRect(x + c * 0.2, y + c * 0.2, c * 0.6, c * 0.6);
    g.beginPath();
    g.moveTo(cx, y + c * 0.08);
    g.lineTo(cx, y + c * 0.92);
    g.moveTo(x + c * 0.08, cy);
    g.lineTo(x + c * 0.92, cy);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,.18)";
    g.fillRect(cx - c * 0.05, cy - c * 0.05, c * 0.1, c * 0.1);
  } else if (style === "baking-paper") {
    g.strokeStyle = "rgba(255,255,255,.4)";
    g.lineWidth = Math.max(0.4, c * 0.055);
    g.beginPath();
    g.moveTo(x - c * 0.02, y + c * (0.18 + (seed % 3) * 0.08));
    g.quadraticCurveTo(
      x + c * 0.42,
      y + c * 0.04,
      x + c * 1.02,
      y + c * (0.34 + (seed % 2) * 0.08),
    );
    g.moveTo(x + c * (0.12 + (seed % 2) * 0.12), y - c * 0.02);
    g.quadraticCurveTo(
      x + c * 0.58,
      y + c * 0.48,
      x + c * (0.78 + (seed % 3) * 0.05),
      y + c * 1.02,
    );
    g.stroke();
    g.strokeStyle = "rgba(21,31,39,.12)";
    g.lineWidth = Math.max(0.35, c * 0.035);
    g.beginPath();
    g.moveTo(x - c * 0.02, y + c * 0.72);
    g.quadraticCurveTo(cx, y + c * 0.55, x + c * 1.02, y + c * 0.76);
    g.stroke();
  } else if (style === "towel") {
    g.strokeStyle = "rgba(255,255,255,.5)";
    g.lineWidth = Math.max(0.55, c * 0.075);
    for (let n = 0; n < 3; n++) {
      const px = x + c * (0.18 + n * 0.32),
        py = y + c * (0.25 + ((n + seed) % 2) * 0.34);
      g.beginPath();
      g.arc(px, py, c * 0.18, Math.PI * 0.1, Math.PI * 1.85);
      g.stroke();
    }
    g.strokeStyle = "rgba(23,34,40,.1)";
    g.lineWidth = Math.max(0.4, c * 0.04);
    g.beginPath();
    g.moveTo(x - c * 0.02, y + c * 0.52);
    g.bezierCurveTo(
      x + c * 0.28,
      y + c * 0.35,
      x + c * 0.68,
      y + c * 0.69,
      x + c * 1.02,
      y + c * 0.48,
    );
    g.stroke();
  } else if (style === "wet-towel") {
    g.strokeStyle = "rgba(255,255,255,.38)";
    g.lineWidth = Math.max(0.42, c * 0.055);
    for (let n = 1; n <= 4; n++) {
      const yy = y + (c * n) / 5;
      g.beginPath();
      g.moveTo(x - c * 0.03, yy);
      g.bezierCurveTo(
        x + c * 0.25,
        yy - c * 0.09,
        x + c * 0.7,
        yy + c * 0.09,
        x + c * 1.03,
        yy,
      );
      g.stroke();
    }
  } else {
    g.strokeStyle = "rgba(255,255,255,.24)";
    g.lineWidth = Math.max(0.4, c * 0.04);
    line(-0.02, 0.18, 1.02, 0.78);
    const fine = style === "glitter-fine";
    for (let n = 0; n < (fine ? 5 : 3); n++) {
      const v = (seed + n * 13) % 31;
      g.beginPath();
      g.arc(
        x + c * (0.1 + (v % 9) / 11),
        y + c * (0.1 + ((v * 3) % 9) / 11),
        c * (fine ? 0.04 : 0.075),
        0,
        Math.PI * 2,
      );
      g.fillStyle = n % 2 ? "rgba(255,255,255,.92)" : "rgba(255,225,126,.94)";
      g.fill();
    }
  }
  g.restore();
}
