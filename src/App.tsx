// src/App.tsx
import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import { SensorCard } from "./cmpnts/SensorCard";
import { Graph } from "./cmpnts/Graph";
import { useMqtt } from "./hooks/MQTT";
import { pushRolling, saveToStorage, loadFromStorage } from "./utils/array_help";

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

export default function App() {
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
  const [tempSetpointInput, setTempSetpointInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: setpoint.Circuit1,
    Circuit2: setpoint.Circuit2
  });
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set<string>(["High Side"])
  );

  const currentSensors = sensors[activeCircuit];

  useEffect(() => {
    const pickCircuit = () => {
      const hash = window.location.hash.replace("#/", "").replace("#", "");
      if (hash === "Circuit2" || hash === "circuit2") return "Circuit2";
      return "Circuit1";
    };
    const apply = () => setActiveCircuit(pickCircuit());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const groupConfig = [
    {
      name: "High Side",
      items: [
        { title: "Temperature", value: currentSensors.highTemp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.highPressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Expansion Valve",
      items: [
        { title: "Temperature", value: currentSensors.expTemp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.expPressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Low Side",
      items: [
        { title: "Temperature", value: currentSensors.lowTemp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.lowPressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Evaporator",
      items: [
        { title: "Temperature", value: currentSensors.evapTemp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.evapPressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Other",
      items: [
        { title: "Space Temperature", value: currentSensors.spaceTemp.slice(-1)[0], unit: "°C" },
        { title: "Discharge Air Temperature", value: currentSensors.dischargeTemp.slice(-1)[0], unit: "°C" }
      ]
    }
  ];

  const updateSetpointLine = (circuit: CircuitKey, sp: number) => {
    setSetpointData(prev => {
      const prevArr = prev[circuit];
      const arr = prevArr.length ? [...prevArr] : [sp];
      arr[arr.length - 1] = sp;
      saveToStorage(storageKey(circuit, "setpointData"), arr);
      return { ...prev, [circuit]: arr };
    });
  };

  const handleMqttMessage = useCallback((topic: string, val: number) => {
    const [circuitPart, topicPart] = topic.split("/", 2);
    if (!circuits.includes(circuitPart as CircuitKey) || !topicPart) return;
    const circuit = circuitPart as CircuitKey;

    setSensors(prev => {
      const next = { ...prev, [circuit]: { ...prev[circuit] } };
      const c = next[circuit];
      switch(topicPart){
        case "HighSide_Temperature": c.highTemp = pushRolling(c.highTemp, val); break;
        case "HighSide_AbsolutePressure": c.highPressure = pushRolling(c.highPressure, val); break;
        case "EXV_Temperature": c.expTemp = pushRolling(c.expTemp, val); break;
        case "EXV_AbsolutePressure": c.expPressure = pushRolling(c.expPressure, val); break;
        case "LowSide_Temperature": c.lowTemp = pushRolling(c.lowTemp, val); break;
        case "LowSide_AbsolutePressure": c.lowPressure = pushRolling(c.lowPressure, val); break;
        case "Evaporator_Temperature": c.evapTemp = pushRolling(c.evapTemp, val); break;
        case "Evaporator_AbsolutePressure": c.evapPressure = pushRolling(c.evapPressure, val); break;
        case "Space_Temperature": c.spaceTemp = pushRolling(c.spaceTemp, val); break;
        case "Sample_Timestamp":
          latestSampleTimestampRef.current[circuit] = val;
          break;
        case "Discharge_Air_Temperature":
          c.dischargeTemp = pushRolling(c.dischargeTemp, val);
          setLabels(prevLabels => {
            const sampleTs = Number.isFinite(latestSampleTimestampRef.current[circuit]) ? latestSampleTimestampRef.current[circuit] : Date.now();
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
          setSetpoint(prevSet => ({ ...prevSet, [circuit]: val }));
          latestSetpointRef.current[circuit] = val;
          setTempSetpointInput(prevInput => {
            if (isEditingSetpointRef.current[circuit]) return prevInput;
            return { ...prevInput, [circuit]: val };
          });
          localStorage.setItem(storageKey(circuit, "currentSetpoint"), val.toString());
          break;
      }
      return next;
    });
  }, []);

  const handleTextMessage = useCallback((topic: string, payload: string) => {
    if (topic === "Data/Available_Dates") {
      const dates = payload.split(",").map(p => p.trim()).filter(Boolean);
      setAvailableDates(dates);
      if (!dates.length) {
        return;
      }
      if (!selectedDate) {
        setSelectedDate(dates[0]);
        requestTimeRange(dates[0]);
      }
      return;
    }
    if (topic === "Data/Available_Time_Ranges") {
      setTimeRange(payload || "");
      return;
    }
    if (topic === "Data/Download") {
      if (!payload) return;
      const dateStr = selectedDate || availableDates[0] || new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
      const blob = new Blob([payload], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `temps_${dateStr}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
  }, [selectedDate]);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:8083",
    username: "dev",
    password: "trAneEseNdeS_4321",
    onMessage: handleMqttMessage,
    onTextMessage: handleTextMessage,
    onConnect: () => requestDates()
  });

  const updateSetpoint = (circuit: CircuitKey, sp: number) => {
    setSetpoint(prev => ({ ...prev, [circuit]: sp }));
    latestSetpointRef.current[circuit] = sp;
    localStorage.setItem(storageKey(circuit, "currentSetpoint"), sp.toString());
    updateSetpointLine(circuit, sp);

    if(clientRef.current?.connected){
      clientRef.current.publish(`${circuit}/Space_Setpoint_Temperature`, sp.toString(), { retain: true });
      clientRef.current.publish("Data/Setpoint_Record", `${circuit} ${sp}`);
    }
  };

  const formatVal = (v: number | undefined) => Number.isFinite(v!) ? v!.toFixed(1) : "—";

  const requestDates = () => {
    if (clientRef.current?.connected) {
      clientRef.current.publish("Data/Available_Dates_Request", "");
    }
  };

  const requestTimeRange = (dateStr: string) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish("Data/Available_Time_Ranges_Request", dateStr);
    }
  };

  const requestDownload = () => {
    const dateStr = selectedDate || availableDates[0] || "";
    if (clientRef.current?.connected) {
      clientRef.current.publish("Data/Download_Request", dateStr);
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
      ? `${activeCircuit} ${selectedDate} ${rangeStart} ${rangeEnd}`
      : `${activeCircuit} ${rangeStart} ${rangeEnd}`;
    if (clientRef.current?.connected) {
      clearGraph(activeCircuit);
      clientRef.current.publish("Data/Select_Range_Request", payload);
    }
  };

  const showLive = () => {
    clearGraph(activeCircuit);
  };

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[1]}/${parts[0]}/${parts[2]}`;
  };

  return (
    <div className="app-root">
      <div className="container">
        <header className="header">
          <h1>Refrigeration Dashboard</h1>
          <div>MQTT sensor data</div>
        </header>

        <main className="main-grid">
          <div className="left-col">
            <div className="tab-row">
              {circuits.map(circuit => (
                <a
                  key={circuit}
                  className={`tab-btn ${activeCircuit === circuit ? "is-active" : ""}`}
                  href={`#/${circuit}`}
                >
                  {circuit === "Circuit1" ? "Circuit 1" : "Circuit 2"}
                </a>
              ))}
            </div>
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
                    <SensorCard key={item.title} title={item.title} value={formatVal(item.value)} unit={item.unit}/>
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
                  <option value="">today</option>
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
