import { useEffect, useMemo, useRef, useState } from "react";
import { buildChart, nearestPoint } from "../launchpad/chartMath";
import { CHART_RANGES, fetchCandles } from "../launchpad/vestigeApi";
import { formatPrice } from "../launchpad/tokenView";

const W = 640;
const H = 220;

function when(seconds, range) {
  const date = new Date(seconds * 1000);
  return range === "1D" ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Price in ALGO from Vestige's candles. If Vestige cannot be reached the chart says so and the rest of the page is unaffected. */
export default function PriceChart({ assetId, launchTime }) {
  const [range, setRange] = useState("7D");
  const [state, setState] = useState({ status: "loading", candles: [] });
  const [hover, setHover] = useState(null);
  const svg = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState((old) => ({ ...old, status: "loading" }));
    fetchCandles({ assetId, range, launchTime })
      .then((candles) => { if (!cancelled) setState({ status: "ready", candles }); })
      .catch(() => { if (!cancelled) setState({ status: "error", candles: [] }); });
    return () => { cancelled = true; };
  }, [assetId, range, launchTime]);

  const chart = useMemo(() => buildChart(state.candles, { width: W, height: H }), [state.candles]);
  const shown = hover ?? chart?.points.at(-1) ?? null;
  const rising = chart?.changePct === null || chart?.changePct === undefined ? true : chart.changePct >= 0;

  const move = (event) => {
    if (!chart || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    setHover(nearestPoint(chart, ((event.clientX - box.left) / box.width) * W));
  };

  return (
    <section className="instant-card price-chart" aria-label="Price chart">
      <div className="price-chart-head">
        <h2>Price chart <small className="price-chart-source">from Vestige</small></h2>
        <div className="price-chart-ranges" role="group" aria-label="Chart range">
          {Object.keys(CHART_RANGES).map((name) => (
            <button key={name} type="button" className={name === range ? "is-active" : ""} aria-pressed={name === range} onClick={() => setRange(name)}>{name}</button>
          ))}
        </div>
      </div>
      {state.status === "error" ? <p className="field-hint">The price chart could not be loaded right now (it comes from Vestige).</p> : null}
      {state.status === "ready" && !chart ? <p className="field-hint">No price history in this period yet.</p> : null}
      {chart ? (
        <>
          <div className="price-chart-read">
            <strong>{formatPrice(shown.candle.close)} ALGO</strong>
            <span>{when(shown.candle.time, range)}</span>
            {!hover && chart.changePct !== null ? <span className={rising ? "price-up" : "price-down"}>{rising ? "+" : ""}{chart.changePct.toFixed(2)}% over {range === "ALL" ? "its life" : range}</span> : null}
          </div>
          <svg ref={svg} className={`price-chart-svg ${rising ? "is-up" : "is-down"}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
            aria-label={`Price from ${formatPrice(chart.points[0].candle.close)} to ${formatPrice(chart.last)} ALGO`}
            onPointerMove={move} onPointerLeave={() => setHover(null)}>
            <path className="price-chart-area" d={chart.area} />
            <path className="price-chart-line" d={chart.line} vectorEffect="non-scaling-stroke" />
            {hover ? <line className="price-chart-cross" x1={hover.x} x2={hover.x} y1="0" y2={H} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          <div className="price-chart-axis"><span>{formatPrice(chart.min)}</span><span>{formatPrice(chart.max)} ALGO</span></div>
          <p className="field-hint">Chart prices are Vestige's and can differ by a percent or two from the price worked out from the pool above.</p>
        </>
      ) : state.status === "loading" ? <p className="field-hint">Loading price history…</p> : null}
    </section>
  );
}
