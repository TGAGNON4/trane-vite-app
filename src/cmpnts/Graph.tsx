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
  Decimation,
  type ChartOptions
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Decimation
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
      {
        label: "Evap Exit Air Temp",
        data: evapAirTemp,
        borderColor: "#60a5fa",
        backgroundColor: "#60a5fa33",
        tension: 0.35,
        pointRadius: 0,
        cubicInterpolationMode: "monotone"
      },
      {
        label: "Setpoint",
        data: setpointData,
        borderColor: "#facc15",
        borderDash: [10, 5],
        pointRadius: 0,
        fill: false
      }
    ]
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250, easing: "linear" },
    normalized: true,
    parsing: false,
    plugins:{
      legend:{display:true},
      decimation: {
        enabled: true,
        algorithm: "lttb",
        samples: 50
      }
    },
    elements: {
      point: { radius: 0, hitRadius: 6, hoverRadius: 4 }
    },
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
