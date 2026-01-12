// src/utils/array_help.ts
export const pushRolling = (prev: number[], newVal: number, maxPoints = 50): number[] =>
  [...prev.slice(-maxPoints + 1), newVal];

export const saveToStorage = (key: string, value: any) =>
  localStorage.setItem(key, JSON.stringify(value));

export const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : defaultValue;
};
