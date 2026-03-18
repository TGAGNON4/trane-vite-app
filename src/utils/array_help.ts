// src/utils/array_help.ts
// Keep only the newest values for simple rolling charts.
export const pushRolling = <T,>(prev: T[], newVal: T, maxPoints = 50): T[] => {
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
