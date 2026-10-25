// Geometry for the price chart: turns candles into an SVG line and area. Pure, so it can be tested without a browser.

/** Candles (oldest first) as chart geometry in a `width` x `height` box, or null when there is nothing to draw. Price runs on the close of each candle. */
export function buildChart(candles, { width = 640, height = 220, padX = 6, padTop = 12, padBottom = 14 } = {}) {
  if (!candles?.length) return null;
  const series = candles.length === 1 ? [candles[0], { ...candles[0], time: candles[0].time + 1 }] : candles;
  const t0 = series[0].time;
  const t1 = series.at(-1).time;
  let min = Math.min(...series.map((candle) => candle.low));
  let max = Math.max(...series.map((candle) => candle.high));
  // a flat price still needs a visible band
  if (max - min < max * 1e-6) { min = max * 0.98; max *= 1.02; }
  const margin = (max - min) * 0.06;
  min -= margin;
  max += margin;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const x = (time) => padX + (t1 === t0 ? 0 : ((time - t0) / (t1 - t0)) * plotW);
  const y = (price) => padTop + (1 - (price - min) / (max - min)) * plotH;
  const points = series.map((candle) => ({ x: x(candle.time), y: y(candle.close), candle }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const base = (height - padBottom).toFixed(1);
  const area = `${line} L${points.at(-1).x.toFixed(1)} ${base} L${points[0].x.toFixed(1)} ${base} Z`;
  const first = series[0].open;
  const last = series.at(-1).close;
  return { width, height, points, line, area, min, max, changePct: first > 0 ? (last / first - 1) * 100 : null, last };
}

/** The point nearest to a horizontal position (in the chart's own coordinates). */
export function nearestPoint(chart, x) {
  let best = chart.points[0];
  for (const point of chart.points) if (Math.abs(point.x - x) < Math.abs(best.x - x)) best = point;
  return best;
}
