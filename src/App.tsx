import React, { useEffect, useState, useRef } from "react";
import "./App.css";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from "chart.js";
import mqtt, { MqttClient } from "mqtt";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const MAX_POINTS = 50;

// Generic rolling push
const pushRolling = <T,>(prev: T[], newVal: T): T[] =>
  [...prev.slice(-MAX_POINTS + 1), newVal];

const saveToStorage = (key: string, value: any) =>
  localStorage.setItem(key, JSON.stringify(value));

const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : defaultValue;
};

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

type AccordionState = {
  [key: string]: boolean;
};

type SensorCardProps = {
  title: string;
  value: number | string;
  unit: string;
};

const SensorCard: React.FC<SensorCardProps> = ({ title, value, unit }) => (
  <div className="card">
    <div className="card-title">{title}</div>
    <div className="card-value">{value}{unit}</div>
  </div>
);

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
  const [accordionOpen, setAccordionOpen] = useState<AccordionState>({
    t1: true, t2: true, t3: true, t4: true, ambient: true
  });

  const clientRef = useRef<MqttClient | null>(null);
  const latestSetpointRef = useRef<number>(setpoint);
  latestSetpointRef.current = setpoint;

  const updateSetpointLine = (sp: number) => {
    setSetpointData(prev => {
      const arr = prev.length ? [...prev] : [sp];
      arr[arr.length - 1] = sp;
      saveToStorage("setpointData", arr);
      return arr;
    });
  };

  useEffect(() => {
    // MQTT connection with auth
    const mqttUrl = "ws://18.218.224.28:1884"; // Use wss:// if TLS enabled
    const client = mqtt.connect(mqttUrl, {
      clientId: "react_" + Math.random().toString(16).slice(2),
      username: "dev",          // your MQTT username
      password: "trAneEseNdeS_4321",// replace with actual password
      reconnectPeriod: 1500,
      clean: true
    });
    clientRef.current = client;

    client.on("connect", () => {
      console.log("MQTT connected");
      const topics = [
        "sensors/t1_temp","sensors/t1_pressure",
        "sensors/t2_temp","sensors/t2_pressure",
        "sensors/t3_temp","sensors/t3_pressure",
        "sensors/t4_temp","sensors/t4_pressure",
        "sensors/ambient_temp","sensors/evap_air_temp",
        "control/setpoint"
      ];
      topics.forEach(t => client.subscribe(t));
    });

    client.on("message", (topic: string, payload: Buffer) => {
      const val = Number(payload.toString());
      if (!Number.isFinite(val)) return;
      const now = new Date().toLocaleTimeString();

      setSensors(prev => {
        const next: Sensors = { ...prev };
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
            setLabels(prev => { 
              const nextLabels = pushRolling(prev, now); 
              saveToStorage("labels", nextLabels); 
              return nextLabels; 
            });
            setSetpointData(prev => { 
              const spArr = pushRolling(prev, latestSetpointRef.current); 
              saveToStorage("setpointData", spArr); 
              return spArr; 
            });
            saveToStorage("evapAirTemp", next.evapAirTemp);
            break;
          case "control/setpoint":
            setSetpoint(val); 
            latestSetpointRef.current = val; 
            setTempSetpointInput(val); 
            localStorage.setItem("currentSetpoint", val);
            break;
        }
        return next;
      });
    });

    return () => client.end(true);
  }, []);

  const updateSetpoint = (sp: number) => {
    setSetpoint(sp);
    latestSetpointRef.current = sp;
    localStorage.setItem("currentSetpoint", sp);
    updateSetpointLine(sp);

    if(clientRef.current?.connected){
      clientRef.current.publish("control/setpoint", sp.toString(), { retain: true });
    }
  };

  const toggleAccordion = (group: string) => {
    setAccordionOpen(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const formatVal = (v: number | undefined) => Number.isFinite(v!) ? v!.toFixed(1) : "—";

  const data = {
    labels,
    datasets: [
      { label: "Evap Exit Air Temp", data: sensors.evapAirTemp, borderColor: "#60a5fa", backgroundColor: "#60a5fa33", tension: 0.2 },
      { label: "Setpoint", data: setpointData, borderColor: "#facc15", borderDash:[10,5], pointRadius:0, fill:false }
    ]
  };

  const options = {
    responsive:true,
    plugins:{legend:{display:true}},
    scales:{
      x: {
        title: { display: true, text: "Time" },
        ticks: {
          callback: (value: any, index: number, ticks: any) => {
            if(index === 0 || index === ticks.length - 1) return value;
            return '';
          }
        }
      },
      y:{title:{display:true,text:"Temperature (°C)"}}
    }
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
            {["Compressor Outlet","Condenser Outlet","Expansion Device Outlet","Evaporator Outlet","Ambient"].map(group => (
              <div key={group} className="accordion-group">
                <div className="accordion-header" onClick={()=>toggleAccordion(group)}>
                  {group} Sensors {accordionOpen[group] ? "▲":"▼"}
                </div>
                {accordionOpen[group] && (
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
                )}
              </div>
            ))}
          </div>

          <div className="right-col">
            <div className="card graph-card"><Line data={data} options={options}/></div>

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
