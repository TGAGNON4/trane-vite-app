export type Sensors = {
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

export const circuits = ["Circuit1", "Circuit2"] as const;
export type CircuitKey = typeof circuits[number];

export const makeEmptySensors = (): Sensors => ({
  highTemp: [], highPressure: [],
  expTemp: [], expPressure: [],
  lowTemp: [], lowPressure: [],
  evapTemp: [], evapPressure: [],
  spaceTemp: [], dischargeTemp: []
});

export const storageKey = (circuit: CircuitKey, key: string) => `${circuit}:${key}`;

export const todayStr = () => new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

export const formatDate = (dateStr: string) => {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[0]}/${parts[2]}`;
};

export const sortDatesNewest = (dates: string[]) => {
  return dates.sort((a, b) => {
    const pa = a.split("-").reverse().join("");
    const pb = b.split("-").reverse().join("");
    return pb.localeCompare(pa);
  });
};

export const pickCircuitFromHash = () => {
  const hash = window.location.hash.replace("#/", "").replace("#", "");
  if (hash === "Circuit2" || hash === "circuit2") return "Circuit2" as const;
  return "Circuit1" as const;
};

// Source units: set to "metric" if MQTT already sends °C and Pa.
export const INPUT_UNITS: "imperial" | "metric" = "metric";
export const toMetricTemp = (f: number) => (f - 32) * 5 / 9;
export const toMetricPressure = (psi: number) => psi * 6894.757;
export const SETPOINT_MIN_C = 18.9;
export const SETPOINT_MAX_C = 32;
export const RPM_MIN = 2000;
export const RPM_MAX = 4600;
