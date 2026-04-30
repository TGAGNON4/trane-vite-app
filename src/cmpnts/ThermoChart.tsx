// src/cmpnts/ThermoChart.tsx
// Thermodynamic chart panel: time-series, P-h diagram, and P vs T.
// Saturation table and state point enthalpies come from the Pi via MQTT
// (computed by CoolProp on the Pi) rather than a hardcoded table.

import React, { useState, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ScatterController,
  LineController,
  Filler,
  Tooltip,
  Legend,
  Decimation,
  type ChartOptions,
  type ChartData,
} from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ScatterController,
  LineController,
  Filler,
  Tooltip,
  Legend,
  Decimation
);

// ---------------------------------------------------------------------------
// Types coming from MQTT (published by coolprop_props.py on the Pi)
// ---------------------------------------------------------------------------

/** One row of the R-1234yf saturation table, received as JSON from MQTT. */
export type SatRow = {
  T: number;      // °C
  P: number;      // kPa
  h_liq: number;  // kJ/kg
  h_vap: number;  // kJ/kg
  s_liq: number;  // kJ/(kg·K)
  s_vap: number;  // kJ/(kg·K)
};

/** CoolProp-computed properties for one cycle state point. */
export type StatePoint = {
  h: number | null;
  s: number | null;
  phase: "liquid" | "two-phase" | "gas" | "unknown";
};

/** All four cycle state points, published each sample cycle. */
export type StatePoints = {
  HighSide:   StatePoint;
  LowSide:    StatePoint;
  Evaporator: StatePoint;
  EXV:        StatePoint;
};

// ---------------------------------------------------------------------------
// Sensor arrays passed in from App
// ---------------------------------------------------------------------------
export type ThermoSensors = {
  highTemp: number[];
  highPressure: number[];
  expTemp: number[];
  expPressure: number[];
  lowTemp: number[];
  lowPressure: number[];
  evapTemp: number[];
  evapPressure: number[];
  spaceTemp: number[];
  dischargeTemp: number[];
  labels: number[];
  setpointData: number[];
};

type Props = {
  sensors: ThermoSensors;
  /** Full R-1234yf saturation table from MQTT (null until received). */
  satTable: SatRow[] | null;
  /** Latest CoolProp state points from MQTT (null until received). */
  statePoints: StatePoints | null;
  temperatureUnit: "°C" | "°F";
  displayUnits: "metric" | "imperial";
};

type Mode = "timeseries" | "ph" | "pt";

const MODE_HELP: Record<Mode, string> = {
  timeseries:
    "Live sensor readings over time. Solid lines are temperatures (left axis); dashed lines are pressures (right axis). Toggle which series to show with the buttons above the chart. The setpoint line is the target space temperature; the shaded band shows how far the discharge air is from it.",
  ph:
    "Pressure vs Enthalpy diagram for R-1234yf. The blue dome shows where the refrigerant changes phase: left of dome = subcooled liquid, inside = two-phase mixture, right = superheated gas. The 4 colored dots are your live sensor states placed by enthalpy (kJ/kg) and pressure; the dashed line connects them in circuit order (Evaporator → High side → EXV → Low side). A healthy cycle shows compression (vertical rise on the right), condensation (move left across the top), expansion (vertical drop), evaporation (move right across the bottom). Enthalpy is computed by CoolProp on the Pi from each sensor's (T, P).",
  pt:
    "Pressure vs Temperature for R-1234yf. The curve is the saturation line — the boiling/condensing pressure at each temperature. A point sitting on the curve means the refrigerant is two-phase at that sensor; above the curve = subcooled liquid; below = superheated gas. Most sensors are in single-phase sections (suction, liquid, discharge lines), so they sit off the curve by design.",
};

const TS_KEYS = [
  { key: "highTemp",      label: "High side temp",      isPressure: false },
  { key: "expTemp",       label: "EXV temp",            isPressure: false },
  { key: "lowTemp",       label: "Low side temp",       isPressure: false },
  { key: "evapTemp",      label: "Evaporator temp",     isPressure: false },
  { key: "spaceTemp",     label: "Space temp",          isPressure: false },
  { key: "dischargeTemp", label: "Discharge air temp",  isPressure: false },
  { key: "setpointData",  label: "Setpoint",            isPressure: false },
  { key: "highPressure",  label: "High side pressure",  isPressure: true  },
  { key: "expPressure",   label: "EXV pressure",        isPressure: true  },
  { key: "lowPressure",   label: "Low side pressure",   isPressure: true  },
  { key: "evapPressure",  label: "Evaporator pressure", isPressure: true  },
] as const;

type TsKey = typeof TS_KEYS[number]["key"];

const COLORS: Record<TsKey, string> = {
  highTemp:      "#e05a2b",
  expTemp:       "#c94fa0",
  lowTemp:       "#3278d8",
  evapTemp:      "#2faa7e",
  spaceTemp:     "#8c6fd1",
  dischargeTemp: "#e8a020",
  setpointData:  "#888780",
  highPressure:  "#b03010",
  expPressure:   "#8f2070",
  lowPressure:   "#1050a0",
  evapPressure:  "#0f7050",
};

const PH_COLORS = {
  high: "#e05a2b",
  low:  "#3278d8",
  evap: "#2faa7e",
  exv:  "#c94fa0",
  dome: "#3278d8",
};

const PHASE_COLOR: Record<string, string> = {
  "liquid":    "#3278d8",
  "two-phase": "#2faa7e",
  "gas":       "#e05a2b",
  "unknown":   "#888780",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const ThermoChart: React.FC<Props> = ({
  sensors,
  satTable,
  statePoints,
  temperatureUnit,
  displayUnits,
}) => {
  const [mode, setMode] = useState<Mode>("timeseries");
  const [selectedKeys, setSelectedKeys] = useState<Set<TsKey>>(
    new Set(["dischargeTemp", "setpointData"] as TsKey[])
  );
  const [helpOpen, setHelpOpen] = useState(false);

  const toDisplayTemp = (c: number) =>
    displayUnits === "metric" ? c : c * 9 / 5 + 32;
  const toDisplayPressure = (pa: number) =>
    displayUnits === "metric" ? pa / 1000 : pa / 6894.757;
  const pressureUnit = displayUnits === "metric" ? "kPa" : "psi";

  // ── Time-series ──────────────────────────────────────────────────────────
  const tsData = useCallback((): ChartData<"line"> => {
    const formattedLabels = sensors.labels.map(ts =>
      new Date(ts).toLocaleTimeString()
    );

    const showControlPair =
      selectedKeys.has("dischargeTemp") && selectedKeys.has("setpointData");

    const datasets = Array.from(selectedKeys)
      // When showing the control pair, render dischargeTemp first so fill '+1' targets setpoint
      .sort((a, b) => {
        if (!showControlPair) return 0;
        if (a === "dischargeTemp") return -1;
        if (b === "dischargeTemp") return 1;
        if (a === "setpointData") return -1;
        if (b === "setpointData") return 1;
        return 0;
      })
      .map((key) => {
        const entry = TS_KEYS.find(t => t.key === key)!;
        const raw: number[] = (sensors as any)[key] ?? [];
        const data = raw.map(v =>
          entry.isPressure ? toDisplayPressure(v) : toDisplayTemp(v)
        );

        // discharge temp: fill toward setpoint line (next dataset when sorted)
        const isDischarge = showControlPair && key === "dischargeTemp";
        const isSetpoint  = showControlPair && key === "setpointData";

        return {
          label: isSetpoint ? "Setpoint (target)" : entry.label,
          data,
          borderColor: COLORS[key],
          backgroundColor: COLORS[key] + "33",
          borderDash: (entry.isPressure || isSetpoint) ? ([6, 3] as number[]) : ([] as number[]),
          borderWidth: isSetpoint ? 1.5 : 2,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: entry.isPressure ? "yPres" : "yTemp",
          // fill the gap between discharge temp and the setpoint line
          ...(isDischarge ? {
            fill: { target: "+1", above: "rgba(224,90,43,0.18)", below: "rgba(50,120,216,0.18)" },
          } : {}),
          order: isSetpoint ? 2 : 1,
        };
      });

    return { labels: formattedLabels, datasets };
  }, [sensors, selectedKeys, displayUnits]);

  const tsOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 150 },
    plugins: { legend: { display: true, labels: { color: "#e5e7eb", boxWidth: 12 } } },
    scales: {
      x: {
        ticks: {
          color: "#9ca3af",
          callback: function (this: any, value: any, index: number, ticks: any[]) {
            if (index === 0 || index === ticks.length - 2) return this.getLabelForValue(value);
            return "";
          },
        },
        grid: { color: "#1f2937" },
      },
      yTemp: {
        type: "linear",
        position: "left",
        title: { display: true, text: `Temperature (${temperatureUnit})`, color: "#9ca3af" },
        ticks: { color: "#9ca3af" },
        grid: { color: "#1f2937" },
      },
      yPres: {
        type: "linear",
        position: "right",
        title: { display: true, text: `Pressure (${pressureUnit})`, color: "#9ca3af" },
        ticks: { color: "#9ca3af" },
        grid: { display: false },
      },
    },
  };

  // Converts a kPa value to the display pressure unit
  const kPaToDisplay = (kpa: number) => displayUnits === "metric" ? kpa : kpa / 6.89476;
  const pMin = kPaToDisplay(40);

  // ── P-h diagram ──────────────────────────────────────────────────────────
  const dome = satTable
    ? [
        ...satTable.map(r => ({ x: r.h_liq, y: kPaToDisplay(r.P) })),
        ...[...satTable].reverse().map(r => ({ x: r.h_vap, y: kPaToDisplay(r.P) })),
      ]
    : [];

  // Axis bounds derived from sat table so the full dome is always visible
  const phXMin = satTable ? Math.floor(Math.min(...satTable.map(r => r.h_liq)) - 20) : 140;
  const phXMax = satTable ? Math.ceil( Math.max(...satTable.map(r => r.h_vap)) + 20) : 500;
  const phYMax = satTable ? Math.ceil( kPaToDisplay(Math.max(...satTable.map(r => r.P))) * 1.08) : kPaToDisplay(3800);

  // Cycle point order follows the physical circuit:
  //   Evaporator outlet → Compressor (HighSide) → Condenser/EXV inlet → LowSide → back
  const phLivePoints = () => {
    if (!statePoints) return [];
    return [
      { label: "Evaporator", sp: statePoints.Evaporator, pDisplay: kPaToDisplay((sensors.evapPressure.slice(-1)[0] ?? NaN) / 1000), color: PH_COLORS.evap },
      { label: "High side",  sp: statePoints.HighSide,   pDisplay: kPaToDisplay((sensors.highPressure.slice(-1)[0] ?? NaN) / 1000), color: PH_COLORS.high },
      { label: "EXV",        sp: statePoints.EXV,        pDisplay: kPaToDisplay((sensors.expPressure.slice(-1)[0]  ?? NaN) / 1000), color: PH_COLORS.exv  },
      { label: "Low side",   sp: statePoints.LowSide,    pDisplay: kPaToDisplay((sensors.lowPressure.slice(-1)[0]  ?? NaN) / 1000), color: PH_COLORS.low  },
    ].filter(pt => pt.sp.h !== null && !isNaN(pt.pDisplay));
  };

  const phData = useCallback((): ChartData<"scatter"> => {
    const live = phLivePoints();
    // Draw cycle path with however many valid points are available (≥2)
    const cycleData = live.length >= 2
      ? [...live.map(p => ({ x: p.sp.h as number, y: p.pDisplay })), { x: live[0].sp.h as number, y: live[0].pDisplay }]
      : [];
    return {
      datasets: [
        {
          label: "Saturation dome",
          data: dome as any,
          borderColor: PH_COLORS.dome,
          backgroundColor: "rgba(50,120,216,0.08)",
          showLine: true,
          fill: true,
          pointRadius: 0,
          borderWidth: 1.5,
          order: 10,
        } as any,
        {
          label: "Cycle path",
          data: cycleData as any,
          borderColor: "rgba(200,200,200,0.5)",
          backgroundColor: "transparent",
          showLine: true,
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [5, 3],
          order: 5,
        } as any,
        ...live.map(pt => ({
          label: pt.label,
          data: [{ x: pt.sp.h as number, y: pt.pDisplay }] as any,
          backgroundColor: pt.color,
          pointRadius: 7,
          pointHoverRadius: 9,
          order: 1,
        })),
      ],
    };
  }, [sensors, statePoints, satTable, displayUnits]);

  const phOptions: ChartOptions<"scatter"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, labels: { color: "#e5e7eb", boxWidth: 10 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const lbl = ctx.dataset.label ?? "";
            if (lbl === "Saturation dome" || lbl === "Cycle path") return "";
            return `${lbl}: h=${(ctx.parsed.x as number).toFixed(1)} kJ/kg, P=${(ctx.parsed.y as number).toFixed(displayUnits === "metric" ? 0 : 2)} ${pressureUnit}`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: "Enthalpy (kJ/kg)", color: "#9ca3af" }, min: phXMin, max: phXMax, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      y: { title: { display: true, text: `Pressure (${pressureUnit})`, color: "#9ca3af" }, min: pMin, max: phYMax, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
    },
  };

  // ── P-T diagram ──────────────────────────────────────────────────────────
  const satCurve = satTable
    ? satTable.map(r => ({ x: toDisplayTemp(r.T), y: kPaToDisplay(r.P) }))
    : [];

  const ptYMax = satTable ? Math.ceil(kPaToDisplay(Math.max(...satTable.map(r => r.P))) * 1.08) : kPaToDisplay(2400);
  const ptXMin = toDisplayTemp(-45);
  const ptXMax = toDisplayTemp(100);

  const ptData = useCallback((): ChartData<"scatter"> => {
    const pts = [
      { label: "High side",  T: sensors.highTemp,  P: sensors.highPressure,  color: PH_COLORS.high },
      { label: "Low side",   T: sensors.lowTemp,   P: sensors.lowPressure,   color: PH_COLORS.low  },
      { label: "Evaporator", T: sensors.evapTemp,  P: sensors.evapPressure,  color: PH_COLORS.evap },
      { label: "EXV",        T: sensors.expTemp,   P: sensors.expPressure,   color: PH_COLORS.exv  },
    ];
    return {
      datasets: [
        {
          label: "Saturation curve",
          data: satCurve as any,
          borderColor: PH_COLORS.dome,
          backgroundColor: "transparent",
          showLine: true,
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5,
          order: 10,
        } as any,
        ...pts.map(pt => {
          const T = pt.T.slice(-1)[0];
          const P = pt.P.slice(-1)[0];
          const valid = T !== undefined && P !== undefined && !isNaN(T) && !isNaN(P);
          return {
            label: pt.label,
            data: valid ? [{ x: toDisplayTemp(T), y: kPaToDisplay(P / 1000) }] as any : [],
            backgroundColor: pt.color,
            pointRadius: 7,
            pointHoverRadius: 9,
            order: 1,
          };
        }),
      ],
    };
  }, [sensors, satTable, displayUnits]);

  const ptOptions: ChartOptions<"scatter"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, labels: { color: "#e5e7eb", boxWidth: 10 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.dataset.label === "Saturation curve") return "";
            return `${ctx.dataset.label}: T=${(ctx.parsed.x as number).toFixed(1)}${temperatureUnit}, P=${(ctx.parsed.y as number).toFixed(displayUnits === "metric" ? 0 : 2)} ${pressureUnit}`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: `Temperature (${temperatureUnit})`, color: "#9ca3af" }, min: ptXMin, max: ptXMax, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      y: { title: { display: true, text: `Pressure (${pressureUnit})`,       color: "#9ca3af" }, min: pMin,   max: ptYMax, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
    },
  };

  // ── Series toggle ─────────────────────────────────────────────────────────
  const CONTROL_PAIR = new Set<TsKey>(["dischargeTemp", "setpointData"]);

  const toggleKey = (key: TsKey) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) {
          next.delete(key);
          // keep the pair together
          if (CONTROL_PAIR.has(key)) CONTROL_PAIR.forEach(k => next.delete(k));
        }
      } else {
        next.add(key);
        // keep the pair together
        if (CONTROL_PAIR.has(key)) CONTROL_PAIR.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const satReady = satTable !== null && satTable.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div className="tab-row" style={{ alignItems: "center" }}>
        {(["timeseries", "ph", "pt"] as Mode[]).map(m => (
          <button
            key={m}
            type="button"
            className={`tab-btn ${mode === m ? "is-active" : ""}`}
            onClick={() => setMode(m)}
          >
            {m === "timeseries" ? "Time-series" : m === "ph" ? "P-h diagram" : "P vs T"}
          </button>
        ))}
        <span
          tabIndex={0}
          aria-label={`About this chart: ${MODE_HELP[mode]}`}
          onMouseEnter={() => setHelpOpen(true)}
          onMouseLeave={() => setHelpOpen(false)}
          onFocus={() => setHelpOpen(true)}
          onBlur={() => setHelpOpen(false)}
          onClick={() => setHelpOpen(v => !v)}
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.25rem",
            height: "1.25rem",
            borderRadius: "50%",
            border: "1px solid #6b7280",
            color: "#9ca3af",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "help",
            marginLeft: "0.25rem",
            userSelect: "none",
          }}
        >
          ?
          {helpOpen && (
            <span
              role="tooltip"
              style={{
                position: "absolute",
                top: "calc(100% + 0.4rem)",
                left: 0,
                zIndex: 20,
                width: "min(420px, 80vw)",
                padding: "0.6rem 0.75rem",
                background: "#0f172a",
                color: "#e5e7eb",
                border: "1px solid #374151",
                borderRadius: "0.4rem",
                fontSize: "0.78rem",
                fontWeight: 400,
                lineHeight: 1.5,
                boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
                whiteSpace: "normal",
                textAlign: "left",
                cursor: "default",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.3rem", color: "#f3f4f6" }}>
                {mode === "timeseries" ? "Time-series" : mode === "ph" ? "P-h diagram" : "P vs T diagram"}
              </div>
              {MODE_HELP[mode]}
            </span>
          )}
        </span>
      </div>

      {mode === "timeseries" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {TS_KEYS.map(({ key, label, isPressure }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleKey(key)}
              style={{
                fontSize: "0.75rem",
                padding: "0.2rem 0.5rem",
                borderRadius: "0.3rem",
                border: `1px solid ${selectedKeys.has(key) ? COLORS[key] : "#374151"}`,
                background: selectedKeys.has(key) ? COLORS[key] + "33" : "transparent",
                color: selectedKeys.has(key) ? COLORS[key] : "#9ca3af",
                cursor: "pointer",
                borderStyle: isPressure ? "dashed" : "solid",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(mode === "ph" || mode === "pt") && !satReady && (
        <div style={{ fontSize: "0.8rem", color: "#6b7280", padding: "0.25rem 0" }}>
          Waiting for R-1234yf saturation table from Pi...
        </div>
      )}

      {mode === "ph" && statePoints && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["HighSide", "LowSide", "Evaporator", "EXV"] as const).map(k => {
            const sp = statePoints[k];
            return (
              <span key={k} style={{
                fontSize: "0.7rem", padding: "0.15rem 0.45rem", borderRadius: "0.25rem",
                background: PHASE_COLOR[sp.phase] + "33", color: PHASE_COLOR[sp.phase],
                border: `1px solid ${PHASE_COLOR[sp.phase]}55`,
              }}>
                {k.replace("HighSide", "High").replace("LowSide", "Low")}: {sp.phase}
                {sp.h !== null ? ` · ${sp.h.toFixed(1)} kJ/kg` : ""}
              </span>
            );
          })}
        </div>
      )}

      <div style={{ height: "clamp(260px, 42vh, 520px)", position: "relative" }}>
        {mode === "timeseries" && <Chart type="line"    data={tsData()} options={tsOptions} />}
        {mode === "ph"         && <Chart type="scatter" data={phData()} options={phOptions} />}
        {mode === "pt"         && <Chart type="scatter" data={ptData()} options={ptOptions} />}
      </div>

      {mode === "ph" && satReady && (
        <div style={{ fontSize: "0.72rem", color: "#6b7280", lineHeight: 1.5 }}>
          The dome shows where R-1234yf changes phase: left of dome = subcooled liquid, inside = two-phase mixture, right = superheated gas.
          The dashed cycle path connects the four sensor points in circuit order (evaporator outlet → compressor → condenser → EXV → back).
          {statePoints && " Enthalpies computed by CoolProp on the Pi."}
        </div>
      )}
      {mode === "pt" && satReady && (
        <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>
          Saturation curve shows the boiling/condensing pressure at each temperature.
          Points on the curve are in two-phase; above it is subcooled liquid; below is superheated gas.
        </div>
      )}
    </div>
  );
};
