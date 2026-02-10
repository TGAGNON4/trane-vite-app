// src/cmpnts/Graph.tsx
import React from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type GraphProps = {
  labels: number[];
  evapAirTemp: number[];
  setpointData: number[];
};

export const Graph: React.FC<GraphProps> = ({ labels, evapAirTemp, setpointData }) => {
  const formattedLabels = labels.map(ts => new Date(ts).toLocaleTimeString());
  const data = {
    labels: formattedLabels,
    datasets: [
      { label: "Evap Exit Air Temp", data: evapAirTemp, borderColor: "#60a5fa", backgroundColor: "#60a5fa33", tension: 0.2 },
      { label: "Setpoint", data: setpointData, borderColor: "#facc15", borderDash:[10,5], pointRadius:0, fill:false }
    ]
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins:{legend:{display:true}},
    scales:{
      x: {
        title: { display: true, text: "Time" },
        ticks: {
          callback: function(this: any, value: any, index: number, ticks: any) {
            if(index === 0 || index === ticks.length - 2) return this.getLabelForValue(value);
            return '';
          }
        }
      },
      y:{title:{display:true,text:"Temperature (°C)"}}
    }
  };

  return <Line data={data} options={options} />;
};
