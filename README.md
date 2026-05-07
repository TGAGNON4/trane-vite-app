# trane-vite-app

React + Vite dashboard for the Trane senior design project — displays live sensor data, historical graphs, and compressor controls over MQTT-over-WebSockets.

## Source Layout

```
src/
  main.tsx              — app entry point, mounts <App />
  App.tsx               — top-level layout; routes between dashboard and user manual
  App.css               — global app styles
  index.css             — base CSS reset / root variables
  vite-env.d.ts         — Vite environment type declarations

  cmpnts/
    SensorCard.tsx      — live sensor value tile (temperature or pressure)
    Graph.tsx           — time-series line chart for a single sensor channel
    ThermoChart.tsx     — P-h diagram overlay of R-1234yf cycle state points
    UserManual.tsx      — scrollable user manual page
    UserManual.css      — styles for the user manual

  hooks/
    MQTT.ts             — MQTT.js client wrapper; connects over WSS, exposes subscribe/publish
    useAppState.tsx     — central React context: live sensor values, setpoint, unit, compressor status

  utils/
    app_helpers.ts      — unit conversion, topic parsing, and display formatting utilities
    array_help.ts       — sliding-window and downsampling helpers for graph data
```

## Running locally

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`. The app connects to `wss://seniordesignmqtt.duckdns.org:8083` for live data. See `hooks/MQTT.ts` for broker config.

## Building for production

```bash
npm run build
```

Output goes to `dist/`. Deploy to any static host (S3, Amplify, Vercel, etc.).
