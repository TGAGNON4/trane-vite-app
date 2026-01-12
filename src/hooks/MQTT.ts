// src/hooks/Mqtt.ts
import { useEffect, useRef } from "react";
import mqtt, { MqttClient } from "mqtt";

type UseMqttProps = {
  url: string;
  username: string;
  password: string;
  onMessage: (topic: string, payload: number) => void;
};

export const useMqtt = ({ url, username, password, onMessage }: UseMqttProps) => {
  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    const client = mqtt.connect(url, {
      username,
      password,
      clientId: "react_" + Math.random().toString(16).slice(2),
      reconnectPeriod: 1500,
      clean: true,
    });
    clientRef.current = client;

    client.on("connect", () => {
      console.log("MQTT connected");
      const topics = [
        "sensors/t1_temp","sensors/t1_pressure",
        "sensors/t2_temp","sensors/t2_pressure",
        "sensors/t3_temp","sensors/t3_pressure",
        "sensors/t4_temp","sensors/t4_pressure",
        "sensors/ambient_temp","sensors/evap_air_temp",
        "control/setpoint"
      ];
      topics.forEach(t => client.subscribe(t));
    });

    client.on("message", (topic: string, payload: Buffer) => {
      const val = Number(payload.toString());
      if (Number.isFinite(val)) onMessage(topic, val);
    });

      return () => {
		client.end(true);   // cleanup
	  };
  }, [url, username, password, onMessage]);

  return clientRef;
};
