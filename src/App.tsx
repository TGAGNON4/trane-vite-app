// src/App.tsx
import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import { SensorCard } from "./cmpnts/SensorCard";
import { ThermoChart, type ThermoSensors, type SatRow, type StatePoints } from "./cmpnts/ThermoChart";
import { useMqtt } from "./hooks/MQTT";
import { pushRolling, saveToStorage, loadFromStorage } from "./utils/array_help";
import { RPM_MIN, RPM_MAX } from "./utils/app_helpers";
import UserManual from "./cmpnts/UserManual";

// -----------------
// Types and helpers
// -----------------

type Sensors = {
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
};

const circuits = ["Circuit1", "Circuit2"] as const;
type CircuitKey = typeof circuits[number];

const makeEmptySensors = (): Sensors => ({
  highTemp: [], highPressure: [],
  expTemp: [], expPressure: [],
  lowTemp: [], lowPressure: [],
  evapTemp: [], evapPressure: [],
  spaceTemp: [], dischargeTemp: []
});

const storageKey = (circuit: CircuitKey, key: string) => `${circuit}:${key}`;

const todayStr = () => new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

const formatDate = (dateStr: string) => {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[0]}/${parts[2]}`;
};

const sortDatesNewest = (dates: string[]) => {
  return dates.sort((a, b) => {
    const pa = a.split("-").reverse().join("");
    const pb = b.split("-").reverse().join("");
    return pb.localeCompare(pa);
  });
};

const subtractSeconds = (hhmmss: string, seconds: number): string => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  let total = Math.max(0, h * 3600 + m * 60 + s - seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return [hh, mm, ss].map(v => String(v).padStart(2, "0")).join(":");
};

const pickCircuitFromHash = () => {
  const hash = window.location.hash.replace("#/", "").replace("#", "");
  if (hash === "Circuit2" || hash === "circuit2") return "Circuit2" as const;
  return "Circuit1" as const;
};

// Source units: set to "metric" if MQTT already sends °C and Pa.
const INPUT_UNITS: "imperial" | "metric" = "metric";
const toMetricTemp = (f: number) => (f - 32) * 5 / 9;
const toMetricPressure = (psi: number) => psi * 6894.757;

export default function App() {
  // -----------------
  // State
  // -----------------
  const [activeCircuit, setActiveCircuit] = useState<CircuitKey>("Circuit1");
  const [sensors, setSensors] = useState<Record<CircuitKey, Sensors>>({
    Circuit1: { ...makeEmptySensors(), dischargeTemp: loadFromStorage<number[]>(storageKey("Circuit1", "dischargeTemp"), []) },
    Circuit2: { ...makeEmptySensors(), dischargeTemp: loadFromStorage<number[]>(storageKey("Circuit2", "dischargeTemp"), []) }
  });
  const [labels, setLabels] = useState<Record<CircuitKey, number[]>>({
    Circuit1: loadFromStorage<number[]>(storageKey("Circuit1", "labels"), []),
    Circuit2: loadFromStorage<number[]>(storageKey("Circuit2", "labels"), [])
  });
  const [setpointData, setSetpointData] = useState<Record<CircuitKey, number[]>>({
    Circuit1: loadFromStorage<number[]>(storageKey("Circuit1", "setpointData"), []),
    Circuit2: loadFromStorage<number[]>(storageKey("Circuit2", "setpointData"), [])
  });
  
  const [setpoint, setSetpoint] = useState<Record<CircuitKey, number>>({
    Circuit1: 5.0,
    Circuit2: 5.0
  });
  
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const lastDownloadDateRef = useRef<string>("");
  const hasBackfilledRef = useRef<Record<CircuitKey, boolean>>({ Circuit1: false, Circuit2: false });
  const [tempSetpointInput, setTempSetpointInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: 5.0,
    Circuit2: 5.0
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set<string>(["High Side"])
  );
  const [displayUnits, setDisplayUnits] = useState<"metric" | "imperial">("metric");
  const displayUnitsRef = useRef<"metric" | "imperial">("metric");
  displayUnitsRef.current = displayUnits;
  const [rpmOverride, setRpmOverride] = useState<Record<CircuitKey, number | null>>({
    Circuit1: null,
    Circuit2: null
  });
  const [currentRpm, setCurrentRpm] = useState<Record<CircuitKey, number | null>>({
    Circuit1: null,
    Circuit2: null
  });
  const [rpmInput, setRpmInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: "",
    Circuit2: ""
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [compressorStatus, setCompressorStatus] = useState<Record<CircuitKey, string | null>>({
    Circuit1: null,
    Circuit2: null,
  });
  const [hmiConnected, setHmiConnected] = useState<Record<CircuitKey, boolean | null>>({
    Circuit1: null,
    Circuit2: null
  });

  // CoolProp-derived thermodynamic data published by the Pi
  const [satTable, setSatTable] = useState<Record<CircuitKey, SatRow[] | null>>({
    Circuit1: null,
    Circuit2: null,
  });
  const [statePoints, setStatePoints] = useState<Record<CircuitKey, StatePoints | null>>({
    Circuit1: null,
    Circuit2: null,
  });

  // -----------------
  // Refs
  // -----------------
  const isEditingSetpointRef = useRef<Record<CircuitKey, boolean>>({
    Circuit1: false,
    Circuit2: false
  });
  const latestSetpointRef = useRef<Record<CircuitKey, number>>({
    Circuit1: 5.0,
    Circuit2: 5.0
  });
  const latestSampleTimestampRef = useRef<Record<CircuitKey, number>>({
    Circuit1: Date.now(),
    Circuit2: Date.now()
  });

  // -----------------
  // URL-based circuit pick
  // -----------------
  useEffect(() => {
    const apply = () => setActiveCircuit(pickCircuitFromHash());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    setAvailableDates([]);
    setSelectedDate("");
    setTimeRange("");
    requestDates();
  }, [activeCircuit]);

  useEffect(() => {
    setTempSetpointInput(
      Object.fromEntries(
        circuits.map(c => [
          c,
          parseFloat((displayUnits === "imperial"
            ? latestSetpointRef.current[c] * 9 / 5 + 32
            : latestSetpointRef.current[c]
          ).toFixed(2))
        ])
      ) as Record<CircuitKey, number | "">
    );
  }, [displayUnits]);

  // -----------------
  // Derived UI values
  // -----------------
  const currentSensors = sensors[activeCircuit];
  const tempUnit = displayUnits === "metric" ? "°C" : "°F";
  const pressureUnit = displayUnits === "metric" ? "kPa" : "psi";
  const groupConfig = [
    {
      name: "High Side",
      items: [
        { title: "Temperature", value: currentSensors.highTemp.slice(-1)[0], unit: tempUnit },
        { title: "Absolute Pressure", value: currentSensors.highPressure.slice(-1)[0], unit: pressureUnit }
      ]
    },
    {
      name: "Expansion Valve",
      items: [
        { title: "Temperature", value: currentSensors.expTemp.slice(-1)[0], unit: tempUnit },
        { title: "Absolute Pressure", value: currentSensors.expPressure.slice(-1)[0], unit: pressureUnit }
      ]
    },
    {
      name: "Low Side",
      items: [
        { title: "Temperature", value: currentSensors.lowTemp.slice(-1)[0], unit: tempUnit },
        { title: "Absolute Pressure", value: currentSensors.lowPressure.slice(-1)[0], unit: pressureUnit }
      ]
    },
    {
      name: "Evaporator",
      items: [
        { title: "Temperature", value: currentSensors.evapTemp.slice(-1)[0], unit: tempUnit },
        { title: "Absolute Pressure", value: currentSensors.evapPressure.slice(-1)[0], unit: pressureUnit }
      ]
    },
    {
      name: "Other",
      items: [
        { title: "Space Temperature", value: currentSensors.spaceTemp.slice(-1)[0], unit: tempUnit },
        { title: "Discharge Air Temperature", value: currentSensors.dischargeTemp.slice(-1)[0], unit: tempUnit }
      ]
    }
  ];

  // -----------------
  // Setpoint helpers
  // -----------------
  const updateSetpointLine = (circuit: CircuitKey, sp: number) => {
    setSetpointData(prev => {
      const prevArr = prev[circuit];
      const arr = prevArr.length ? [...prevArr] : [sp];
      arr[arr.length - 1] = sp;
      saveToStorage(storageKey(circuit, "setpointData"), arr);
      return { ...prev, [circuit]: arr };
    });
  };

  // -----------------
  // MQTT handlers
  // -----------------
  const handleMqttMessage = useCallback((topic: string, val: number) => {
    const [circuitPart, topicPart] = topic.split("/", 2);
    if (!circuits.includes(circuitPart as CircuitKey) || !topicPart) return;
    const circuit = circuitPart as CircuitKey;

    if (topicPart === "Compressor_RPM") {
      setRpmOverride(prev => ({
        ...prev,
        [circuit]: (Number.isFinite(val) && val > 0) ? val : null
      }));
      return;
    }

    if (topicPart === "HMI_Status") {
      setHmiConnected(prev => ({ ...prev, [circuit]: val === 1 }));
      return;
    }

    if (topicPart === "Compressor_Current_RPM") {
      setCurrentRpm(prev => ({ ...prev, [circuit]: Number.isFinite(val) ? val : null }));
      return;
    }

    const value =
      INPUT_UNITS === "imperial" && topicPart.endsWith("_Temperature") ? toMetricTemp(val) :
      INPUT_UNITS === "imperial" && topicPart.endsWith("_AbsolutePressure") ? toMetricPressure(val) :
      val;

    setSensors(prev => {
      const next = { ...prev, [circuit]: { ...prev[circuit] } };
      const c = next[circuit];
      switch (topicPart) {
        case "HighSide_Temperature":        c.highTemp     = pushRolling(c.highTemp, value);     break;
        case "HighSide_AbsolutePressure":   c.highPressure = pushRolling(c.highPressure, value); break;
        case "EXV_Temperature":             c.expTemp      = pushRolling(c.expTemp, value);      break;
        case "EXV_AbsolutePressure":        c.expPressure  = pushRolling(c.expPressure, value);  break;
        case "LowSide_Temperature":         c.lowTemp      = pushRolling(c.lowTemp, value);      break;
        case "LowSide_AbsolutePressure":    c.lowPressure  = pushRolling(c.lowPressure, value);  break;
        case "Evaporator_Temperature":      c.evapTemp     = pushRolling(c.evapTemp, value);     break;
        case "Evaporator_AbsolutePressure": c.evapPressure = pushRolling(c.evapPressure, value); break;
        case "Space_Temperature":           c.spaceTemp    = pushRolling(c.spaceTemp, value);    break;
        case "Sample_Timestamp":
          latestSampleTimestampRef.current[circuit] = val;
          break;
        case "Discharge_Air_Temperature":
          c.dischargeTemp = pushRolling(c.dischargeTemp, value);
          setLabels(prevLabels => {
            const sampleTs = Number.isFinite(latestSampleTimestampRef.current[circuit])
              ? latestSampleTimestampRef.current[circuit]
              : Date.now();
            const nextLabels = pushRolling(prevLabels[circuit], sampleTs);
            saveToStorage(storageKey(circuit, "labels"), nextLabels);
            return { ...prevLabels, [circuit]: nextLabels };
          });
          setSetpointData(prevData => {
            const spArr = pushRolling(prevData[circuit], latestSetpointRef.current[circuit]);
            saveToStorage(storageKey(circuit, "setpointData"), spArr);
            return { ...prevData, [circuit]: spArr };
          });
          saveToStorage(storageKey(circuit, "dischargeTemp"), c.dischargeTemp);
          break;
        case "Space_Setpoint_Temperature": {
          const spRounded = parseFloat(value.toFixed(2));
          setSetpoint(prevSet => ({ ...prevSet, [circuit]: spRounded }));
          latestSetpointRef.current[circuit] = spRounded;
          setTempSetpointInput(prevInput => {
            if (isEditingSetpointRef.current[circuit]) return prevInput;
            const u = displayUnitsRef.current;
            const displayed = parseFloat((u === "imperial" ? spRounded * 9 / 5 + 32 : spRounded).toFixed(2));
            return { ...prevInput, [circuit]: displayed };
          });
          break;
        }
      }
      return next;
    });
  }, []);

  const handleTextMessage = useCallback((topic: string, payload: string) => {
    if (topic.endsWith("/Unit") && !topic.startsWith("Data/")) {
      const unit = payload.trim();
      if (unit === "F") setDisplayUnits("imperial");
      else if (unit === "C") setDisplayUnits("metric");
      return;
    }

    if (topic.endsWith("/Status") && !topic.startsWith("Data/")) {
      const circuit = topic.split("/")[0] as CircuitKey;
      if (circuits.includes(circuit)) {
        setCompressorStatus(prev => ({ ...prev, [circuit]: payload.trim() }));
      }
      return;
    }
    const prefix = `Data/${activeCircuit}/`;
    if (!topic.startsWith(prefix)) return;
    const name = topic.slice(prefix.length);
    const extractPayload = (raw: string) => {
      if (!raw.startsWith("DATE:")) return { date: "", body: raw };
      const [first, ...rest] = raw.split("\n");
      const date = first.replace("DATE:", "").trim();
      return { date, body: rest.join("\n") };
    };
    if (name === "Available_Dates") {
      const dates = sortDatesNewest(
        payload.split(",").map(p => p.trim()).filter(Boolean)
      );
      setAvailableDates(dates);
      if (!dates.length) return;
      if (!selectedDate) {
        const today = todayStr();
        const next = dates.includes(today) ? today : dates[0];
        setSelectedDate(next);
        requestTimeRange(next);
      }
      return;
    }
    if (name === "Available_Time_Ranges") {
      setTimeRange(payload || "");
      if (payload && selectedDate === todayStr() && !hasBackfilledRef.current[activeCircuit]) {
        const [, endTime] = payload.split("-");
        if (endTime) {
          hasBackfilledRef.current[activeCircuit] = true;
          const startTime = subtractSeconds(endTime.trim(), 60);
          clientRef.current?.publish(
            `Data/${activeCircuit}/Select_Range_Request`,
            `${startTime} ${endTime.trim()}`,
          );
        }
      }
      return;
    }
    if (name === "Temperature_Download") {
      if (!payload) return;
      const parsed = extractPayload(payload);
      const dateStr = parsed.date || lastDownloadDateRef.current || selectedDate || availableDates[0] || todayStr();
      const blob = new Blob([parsed.body], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `temps_${dateStr}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (name === "Pressure_Download") {
      if (!payload) return;
      const parsed = extractPayload(payload);
      const dateStr = parsed.date || lastDownloadDateRef.current || selectedDate || availableDates[0] || todayStr();
      const blob = new Blob([parsed.body], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pressures_${dateStr}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (name === "Setpoint_Download") {
      if (!payload) return;
      const parsed = extractPayload(payload);
      const dateStr = parsed.date || lastDownloadDateRef.current || selectedDate || availableDates[0] || todayStr();
      const blob = new Blob([parsed.body], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `setpoints_${dateStr}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    // CoolProp saturation table — published once on Pi startup, retained
    if (name === "R1234yf_Saturation_Table") {
      try {
        const table = JSON.parse(payload) as SatRow[];
        const circuit = topic.split("/")[1] as CircuitKey;
        if (circuits.includes(circuit)) {
          setSatTable(prev => ({ ...prev, [circuit]: table }));
        }
      } catch { /* malformed JSON — ignore */ }
      return;
    }
    // CoolProp state points — published every sample cycle, not retained
    if (name === "R1234yf_State_Points") {
      try {
        const pts = JSON.parse(payload) as StatePoints;
        const circuit = topic.split("/")[1] as CircuitKey;
        if (circuits.includes(circuit)) {
          setStatePoints(prev => ({ ...prev, [circuit]: pts }));
        }
      } catch { /* malformed JSON — ignore */ }
      return;
    }
  }, [activeCircuit, selectedDate, availableDates]);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:8083",
    username: import.meta.env.VITE_MQTT_USERNAME as string,
    password: import.meta.env.VITE_MQTT_PASSWORD as string,
    onMessage: handleMqttMessage,
    onTextMessage: handleTextMessage,
    onConnect: () => requestDates()
  });

  // -----------------
  // UI actions
  // -----------------
  const updateSetpoint = (circuit: CircuitKey, sp: number) => {
    const spC = displayUnits === "imperial" ? (sp - 32) * 5 / 9 : sp;
    setSetpoint(prev => ({ ...prev, [circuit]: spC }));
    latestSetpointRef.current[circuit] = spC;
    updateSetpointLine(circuit, spC);
    if (clientRef.current?.connected) {
      clientRef.current.publish(`${circuit}/Space_Setpoint_Temperature`, spC.toString(), { retain: true });
      clientRef.current.publish(`Data/${circuit}/Setpoint_Record`, `${spC}`);
    }
  };

  const requestDates = () => {
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Available_Dates_Request`, "");
    }
  };

  const requestTimeRange = (dateStr: string) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Available_Time_Ranges_Request`, dateStr);
    }
  };

  const requestDownload = () => {
    const dateStr = selectedDate || availableDates[0] || todayStr();
    lastDownloadDateRef.current = dateStr;
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Temperature_Download_Request`, dateStr);
    }
  };

  const requestPressureDownload = () => {
    const dateStr = selectedDate || availableDates[0] || todayStr();
    lastDownloadDateRef.current = dateStr;
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Pressure_Download_Request`, dateStr);
    }
  };

  const requestSetpointDownload = () => {
    const dateStr = selectedDate || availableDates[0] || todayStr();
    lastDownloadDateRef.current = dateStr;
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Setpoint_Download_Request`, dateStr);
    }
  };

  const clearGraph = (circuit: CircuitKey) => {
    setSensors(prev => {
      const next = { ...prev, [circuit]: { ...prev[circuit] } };
      next[circuit].dischargeTemp = [];
      saveToStorage(storageKey(circuit, "dischargeTemp"), []);
      return next;
    });
    setLabels(prev => {
      const next = { ...prev, [circuit]: [] };
      saveToStorage(storageKey(circuit, "labels"), []);
      return next;
    });
    setSetpointData(prev => {
      const next = { ...prev, [circuit]: [] };
      saveToStorage(storageKey(circuit, "setpointData"), []);
      return next;
    });
  };

  const requestRange = () => {
    if (!rangeStart || !rangeEnd) return;
    const payload = selectedDate
      ? `${selectedDate} ${rangeStart} ${rangeEnd}`
      : `${rangeStart} ${rangeEnd}`;
    if (clientRef.current?.connected) {
      clearGraph(activeCircuit);
      clientRef.current.publish(`Data/${activeCircuit}/Select_Range_Request`, payload);
    }
  };

  const showLive = () => {
    clearGraph(activeCircuit);
  };

  const applyRpmOverride = (circuit: CircuitKey, rpm: number) => {
    const clamped = Math.max(RPM_MIN, Math.min(RPM_MAX, rpm));
    if (clientRef.current?.connected) {
      clientRef.current.publish(`${circuit}/Compressor_RPM`, `${clamped}`, { retain: true });
    }
  };

  const clearRpmOverride = (circuit: CircuitKey) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish(`${circuit}/Compressor_RPM`, "", { retain: true });
    }
  };

  const requestShutdown = (circuit: CircuitKey) => {
    if (!clientRef.current?.connected) return;
    if (!window.confirm(`Shut down compressor for ${circuit}? It will ramp to minimum RPM.`)) return;
    clientRef.current.publish(`Data/${circuit}/Compressor_Shutdown`, "1");
  };

  const requestStart = (circuit: CircuitKey) => {
    if (!clientRef.current?.connected) return;
    clientRef.current.publish(`Data/${circuit}/Compressor_Start`, "1");
  };

  const toDisplayTemp = (c: number) => displayUnits === "metric" ? c : (c * 9 / 5) + 32;
  const toDisplayPressure = (pa: number) => displayUnits === "metric" ? pa / 1000 : pa / 6894.757;
  const formatVal = (v: number | undefined, kind?: "temp" | "pressure") => {
    if (v === undefined || Number.isNaN(v)) return "--";
    const value = kind === "temp"
      ? toDisplayTemp(v!)
      : kind === "pressure"
        ? toDisplayPressure(v!)
        : v!;
    return value.toFixed(1);
  };

  // Build the ThermoSensors prop — includes all arrays for the chart panel
  const thermoSensors: ThermoSensors = {
    ...currentSensors,
    labels: labels[activeCircuit],
    setpointData: setpointData[activeCircuit],
  };

  // -----------------
  // Render
  // -----------------
  return (
    <div className="app-root">
      <div className="container">
        <header className="header">
          <h1>Refrigeration Dashboard</h1>
          <div className="control-row" style={{ marginTop: "0.5rem" }}>
            <div>MQTT sensor data</div>
            <button
              className="btn"
              onClick={() => {
                const next = displayUnits === "metric" ? "imperial" : "metric";
                setDisplayUnits(next);
                const mqttUnit = next === "imperial" ? "F" : "C";
                if (clientRef.current?.connected) {
                  circuits.forEach(c => clientRef.current!.publish(`Data/${c}/Unit_Change`, mqttUnit));
                }
              }}
            >
              {displayUnits === "metric" ? "Show Imperial" : "Show Metric"}
            </button>
            <button className="btn" onClick={() => setManualOpen(true)}>
              User Manual
            </button>
          </div>
          <div className="menu-bar">
            <span className="menu-label">
              {activeCircuit === "Circuit1" ? "Circuit 1" : "Circuit 2"}
            </span>
          </div>
        </header>

        <main className="main-grid">
          <div className="left-col">
            <div className="tab-row">
              <button
                type="button"
                className="tab-btn"
                onClick={() => setOpenGroups(new Set(groupConfig.map(g => g.name)))}
              >
                Open All
              </button>
              <button
                type="button"
                className="tab-btn"
                onClick={() => setOpenGroups(new Set())}
              >
                Close All
              </button>
            </div>
            {groupConfig.map((group, index) => {
              const isOpen = openGroups.has(group.name);
              const bodyId = `accordion-body-${index}`;
              return (
                <div key={group.name} className="accordion-group">
                  <button
                    type="button"
                    className="accordion-header"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    onClick={() =>
                      setOpenGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(group.name)) next.delete(group.name);
                        else next.add(group.name);
                        return next;
                      })
                    }
                  >
                    {group.name} Sensors
                  </button>
                  <div id={bodyId} className={`accordion-body ${isOpen ? "is-open" : "is-collapsed"}`}>
                    {group.items.map(item => (
                      <SensorCard
                        key={item.title}
                        title={item.title}
                        value={formatVal(
                          item.value,
                          item.title.includes("Pressure") ? "pressure" : "temp"
                        )}
                        unit={item.unit}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="right-col">
            {/* Thermodynamic chart panel — replaces the old single Graph */}
            <div className="card graph-card" style={{ height: "auto", minHeight: "clamp(320px, 50vh, 620px)" }}>
              <ThermoChart
                sensors={thermoSensors}
                satTable={satTable[activeCircuit]}
                statePoints={statePoints[activeCircuit]}
                temperatureUnit={tempUnit as "°C" | "°F"}
                displayUnits={displayUnits}
              />
            </div>

            {hmiConnected[activeCircuit] === false && (
              <div className="card" style={{ borderColor: "#f59e0b", color: "#f59e0b", padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
                HMI panel not connected
              </div>
            )}

            {(() => {
              const status = compressorStatus[activeCircuit];
              const locked = status === null || status === "Starting" || status === "Shutting Down";
              const statusDisplay = status === null ? "Setting up ..."
                : status === "Starting" ? "Ramping RPM up ..."
                : status === "Shutting Down" ? "Ramping RPM down ..."
                : status === "Running" ? "Running"
                : "Ready";
              const statusColor = status === null ? "#6b7280"
                : status === "Starting" ? "#facc15"
                : status === "Shutting Down" ? "#f97316"
                : status === "Running" ? "#22c55e"
                : "#6b7280";
              return (
                <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>Controls</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      {currentRpm[activeCircuit] !== null && (
                        <span style={{ fontSize: "1rem", fontWeight: 700, color: statusColor, letterSpacing: "0.02em" }}>
                          {currentRpm[activeCircuit]} <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "#9ca3af" }}>RPM</span>
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ width: "0.55rem", height: "0.55rem", borderRadius: "50%", background: statusColor, display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: "0.8rem", color: statusColor, fontWeight: 600 }}>{statusDisplay}</span>
                      </div>
                    </div>
                  </div>

                  {/* Compressor */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: 600 }}>Compressor</div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => requestStart(activeCircuit)}
                        disabled={locked}
                        style={{
                          flex: 1, padding: "0.6rem 0", fontWeight: 700, fontSize: "0.9rem",
                          background: locked ? "#1a2e1a" : "#16a34a", border: "none", borderRadius: "0.4rem",
                          color: locked ? "#4b5563" : "#fff", cursor: locked ? "not-allowed" : "pointer", letterSpacing: "0.02em",
                        }}
                      >
                        Start
                      </button>
                      <button
                        onClick={() => requestShutdown(activeCircuit)}
                        disabled={locked}
                        style={{
                          flex: 1, padding: "0.6rem 0", fontWeight: 700, fontSize: "0.9rem",
                          background: locked ? "#2e1a1a" : "#dc2626", border: "none", borderRadius: "0.4rem",
                          color: locked ? "#4b5563" : "#fff", cursor: locked ? "not-allowed" : "pointer", letterSpacing: "0.02em",
                        }}
                      >
                        Shutdown
                      </button>
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)" }} />

                  <div style={{ borderTop: "1px solid var(--border)" }} />

                  {/* Setpoint + RPM override side by side */}
                  <div style={{ display: "flex", gap: "1rem" }}>

                    {/* Temperature setpoint */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: 600 }}>Setpoint</div>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <input type="number" step="0.1" value={tempSetpointInput[activeCircuit] || ""}
                          disabled={locked}
                          onChange={e => setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))}
                          onFocus={() => { isEditingSetpointRef.current[activeCircuit] = true; }}
                          onBlur={() => {
                            isEditingSetpointRef.current[activeCircuit] = false;
                            if (tempSetpointInput[activeCircuit] === "") {
                              setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: setpoint[activeCircuit] }));
                            }
                          }}
                          onKeyDown={e => { const v = tempSetpointInput[activeCircuit]; if (e.key === "Enter" && v !== "") updateSetpoint(activeCircuit, v as number); }}
                          className="number-input"
                          style={{ flex: 1, minWidth: 0 }} />
                        <button className="btn" disabled={locked} onClick={() => { const v = tempSetpointInput[activeCircuit]; if (v !== "") updateSetpoint(activeCircuit, v as number); }}>
                          Set
                        </button>
                      </div>
                    </div>

                    {/* RPM override */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: 600 }}>
                        RPM Override
                        {rpmOverride[activeCircuit] !== null && (
                          <span style={{ marginLeft: "0.5rem", color: "var(--accent)", fontWeight: 400 }}>
                            {rpmOverride[activeCircuit]} active
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <input
                          type="number" step="100" min={RPM_MIN} max={RPM_MAX} placeholder="RPM"
                          disabled={locked}
                          value={rpmInput[activeCircuit]}
                          onChange={e => setRpmInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))}
                          onKeyDown={e => { const v = rpmInput[activeCircuit]; if (e.key === "Enter" && v !== "") applyRpmOverride(activeCircuit, v as number); }}
                          className="number-input"
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <button className="btn" disabled={locked} onClick={() => { const v = rpmInput[activeCircuit]; if (v !== "") applyRpmOverride(activeCircuit, v as number); }}>Set</button>
                        <button className="btn" disabled={locked} onClick={() => clearRpmOverride(activeCircuit)}>Clear</button>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })()}

            <div className="card">
              <div>Data</div>
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <button className="btn" onClick={requestDates}>Get dates</button>
                <select
                  className="number-input"
                  value={selectedDate}
                  onChange={e => {
                    const next = e.target.value;
                    setSelectedDate(next);
                    setTimeRange("");
                    requestTimeRange(next);
                  }}
                >
                  <option value={todayStr()}>today</option>
                  {availableDates.map(d => (
                    <option key={d} value={d}>{formatDate(d)}</option>
                  ))}
                </select>
              </div>
              {timeRange && <div className="control-row" style={{ marginTop: "0.5rem" }}>{timeRange}</div>}
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <input className="number-input" placeholder="Start HH:MM:SS" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                <input className="number-input" placeholder="End HH:MM:SS" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                <button className="btn" onClick={requestRange}>Show range</button>
              </div>
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <button className="btn" onClick={requestDownload}>Download Temperatures</button>
                <button className="btn" onClick={requestPressureDownload}>Download Pressures</button>
                <button className="btn" onClick={requestSetpointDownload}>Download Setpoints</button>
              </div>
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <button className="btn" onClick={showLive}>Live data</button>
              </div>
            </div>
          </div>
        </main>
      </div>
      {manualOpen && <UserManual onClose={() => setManualOpen(false)} />}
    </div>
  );
}
