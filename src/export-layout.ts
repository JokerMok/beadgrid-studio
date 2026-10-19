export function chartLayout(
  width: number,
  height: number,
  colors: number,
  cell = 56,
) {
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1100))
    throw Error("无效的图纸尺寸");
  const columns =
      colors > 144
        ? 10
        : colors > 96
          ? 8
          : colors > 48 || width / height >= 1.6
            ? 6
            : 4,
    legendRows = Math.max(1, Math.ceil(colors / columns));
  const build = (size: number) => {
    const margin = Math.round(2.4 * size),
      headerHeight = Math.round(4.6 * size),
      legendGap = Math.round(1.4 * size),
      legendHeaderHeight = Math.round(1.95 * size),
      legendRowHeight = Math.round(1.68 * size),
      footerHeight = Math.round(1.25 * size),
      contentWidth = Math.ceil(Math.max(width, columns * 6.5) * size),
      canvasWidth = margin * 2 + contentWidth,
      canvasHeight =
        headerHeight +
        height * size +
        legendGap +
        legendHeaderHeight +
        legendRows * legendRowHeight +
        footerHeight,
      long = Math.max(canvasWidth, canvasHeight);
    return {
      cell: size,
      columns,
      legendRows,
      margin,
      headerHeight,
      legendGap,
      legendHeaderHeight,
      legendRowHeight,
      footerHeight,
      contentWidth,
      chartWidth: width * size,
      chartHeight: height * size,
      canvasWidth,
      canvasHeight,
      tier:
        long <= 8192
          ? long <= 4200
            ? "4K"
            : "8K"
          : `${Math.ceil(long / 1024)}K`,
    };
  };
  let p = build(cell);
  while (Math.max(p.canvasWidth, p.canvasHeight) < 4096) p = build(++cell);
  return p;
}
export function legendLayout(colors: number) {
  const n = Math.max(1, colors || 1),
    columns = n > 160 ? 6 : n > 96 ? 5 : n > 48 ? 4 : 3,
    canvasWidth = columns * 420 + 140,
    canvasHeight = 250 + Math.ceil(n / columns) * 88 + 110;
  return {
    columns,
    cardWidth: 420,
    rowHeight: 88,
    headerHeight: 250,
    footerHeight: 110,
    canvasWidth,
    canvasHeight,
    tier:
      Math.max(canvasWidth, canvasHeight) <= 2048
        ? "2K"
        : Math.max(canvasWidth, canvasHeight) <= 4096
          ? "4K"
          : "8K",
  };
}
export function physicalPlan(width: number, height: number, size: number) {
  const columns = Math.ceil(width / size),
    rows = Math.ceil(height / size);
  return {
    size,
    columns,
    rows,
    count: columns * rows,
    totalWidth: columns * size,
    totalHeight: rows * size,
    offsetX: Math.floor((columns * size - width) / 2),
    offsetY: Math.floor((rows * size - height) / 2),
  };
}
