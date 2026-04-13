// src/App.tsx
import "./App.css";
import { SensorCard } from "./cmpnts/SensorCard";
import { Graph } from "./cmpnts/Graph";
import useAppState from "./hooks/useAppState";
import { formatDate, todayStr, SETPOINT_MIN_C, SETPOINT_MAX_C } from "./utils/app_helpers";

export default function App() {
  const {
    activeCircuit,
    labels,
    setpointData,
    setpoint,
    availableDates,
    timeRange,
    selectedDate,
    rangeStart,
    rangeEnd,
    setSelectedDate,
    setRangeStart,
    setRangeEnd,
    setTimeRange,
    tempSetpointInput,
    setTempSetpointInput,
    rpmInput,
    setRpmInput,
    rpmOverride,
    updateCompressorRPM,
    openGroups,
    setOpenGroups,
    displayUnits,
    setDisplayUnits,
    isEditingSetpointRef,
    currentSensors,
    updateSetpoint,
    requestDates,
    requestTimeRange,
    requestDownload,
    requestPressureDownload,
    requestRange,
    showLive,
    toDisplayTemp,
    formatVal
  } = useAppState();

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
              <Graph
                labels={labels[activeCircuit]}
                dischargeTemp={currentSensors.dischargeTemp.map(toDisplayTemp)}
                setpointData={setpointData[activeCircuit].map(toDisplayTemp)}
                temperatureUnit={tempUnit}
              />
            </div>

            <div className="card setpoint-card">
              <div>Set Temperature</div>
              <div className="control-row">
                <input
                  type="number"
                  step="0.1"
                  min={displayUnits === "metric" ? SETPOINT_MIN_C : toDisplayTemp(SETPOINT_MIN_C)}
                  max={displayUnits === "metric" ? SETPOINT_MAX_C : toDisplayTemp(SETPOINT_MAX_C)}
                  value={tempSetpointInput[activeCircuit] || ""} 
                  onChange={e=>setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))} 
                  onFocus={() => { isEditingSetpointRef.current[activeCircuit] = true; }}
                  onBlur={() => {
                    isEditingSetpointRef.current[activeCircuit] = false;
                    if (tempSetpointInput[activeCircuit] === "") {
                      setTempSetpointInput(prev => ({ ...prev, [activeCircuit]: displayUnits === "metric" ? setpoint[activeCircuit] : toDisplayTemp(setpoint[activeCircuit]) }));
                    }
                  }}
                  onKeyDown={e=>{const v = tempSetpointInput[activeCircuit]; if(e.key==="Enter"&&v!=="")updateSetpoint(activeCircuit, v as number)}} 
                  className="number-input"/>
                <button className="btn" onClick={()=>{const v = tempSetpointInput[activeCircuit]; if(v!=="")updateSetpoint(activeCircuit, v as number);}}>Update</button>
              </div>
            </div>

            <div className="card setpoint-card">
              <div>Compressor RPM Override</div>
              <div className="control-row">
                <input
                  type="number"
                  step="1"
                  min={0}
                  max={4000}
                  placeholder="RPM (e.g. 3200)"
                  value={rpmInput[activeCircuit] || ""}
                  onChange={e => setRpmInput(prev => ({ ...prev, [activeCircuit]: e.target.value ? Number(e.target.value) : "" }))}
                  className="number-input"
                />
                <button className="btn" onClick={() => {
                  const v = rpmInput[activeCircuit];
                  if (v !== "") updateCompressorRPM(activeCircuit, Number(v));
                }}>Set RPM</button>
                <button className="btn" onClick={() => { setRpmInput(prev => ({ ...prev, [activeCircuit]: "" })); updateCompressorRPM(activeCircuit, null); }}>Clear</button>
              </div>
              <div style={{ marginTop: "0.5rem" }}>Current override: {rpmOverride[activeCircuit] ?? "none"}</div>
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
                <button className="btn" onClick={requestDownload}>Download temperatures</button>
                <button className="btn" onClick={requestPressureDownload}>Download pressures</button>
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

