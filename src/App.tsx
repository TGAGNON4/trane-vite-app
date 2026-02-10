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

export default function App() {
  const [sensors, setSensors] = useState<Sensors>({
    t1Temp: [], t1Pressure: [],
    t2Temp: [], t2Pressure: [],
    t3Temp: [], t3Pressure: [],
    t4Temp: [], t4Pressure: [],
    ambientTemp: [], evapAirTemp: loadFromStorage<number[]>("evapAirTemp", [])
  });
  const [labels, setLabels] = useState<number[]>(() => loadFromStorage<number[]>("labels", []));
  const [setpointData, setSetpointData] = useState<number[]>(() => loadFromStorage<number[]>("setpointData", []));
  const [setpoint, setSetpoint] = useState<number>(() => Number(localStorage.getItem("currentSetpoint")) || 5.0);
  const [tempSetpointInput, setTempSetpointInput] = useState<number | "">(setpoint);
  const latestSetpointRef = useRef<number>(setpoint);
  const [openGroup, setOpenGroup] = useState<string | null>("Compressor Outlet");

  const groupConfig = [
    {
      name: "Compressor Outlet",
      items: [
        { title: "Temperature", value: sensors.t1Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: sensors.t1Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Condenser Outlet",
      items: [
        { title: "Temperature", value: sensors.t2Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: sensors.t2Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Expansion Device Outlet",
      items: [
        { title: "Temperature", value: sensors.t3Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: sensors.t3Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Evaporator Outlet",
      items: [
        { title: "Temperature", value: sensors.t4Temp.slice(-1)[0], unit: "°C" },
        { title: "Absolute Pressure", value: sensors.t4Pressure.slice(-1)[0], unit: "Pa" }
      ]
    },
    {
      name: "Ambient",
      items: [
        { title: "Space Temperature", value: sensors.ambientTemp.slice(-1)[0], unit: "°C" },
        { title: "Discharge Air Temperature", value: sensors.evapAirTemp.slice(-1)[0], unit: "°C" }
      ]
    }
  ];

  const updateSetpointLine = (sp: number) => {
    setSetpointData(prev => {
      const arr = prev.length ? [...prev] : [sp];
      arr[arr.length - 1] = sp;
      saveToStorage("setpointData", arr);
      return arr;
    });
  };

  const handleMqttMessage = useCallback((topic: string, val: number) => {
    const now = Date.now();

    setSensors(prev => {
      const next = { ...prev };
      switch(topic){
        case "HighSide_Temperature": next.t1Temp = pushRolling(prev.t1Temp, val); break;
        case "HighSide_AbsolutePressure": next.t1Pressure = pushRolling(prev.t1Pressure, val); break;
        case "EXV_Temperature": next.t2Temp = pushRolling(prev.t2Temp, val); break;
        case "EXV_AbsolutePressure": next.t2Pressure = pushRolling(prev.t2Pressure, val); break;
        case "LowSide_Temperature": next.t3Temp = pushRolling(prev.t3Temp, val); break;
        case "LowSide_AbsolutePressure": next.t3Pressure = pushRolling(prev.t3Pressure, val); break;
        case "Evaporator_Temperature": next.t4Temp = pushRolling(prev.t4Temp, val); break;
        case "Evaporator_AbsolutePressure": next.t4Pressure = pushRolling(prev.t4Pressure, val); break;
        case "Space_Temperature": next.ambientTemp = pushRolling(prev.ambientTemp, val); break;
        case "Discharge_Air_Temperature":
          next.evapAirTemp = pushRolling(prev.evapAirTemp, val);
          setLabels(prev => { const nextLabels = pushRolling(prev, now); saveToStorage("labels", nextLabels); return nextLabels; });
          setSetpointData(prev => { const spArr = pushRolling(prev, latestSetpointRef.current); saveToStorage("setpointData", spArr); return spArr; });
          saveToStorage("evapAirTemp", next.evapAirTemp);
          break;
        case "Space_Setpoint_Temperature":
          setSetpoint(val); latestSetpointRef.current = val; setTempSetpointInput(val); localStorage.setItem("currentSetpoint", val.toString());
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

  const updateSetpoint = (sp: number) => {
    setSetpoint(sp);
    latestSetpointRef.current = sp;
    localStorage.setItem("currentSetpoint", sp.toString());
    updateSetpointLine(sp);

    if(clientRef.current?.connected){
      clientRef.current.publish("Space_Setpoint_Temperature", sp.toString(), { retain: true });
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
              <Graph labels={labels} evapAirTemp={sensors.evapAirTemp} setpointData={setpointData}/>
            </div>

            <div className="card setpoint-card">
              <div>Set Temperature</div>
              <div className="control-row">
                <input type="number" step="0.1" value={tempSetpointInput || ""} 
                  onChange={e=>setTempSetpointInput(e.target.value?Number(e.target.value):"")} 
                  onKeyDown={e=>{if(e.key==="Enter"&&tempSetpointInput!=="")updateSetpoint(tempSetpointInput as number)}} 
                  className="number-input"/>
                <button className="btn" onClick={()=>tempSetpointInput!==""&&updateSetpoint(tempSetpointInput as number)}>Update</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
