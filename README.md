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

---

## Deploying to AWS Amplify (from GitHub)

Amplify will automatically build and deploy the app every time you push to the connected branch.

### 1. Push the repo to GitHub

Make sure the `trane-vite-app` directory (or its own repository) is on GitHub and you have admin access to it.

### 2. Open the Amplify Console

Go to the [AWS Amplify Console](https://console.aws.amazon.com/amplify/) and click **Create new app**.

### 3. Connect your GitHub repository

1. Select **GitHub** as the source and click **Authorize AWS Amplify** if prompted.
2. Choose your repository and the branch to deploy (e.g. `main`).
3. Click **Next**.

### 4. Configure build settings

Amplify should auto-detect a Vite project. Confirm the build settings look like this (or add them manually):

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm install
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

Click **Next**, then **Save and deploy**.

### 5. Wait for the first deployment

Amplify will clone the repo, install dependencies, build, and deploy. The first build takes 2–3 minutes. When it finishes you'll see a generated URL like `https://main.xxxxxxxxxx.amplifyapp.com`.

### 6. Set a custom domain (optional)

In the Amplify Console, go to **App settings → Domain management** and click **Add domain**. If your domain is registered in Route 53, Amplify can configure DNS automatically. Otherwise follow the CNAME instructions for your registrar.

### 7. Subsequent deployments

Every `git push` to the connected branch triggers a new build and deployment automatically — no further action needed.
