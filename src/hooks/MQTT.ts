// src/hooks/MQTT.ts
import { useEffect, useRef } from "react";
import mqtt, { MqttClient } from "mqtt";

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
      onConnect?.(client);

      const circuits = ["Circuit1", "Circuit2"];
      const baseTopics = [
        "HighSide_Temperature", "HighSide_AbsolutePressure",
        "EXV_Temperature", "EXV_AbsolutePressure",
        "LowSide_Temperature", "LowSide_AbsolutePressure",
        "Evaporator_Temperature", "Evaporator_AbsolutePressure",
        "Space_Temperature", "Sample_Timestamp", "Discharge_Air_Temperature",
        "Space_Setpoint_Temperature"
      ];
      const topics = circuits.flatMap(circuit =>
        baseTopics.map(topic => `${circuit}/${topic}`)
      );
      topics.push("latency/probe");
      topics.push("Data/Available_Dates");
      topics.push("Data/Available_Time_Ranges");
      topics.push("Data/Download");
      topics.push("Data/Select_Time_Status");
      topics.push("Data/Select_Range_Status");

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
      if (topic.startsWith("Data/")) {
        onTextMessage?.(topic, payload.toString());
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
      if (Number.isFinite(val)) {
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
