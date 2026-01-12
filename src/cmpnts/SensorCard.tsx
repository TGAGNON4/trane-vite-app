// src/cmpnts/SensorCard.tsx
import React from "react";

type SensorCardProps = {
  title: string;
  value: number | string;
  unit: string;
};

export const SensorCard: React.FC<SensorCardProps> = ({ title, value, unit }) => (
  <div className="card">
    <div className="card-title">{title}</div>
    <div className="card-value">{value}{unit}</div>
  </div>
);
