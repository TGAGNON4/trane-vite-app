// src/App.tsx
import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import { SensorCard } from "./cmpnts/SensorCard";
import { Graph } from "./cmpnts/Graph";
import { useMqtt } from "./hooks/MQTT";
import { pushRolling, saveToStorage, loadFromStorage } from "./utils/array_help";

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
    Circuit1: Number(localStorage.getItem(storageKey("Circuit1", "currentSetpoint"))) || 5.0,
    Circuit2: Number(localStorage.getItem(storageKey("Circuit2", "currentSetpoint"))) || 5.0
  });
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const lastDownloadDateRef = useRef<string>("");
  const [tempSetpointInput, setTempSetpointInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: setpoint.Circuit1,
    Circuit2: setpoint.Circuit2
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set<string>(["High Side"])
  );
  const [displayUnits, setDisplayUnits] = useState<"metric" | "imperial">("metric");

  // -----------------
  // Refs
  // -----------------
  const isEditingSetpointRef = useRef<Record<CircuitKey, boolean>>({
    Circuit1: false,
    Circuit2: false
  });
  const latestSetpointRef = useRef<Record<CircuitKey, number>>({
    Circuit1: setpoint.Circuit1,
    Circuit2: setpoint.Circuit2
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
    const value =
      INPUT_UNITS === "imperial" && topicPart.endsWith("_Temperature") ? toMetricTemp(val) :
      INPUT_UNITS === "imperial" && topicPart.endsWith("_AbsolutePressure") ? toMetricPressure(val) :
      val;

    setSensors(prev => {
      const next = { ...prev, [circuit]: { ...prev[circuit] } };
      const c = next[circuit];
      switch (topicPart) {
        case "HighSide_Temperature": c.highTemp = pushRolling(c.highTemp, value); break;
        case "HighSide_AbsolutePressure": c.highPressure = pushRolling(c.highPressure, value); break;
        case "EXV_Temperature": c.expTemp = pushRolling(c.expTemp, value); break;
        case "EXV_AbsolutePressure": c.expPressure = pushRolling(c.expPressure, value); break;
        case "LowSide_Temperature": c.lowTemp = pushRolling(c.lowTemp, value); break;
        case "LowSide_AbsolutePressure": c.lowPressure = pushRolling(c.lowPressure, value); break;
        case "Evaporator_Temperature": c.evapTemp = pushRolling(c.evapTemp, value); break;
        case "Evaporator_AbsolutePressure": c.evapPressure = pushRolling(c.evapPressure, value); break;
        case "Space_Temperature": c.spaceTemp = pushRolling(c.spaceTemp, value); break;
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
        case "Space_Setpoint_Temperature":
          setSetpoint(prevSet => ({ ...prevSet, [circuit]: value }));
          latestSetpointRef.current[circuit] = value;
          setTempSetpointInput(prevInput => {
            if (isEditingSetpointRef.current[circuit]) return prevInput;
            return { ...prevInput, [circuit]: value };
          });
          localStorage.setItem(storageKey(circuit, "currentSetpoint"), value.toString());
          break;
      }
      return next;
    });
  }, []);

  const handleTextMessage = useCallback((topic: string, payload: string) => {
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
      return;
    }
    if (name === "Download") {
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
  }, [activeCircuit, selectedDate, availableDates]);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:8083",
    username: "dev",
    password: "trAneEseNdeS_4321",
    onMessage: handleMqttMessage,
    onTextMessage: handleTextMessage,
    onConnect: () => requestDates()
  });

  // -----------------
  // UI actions
  // -----------------
  const updateSetpoint = (circuit: CircuitKey, sp: number) => {
    setSetpoint(prev => ({ ...prev, [circuit]: sp }));
    latestSetpointRef.current[circuit] = sp;
    localStorage.setItem(storageKey(circuit, "currentSetpoint"), sp.toString());
    updateSetpointLine(circuit, sp);

    if (clientRef.current?.connected) {
      clientRef.current.publish(`${circuit}/Space_Setpoint_Temperature`, sp.toString(), { retain: true });
      clientRef.current.publish(`Data/${circuit}/Setpoint_Record`, `${sp}`);
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
      clientRef.current.publish(`Data/${activeCircuit}/Download_Request`, dateStr);
    }
  };

  const requestPressureDownload = () => {
    const dateStr = selectedDate || availableDates[0] || todayStr();
    lastDownloadDateRef.current = dateStr;
    if (clientRef.current?.connected) {
      clientRef.current.publish(`Data/${activeCircuit}/Pressure_Download_Request`, dateStr);
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

  const toDisplayTemp = (c: number) => displayUnits === "metric" ? c : (c * 9 / 5) + 32;
  const toDisplayPressure = (pa: number) => displayUnits === "metric" ? pa / 1000 : pa / 6894.757;
  const formatVal = (v: number | undefined, kind?: "temp" | "pressure") => {
    if (!Number.isFinite(v!)) return "—";
    const value = kind === "temp"
      ? toDisplayTemp(v!)
      : kind === "pressure"
        ? toDisplayPressure(v!)
        : v!;
    return kind === "pressure" ? value.toFixed(1) : value.toFixed(1);
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
              onClick={() => setDisplayUnits(prev => prev === "metric" ? "imperial" : "metric")}
            >
              {displayUnits === "metric" ? "Show Imperial" : "Show Metric"}
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
            );})}
          </div>

          <div className="right-col">
            <div className="card graph-card">
              <Graph labels={labels[activeCircuit]} dischargeTemp={currentSensors.dischargeTemp} setpointData={setpointData[activeCircuit]}/>
            </div>

            <div className="card setpoint-card">
              <div>Set Temperature</div>
              <div className="control-row">
                <input type="number" step="0.1" value={tempSetpointInput[activeCircuit] || ""} 
                  onChange={e=>setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))} 
                  onFocus={() => { isEditingSetpointRef.current[activeCircuit] = true; }}
                  onBlur={() => {
                    isEditingSetpointRef.current[activeCircuit] = false;
                    if (tempSetpointInput[activeCircuit] === "") {
                      setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: setpoint[activeCircuit] }));
                    }
                  }}
                  onKeyDown={e=>{const v = tempSetpointInput[activeCircuit]; if(e.key==="Enter"&&v!=="")updateSetpoint(activeCircuit, v as number)}} 
                  className="number-input"/>
                <button className="btn" onClick={()=>{const v = tempSetpointInput[activeCircuit]; if(v!=="")updateSetpoint(activeCircuit, v as number);}}>Update</button>
              </div>
            </div>

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
                <input
                  className="number-input"
                  placeholder="Start HH:MM:SS"
                  value={rangeStart}
                  onChange={e => setRangeStart(e.target.value)}
                />
                <input
                  className="number-input"
                  placeholder="End HH:MM:SS"
                  value={rangeEnd}
                  onChange={e => setRangeEnd(e.target.value)}
                />
                <button className="btn" onClick={requestRange}>Show range</button>
              </div>
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <button className="btn" onClick={requestDownload}>Download file</button>
                <button className="btn" onClick={requestPressureDownload}>Download pressure</button>
              </div>
              <div className="control-row" style={{ marginTop: "0.5rem" }}>
                <button className="btn" onClick={showLive}>Live data</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
