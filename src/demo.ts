import { blank, nearest } from "./model";
export function makeDemo() {
  const p = blank(104, 78);
  p.name = "林间小屋 · 本地示例";
  p.settings.limit = 24;
  const c = p.cells;
  const color = (h: string) =>
    nearest(
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    );
  const sky = color("#e6f1df"),
    leaf = color("#478d68"),
    dark = color("#235749"),
    light = color("#a5c584"),
    cream = color("#f5dda7"),
    roof = color("#bd704f"),
    shadow = color("#9d614e"),
    window = color("#6b9b9f"),
    wood = color("#715642");
  for (let y = 0; y < 78; y++)
    for (let x = 0; x < 104; x++) {
      let v = sky;
      if (y > 42 + Math.sin(x * 0.07) * 8) v = light;
      if (y > 64 + Math.sin(x * 0.13) * 3) v = leaf;
      for (const [tx, ty, r] of [
        [16, 25, 18],
        [85, 27, 22],
        [2, 40, 16],
        [102, 45, 18],
      ]) {
        if (Math.abs(x - tx) < 2 && y > ty && y < 70) v = wood;
        if (((x - tx) / r) ** 2 + ((y - ty) / (r * 1.1)) ** 2 < 1)
          v = (x + y) % 7 === 0 ? light : x < tx ? dark : leaf;
      }
      if (x >= 32 && x <= 72 && y >= 35 && y <= 63) v = cream;
      if (y >= 22 && y <= 37 && Math.abs(x - 52) < (y - 20) * 1.7) v = roof;
      if (y >= 35 && y <= 38 && x > 25 && x < 80) v = shadow;
      if (x >= 48 && x <= 57 && y >= 47 && y <= 63) v = wood;
      if (((x >= 37 && x <= 43) || (x >= 62 && x <= 68)) && y >= 43 && y <= 52)
        v = window;
      if ((x === 40 || x === 65) && y >= 43 && y <= 52) v = cream;
      if (y === 48 && ((x >= 37 && x <= 43) || (x >= 62 && x <= 68))) v = cream;
      if (y > 63 && Math.abs(x - 53) < (y - 59) * 0.5) v = cream;
      if ((x * 73 + y * 97) % 127 === 0 && y > 61) v = color("#f8eb6b");
      c[y * 104 + x] = v;
    }
  return p;
}
