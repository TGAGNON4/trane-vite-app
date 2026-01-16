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
  const [labels, setLabels] = useState<string[]>(() => loadFromStorage<string[]>("labels", []));
  const [setpointData, setSetpointData] = useState<number[]>(() => loadFromStorage<number[]>("setpointData", []));
  const [setpoint, setSetpoint] = useState<number>(() => Number(localStorage.getItem("currentSetpoint")) || 5.0);
  const [tempSetpointInput, setTempSetpointInput] = useState<number | "">(setpoint);
  const latestSetpointRef = useRef<number>(setpoint);

  const updateSetpointLine = (sp: number) => {
    setSetpointData(prev => {
      const arr = prev.length ? [...prev] : [sp];
      arr[arr.length - 1] = sp;
      saveToStorage("setpointData", arr);
      return arr;
    });
  };

  const handleMqttMessage = useCallback((topic: string, val: number) => {
    const now = new Date().toLocaleTimeString();

    setSensors(prev => {
      const next = { ...prev };
      switch(topic){
        case "sensors/t1_temp": next.t1Temp = pushRolling(prev.t1Temp, val); break;
        case "sensors/t1_pressure": next.t1Pressure = pushRolling(prev.t1Pressure, val); break;
        case "sensors/t2_temp": next.t2Temp = pushRolling(prev.t2Temp, val); break;
        case "sensors/t2_pressure": next.t2Pressure = pushRolling(prev.t2Pressure, val); break;
        case "sensors/t3_temp": next.t3Temp = pushRolling(prev.t3Temp, val); break;
        case "sensors/t3_pressure": next.t3Pressure = pushRolling(prev.t3Pressure, val); break;
        case "sensors/t4_temp": next.t4Temp = pushRolling(prev.t4Temp, val); break;
        case "sensors/t4_pressure": next.t4Pressure = pushRolling(prev.t4Pressure, val); break;
        case "sensors/ambient_temp": next.ambientTemp = pushRolling(prev.ambientTemp, val); break;
        case "sensors/evap_air_temp":
          next.evapAirTemp = pushRolling(prev.evapAirTemp, val);
          setLabels(prev => { const nextLabels = pushRolling(prev.map(Number), Number(now)); saveToStorage("labels", nextLabels); return nextLabels.map(String); });
          setSetpointData(prev => { const spArr = pushRolling(prev, latestSetpointRef.current); saveToStorage("setpointData", spArr); return spArr; });
          saveToStorage("evapAirTemp", next.evapAirTemp);
          break;
        case "control/setpoint":
          setSetpoint(val); latestSetpointRef.current = val; setTempSetpointInput(val); localStorage.setItem("currentSetpoint", val.toString());
          break;
      }
      return next;
    });
  }, []);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:8083",
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
      clientRef.current.publish("control/setpoint", sp.toString(), { retain: true });
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
            {["Compressor Outlet","Condenser Outlet","Expansion Device Outlet","Evaporator Outlet","Ambient"].map(group => (
              <div key={group} className="accordion-group">
                <div className="accordion-header">{group} Sensors</div>
                <div className="accordion-body">
                  {group==="Compressor Outlet" && <>
                    <SensorCard title="Temp" value={formatVal(sensors.t1Temp.slice(-1)[0])} unit="°C"/>
                    <SensorCard title="Pressure" value={formatVal(sensors.t1Pressure.slice(-1)[0])} unit="Pa"/>
                  </>}
                  {group==="Condenser Outlet" && <>
                    <SensorCard title="Temp" value={formatVal(sensors.t2Temp.slice(-1)[0])} unit="°C"/>
                    <SensorCard title="Pressure" value={formatVal(sensors.t2Pressure.slice(-1)[0])} unit="Pa"/>
                  </>}
                  {group==="Expansion Device Outlet" && <>
                    <SensorCard title="Temp" value={formatVal(sensors.t3Temp.slice(-1)[0])} unit="°C"/>
                    <SensorCard title="Pressure" value={formatVal(sensors.t3Pressure.slice(-1)[0])} unit="Pa"/>
                  </>}
                  {group==="Evaporator Outlet" && <>
                    <SensorCard title="Temp" value={formatVal(sensors.t4Temp.slice(-1)[0])} unit="°C"/>
                    <SensorCard title="Pressure" value={formatVal(sensors.t4Pressure.slice(-1)[0])} unit="Pa"/>
                  </>}
                  {group==="Ambient" && <>
                    <SensorCard title="Ambient Temp" value={formatVal(sensors.ambientTemp.slice(-1)[0])} unit="°C"/>
                    <SensorCard title="Evap Exit Air Temp" value={formatVal(sensors.evapAirTemp.slice(-1)[0])} unit="°C"/>
                  </>}
                </div>
              </div>
            ))}
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
