import { useState, useRef, useCallback, useEffect } from "react";
import { useMqtt } from "./MQTT";
import { pushRolling, saveToStorage, loadFromStorage } from "../utils/array_help";
import {
  Sensors,
  circuits,
  CircuitKey,
  makeEmptySensors,
  storageKey,
  todayStr,
  sortDatesNewest,
  pickCircuitFromHash,
  INPUT_UNITS,
  toMetricTemp,
  toMetricPressure,
  SETPOINT_MIN_C,
  SETPOINT_MAX_C
} from "../utils/app_helpers";

export function useAppState() {
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
  const [rpmInput, setRpmInput] = useState<Record<CircuitKey, number | "">>({
    Circuit1: "",
    Circuit2: ""
  });
  const [rpmOverride, setRpmOverride] = useState<Record<CircuitKey, number | null>>({
    Circuit1: null,
    Circuit2: null,
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set<string>(["High Side"])
  );
  const [displayUnits, setDisplayUnits] = useState<"metric" | "imperial">("metric");

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

  const currentSensors = sensors[activeCircuit];

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
          localStorage.setItem(storageKey(circuit, "currentSetpoint"), value.toString());
          break;
            case "Compressor_RPM":
              // numeric RPM topic (retain). Store numeric override value.
              setRpmOverride(prev => ({ ...prev, [circuit]: Number.isFinite(value) ? value : null }));
              break;
      }
      return next;
    });
  }, []);

  const handleTextMessage = useCallback((topic: string, payload: string) => {
    const [prefix, circuit, name] = topic.split("/");
    if (prefix !== "Data" || !circuits.includes(circuit as CircuitKey) || !name) return;
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
    if (name === "Setpoint_Record") {
      const circuitKey = circuit as CircuitKey;
      let valueStr = payload.trim();
      const parts = valueStr.split(" ").filter(Boolean);
      if (parts.length === 2 && circuits.includes(parts[0] as CircuitKey)) {
        valueStr = parts[1];
      }
      const parsed = Number(valueStr);
      if (Number.isFinite(parsed)) {
        const value = parsed;
        setSetpoint(prev => ({ ...prev, [circuitKey]: value }));
        latestSetpointRef.current[circuitKey] = value;
        localStorage.setItem(storageKey(circuitKey, "currentSetpoint"), value.toString());
        updateSetpointLine(circuitKey, value);
      }
      return;
    }
    if (name === "Compressor_RPM") {
      const circuitKey = circuit as CircuitKey;
      const raw = payload.trim().toLowerCase();
      if (raw === "" || raw === "none" || raw === "null") {
        setRpmOverride(prev => ({ ...prev, [circuitKey]: null }));
      } else {
        const parsed = Number(payload);
        if (Number.isFinite(parsed)) {
          setRpmOverride(prev => ({ ...prev, [circuitKey]: parsed }));
        }
      }
      return;
    }
  }, [displayUnits, selectedDate, availableDates]);

  const clientRef = useMqtt({
    url: "wss://seniordesignmqtt.duckdns.org:8083",
    username: "dev",
    password: "trAneEseNdeS_4321",
    onMessage: handleMqttMessage,
    onTextMessage: handleTextMessage,
    onConnect: () => requestDates()
  });

  const updateSetpoint = (circuit: CircuitKey, displayValue: number) => {
    const metricRaw = displayUnits === "metric" ? displayValue : toMetricTemp(displayValue);
    const metricClamped = Math.min(SETPOINT_MAX_C, Math.max(SETPOINT_MIN_C, metricRaw));
    setSetpoint(prev => ({ ...prev, [circuit]: metricClamped }));
    latestSetpointRef.current[circuit] = metricClamped;
    localStorage.setItem(storageKey(circuit, "currentSetpoint"), metricClamped.toString());
    updateSetpointLine(circuit, metricClamped);

    if (clientRef.current?.connected) {
      clientRef.current.publish(`${circuit}/Space_Setpoint_Temperature`, metricClamped.toString(), { retain: true });
      clientRef.current.publish(`Data/${circuit}/Setpoint_Record`, `${metricClamped}`);
    }
  };

  const updateCompressorRPM = (circuit: CircuitKey, rpm: number | null) => {
    // rpm === null means clear override
    setRpmOverride(prev => ({ ...prev, [circuit]: rpm }));
    if (clientRef.current?.connected) {
      const payload = rpm === null ? "" : `${rpm}`;
      // publish both root topic (retained) and Data/ topic (text)
      clientRef.current.publish(`${circuit}/Compressor_RPM`, payload, { retain: true });
      clientRef.current.publish(`Data/${circuit}/Compressor_RPM`, payload, { retain: false });
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
    if (v === undefined || Number.isNaN(v)) return "--";
    const value = kind === "temp"
      ? toDisplayTemp(v!)
      : kind === "pressure"
        ? toDisplayPressure(v!)
        : v!;
    return kind === "pressure" ? value.toFixed(1) : value.toFixed(1);
  };

  useEffect(() => {
    setTempSetpointInput(prev => {
      const next = { ...prev };
      circuits.forEach(circuit => {
        if (isEditingSetpointRef.current[circuit]) return;
        next[circuit] = displayUnits === "metric" ? setpoint[circuit] : toDisplayTemp(setpoint[circuit]);
      });
      return next;
    });
  }, [displayUnits, setpoint]);

  return {
    activeCircuit,
    setActiveCircuit,
    sensors,
    labels,
    setpointData,
    setpoint,
    availableDates,
    timeRange,
    selectedDate,
    setSelectedDate,
    setTimeRange,
    rangeStart,
    rangeEnd,
    setRangeStart,
    setRangeEnd,
    lastDownloadDateRef,
    tempSetpointInput,
    setTempSetpointInput,
    rpmInput,
    setRpmInput,
    openGroups,
    setOpenGroups,
    displayUnits,
    setDisplayUnits,
    isEditingSetpointRef,
    latestSetpointRef,
    latestSampleTimestampRef,
    currentSensors,
    updateSetpoint,
    requestDates,
    requestTimeRange,
    requestDownload,
    requestPressureDownload,
    clearGraph,
    requestRange,
    showLive,
    toDisplayTemp,
    toDisplayPressure,
    formatVal,
    rpmOverride,
    updateCompressorRPM,
    clientRef
  } as const;
}

export default useAppState;
