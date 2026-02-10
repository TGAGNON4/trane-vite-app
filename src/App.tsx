// src/App.tsx
import { useState, useRef, useCallback } from "react";
import "./App.css";
import { SensorCard } from "./cmpnts/SensorCard";
import { Graph } from "./cmpnts/Graph";
import { useMqtt } from "./hooks/MQTT";
import { pushRolling, saveToStorage, loadFromStorage } from "./utils/array_help";

type Sensors = {
  t1Temp: number[];
  t1Pressure: number[];
  t2Temp: number[];
  t2Pressure: number[];
  t3Temp: number[];
  t3Pressure: number[];
  t4Temp: number[];
  t4Pressure: number[];
  ambientTemp: number[];
  evapAirTemp: number[];
};

const circuits = ["Circuit1", "Circuit2"] as const;
type CircuitKey = typeof circuits[number];

const makeEmptySensors = (): Sensors => ({
  t1Temp: [], t1Pressure: [],
  t2Temp: [], t2Pressure: [],
  t3Temp: [], t3Pressure: [],
  t4Temp: [], t4Pressure: [],
  ambientTemp: [], evapAirTemp: []
});

const storageKey = (circuit: CircuitKey, key: string) => `${circuit}:${key}`;

export default function App() {
  const [activeCircuit, setActiveCircuit] = useState<CircuitKey>("Circuit1");
  const [sensors, setSensors] = useState<Record<CircuitKey, Sensors>>({
    Circuit1: { ...makeEmptySensors(), evapAirTemp: loadFromStorage<number[]>(storageKey("Circuit1", "evapAirTemp"), []) },
    Circuit2: { ...makeEmptySensors(), evapAirTemp: loadFromStorage<number[]>(storageKey("Circuit2", "evapAirTemp"), []) }
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
  const [tempSetpointInput, setTempSetpointInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: setpoint.Circuit1,
    Circuit2: setpoint.Circuit2
  });
  const latestSetpointRef = useRef<Record<CircuitKey, number>>({
    Circuit1: setpoint.Circuit1,
    Circuit2: setpoint.Circuit2
  });
  const [openGroup, setOpenGroup] = useState<string | null>("High Side");

  const currentSensors = sensors[activeCircuit];
  const groupConfig = [
    {
      name: "High Side",
      items: [
        { title: "Temperature", value: currentSensors.t1Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.t1Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Expansion Valve",
      items: [
        { title: "Temperature", value: currentSensors.t2Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.t2Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Low Side",
      items: [
        { title: "Temperature", value: currentSensors.t3Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.t3Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Evaporator",
      items: [
        { title: "Temperature", value: currentSensors.t4Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: currentSensors.t4Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Other",
      items: [
        { title: "Space Temperature", value: currentSensors.ambientTemp.slice(-1)[0], unit: "°C" },
        { title: "Discharge Air Temperature", value: currentSensors.evapAirTemp.slice(-1)[0], unit: "°C" }
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
    const now = Date.now();
    const [circuitPart, topicPart] = topic.split("/", 2);
    if (!circuits.includes(circuitPart as CircuitKey) || !topicPart) return;
    const circuit = circuitPart as CircuitKey;

    setSensors(prev => {
      const next = { ...prev, [circuit]: { ...prev[circuit] } };
      const c = next[circuit];
      switch(topicPart){
        case "HighSide_Temperature": c.t1Temp = pushRolling(c.t1Temp, val); break;
        case "HighSide_AbsolutePressure": c.t1Pressure = pushRolling(c.t1Pressure, val); break;
        case "EXV_Temperature": c.t2Temp = pushRolling(c.t2Temp, val); break;
        case "EXV_AbsolutePressure": c.t2Pressure = pushRolling(c.t2Pressure, val); break;
        case "LowSide_Temperature": c.t3Temp = pushRolling(c.t3Temp, val); break;
        case "LowSide_AbsolutePressure": c.t3Pressure = pushRolling(c.t3Pressure, val); break;
        case "Evaporator_Temperature": c.t4Temp = pushRolling(c.t4Temp, val); break;
        case "Evaporator_AbsolutePressure": c.t4Pressure = pushRolling(c.t4Pressure, val); break;
        case "Space_Temperature": c.ambientTemp = pushRolling(c.ambientTemp, val); break;
        case "Discharge_Air_Temperature":
          c.evapAirTemp = pushRolling(c.evapAirTemp, val);
          setLabels(prevLabels => {
            const nextLabels = pushRolling(prevLabels[circuit], now);
            saveToStorage(storageKey(circuit, "labels"), nextLabels);
            return { ...prevLabels, [circuit]: nextLabels };
          });
          setSetpointData(prevData => {
            const spArr = pushRolling(prevData[circuit], latestSetpointRef.current[circuit]);
            saveToStorage(storageKey(circuit, "setpointData"), spArr);
            return { ...prevData, [circuit]: spArr };
          });
          saveToStorage(storageKey(circuit, "evapAirTemp"), c.evapAirTemp);
          break;
        case "Space_Setpoint_Temperature":
          setSetpoint(prevSet => ({ ...prevSet, [circuit]: val }));
          latestSetpointRef.current[circuit] = val;
          setTempSetpointInput(prevInput => ({ ...prevInput, [circuit]: val }));
          localStorage.setItem(storageKey(circuit, "currentSetpoint"), val.toString());
          break;
      }
      return next;
    });
  }, []);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:443",
    username: "dev",
    password: "trAneEseNdeS_4321",
    onMessage: handleMqttMessage
  });

  const updateSetpoint = (circuit: CircuitKey, sp: number) => {
    setSetpoint(prev => ({ ...prev, [circuit]: sp }));
    latestSetpointRef.current[circuit] = sp;
    localStorage.setItem(storageKey(circuit, "currentSetpoint"), sp.toString());
    updateSetpointLine(circuit, sp);

    if(clientRef.current?.connected){
      clientRef.current.publish(`${circuit}/Space_Setpoint_Temperature`, sp.toString(), { retain: true });
    }
  };

  const formatVal = (v: number | undefined) => Number.isFinite(v!) ? v!.toFixed(1) : "—";

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
                <button
                  key={circuit}
                  type="button"
                  className={`tab-btn ${activeCircuit === circuit ? "is-active" : ""}`}
                  onClick={() => setActiveCircuit(circuit)}
                >
                  {circuit === "Circuit1" ? "Circuit 1" : "Circuit 2"}
                </button>
              ))}
            </div>
            {groupConfig.map((group, index) => {
              const isOpen = openGroup === group.name;
              const bodyId = `accordion-body-${index}`;
              return (
              <div key={group.name} className="accordion-group">
                <button
                  type="button"
                  className="accordion-header"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpenGroup(prev => (prev === group.name ? null : group.name))}
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
              <Graph labels={labels[activeCircuit]} evapAirTemp={currentSensors.evapAirTemp} setpointData={setpointData[activeCircuit]}/>
            </div>

            <div className="card setpoint-card">
              <div>Set Temperature</div>
              <div className="control-row">
                <input type="number" step="0.1" value={tempSetpointInput[activeCircuit] || ""} 
                  onChange={e=>setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))} 
                  onKeyDown={e=>{const v = tempSetpointInput[activeCircuit]; if(e.key==="Enter"&&v!=="")updateSetpoint(activeCircuit, v as number)}} 
                  className="number-input"/>
                <button className="btn" onClick={()=>{const v = tempSetpointInput[activeCircuit]; if(v!=="")updateSetpoint(activeCircuit, v as number);}}>Update</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
