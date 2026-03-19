// src/utils/array_help.ts
// Keep only the newest values for simple rolling charts.
// Skip NaN for number series so charts don't break on missing data.
export const pushRolling = <T,>(prev: T[], newVal: T, maxPoints = 50): T[] => {
  if (typeof newVal === "number" && Number.isNaN(newVal)) {
    return prev;
  }
  return [...prev.slice(-maxPoints + 1), newVal];
};

// Store small UI state so reloads keep recent data.
export const saveToStorage = (key: string, value: any) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : defaultValue;
};
