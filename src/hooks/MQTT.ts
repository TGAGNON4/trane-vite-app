// src/hooks/MQTT.ts
import { useEffect, useRef } from "react";
import mqtt, { MqttClient } from "mqtt";

// MQTT topic lists for sensor data and app data.
const CIRCUITS = ["Circuit1", "Circuit2"];
const SENSOR_TOPICS = [
  "HighSide_Temperature", "HighSide_AbsolutePressure",
  "EXV_Temperature", "EXV_AbsolutePressure",
  "LowSide_Temperature", "LowSide_AbsolutePressure",
  "Evaporator_Temperature", "Evaporator_AbsolutePressure",
  "Space_Temperature", "Sample_Timestamp", "Discharge_Air_Temperature",
  "Space_Setpoint_Temperature",
  "Compressor_RPM",
  "Compressor_Current_RPM",
  "HMI_Status"
];
// Circuit-level topics that carry text payloads (not numeric sensor data)
const CIRCUIT_TEXT_TOPICS = ["Status", "Unit", "Session_Lock"];
const DATA_TOPICS = [
  "Available_Dates",
  "Available_Time_Ranges",
  "Temperature_Download",
  "Pressure_Download",
  "Setpoint_Download",
  "Select_Time_Status",
  "Select_Range_Status",
  "Setpoint_Record",
  "Compressor_RPM",
  "Compressor_Shutdown_Status",
  // CoolProp thermodynamic data published by the Pi
  "R1234yf_Saturation_Table",
  "R1234yf_State_Points",
];

type UseMqttProps = {
  url: string;
  username: string;
  password: string;
  onMessage: (topic: string, payload: number) => void;
  onTextMessage?: (topic: string, payload: string) => void;
  onConnect?: (client: MqttClient) => void;
};

export const useMqtt = ({ url, username, password, onMessage, onTextMessage, onConnect }: UseMqttProps) => {
  const clientRef = useRef<MqttClient | null>(null);
  const onTextMessageRef = useRef(onTextMessage);
  const onConnectRef = useRef(onConnect);
  onTextMessageRef.current = onTextMessage;
  onConnectRef.current = onConnect;

  useEffect(() => {
    console.log("Connecting to MQTT broker at", url);
    const client = mqtt.connect(url, {
      username,
      password,
      clientId: "react_" + Math.random().toString(16).slice(2),
      reconnectPeriod: 2000, // reconnect every 2s
      clean: true,
    });

    clientRef.current = client;

    client.on("connect", () => {
      console.log("MQTT connected");
      onConnectRef.current?.(client);

      const topics = CIRCUITS.flatMap(circuit =>
        SENSOR_TOPICS.map(topic => `${circuit}/${topic}`)
      );
      topics.push("latency/probe");
      CIRCUITS.forEach(circuit => {
        DATA_TOPICS.forEach(t => topics.push(`Data/${circuit}/${t}`));
        CIRCUIT_TEXT_TOPICS.forEach(t => topics.push(`${circuit}/${t}`));
      });

      topics.forEach(t => {
        client.subscribe(t, { qos: 0 }, (err) => {
          if (err) console.error("❌ Subscribe error for topic", t, err);
          else console.log("Subscribed to", t);
        });
      });
    });

    client.on("reconnect", () => {
      console.log("MQTT reconnecting...");
    });

    client.on("offline", () => {
      console.log("MQTT offline");
    });

    client.on("error", (err) => {
      console.error("MQTT error:", err.message);
    });

    client.on("message", (topic: string, payload: Buffer) => {
      // App data and circuit-level text topics are text; sensor data is numbers.
      if (topic.startsWith("Data/") || CIRCUITS.some(c => CIRCUIT_TEXT_TOPICS.some(t => topic === `${c}/${t}`))) {
        onTextMessageRef.current?.(topic, payload.toString());
        return;
      }
      if (topic === "latency/probe") {
        try {
          const probe = JSON.parse(payload.toString()) as {
            id?: string;
            circuit?: string;
          };
          if (!probe.id || !probe.circuit) return;
          const ack = JSON.stringify({ id: probe.id, circuit: probe.circuit });
          client.publish("latency/ack", ack);
        } catch (err) {
          console.warn("Invalid latency probe payload", payload.toString());
        }
        return;
      }

      const val = Number(payload.toString());
      if (Number.isFinite(val) || Number.isNaN(val)) {
        console.log("Message received", topic, val);
        onMessage(topic, val);
      } else {
        console.warn("Invalid message payload on", topic, payload.toString());
      }
    });

    return () => {
      console.log("Disconnecting MQTT client");
      client.end(true); // force disconnect and clean
    };
  }, [url, username, password, onMessage]);

  return clientRef;
};
