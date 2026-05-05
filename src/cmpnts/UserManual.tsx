import { useEffect } from "react";
import "./UserManual.css";

type Section = {
  title: string;
  steps: { heading?: string; text: string }[];
};

const SECTIONS: Section[] = [
  {
    title: "Startup",
    steps: [
      {
        heading: "Connect Ethernet first",
        text:
          "The box must be plugged into a working Ethernet connection before powering on. Without it the display will stay on \"Setting up …\" indefinitely and no data will be logged.",
      },
      {
        heading: "Power on the Raspberry Pi",
        text:
          'The display shows "Setting up …" for about 30–60 seconds while the system boots. Do not press any buttons.',
      },
      {
        heading: "Wait for the normal screen",
        text:
          "The display switches to the main control screen once ready. Temperature and pressure logging begins immediately.",
      },
      {
        heading: "Open the website dashboard",
        text:
          "Navigate to the dashboard in a web browser. Live sensor readings will begin populating within a few seconds of the page loading.",
      },
    ],
  },
  {
    title: "Starting the Compressor",
    steps: [
      {
        heading: "Press Start on the display or website",
        text:
          'Tap the "Start Compressor" button on the Nextion display or click "Start Compressor" on the website. The display will show "Ramping RPM up …" while the compressor slowly speeds up to operating speed.',
      },
      {
        heading: "Wait for normal operation",
        text:
          "After about one minute the display returns to the normal screen and the compressor is running under automatic control. Live sensor readings on the website will begin updating.",
      },
    ],
  },
  {
    title: "Adjusting the Temperature Setpoint",
    steps: [
      {
        heading: "On the Nextion display",
        text:
          "Use the + and − buttons on the display to raise or lower the target temperature. The compressor will automatically adjust its speed to reach the new target.",
      },
      {
        heading: "On the website",
        text:
          'Type a value into the "Set Temperature" box and click Update. The change takes effect immediately and is also reflected on the Nextion display.',
      },
      {
        heading: "Switching between °C and °F",
        text:
          'Tap the unit button on the Nextion display, or click "Show Imperial" / "Show Metric" at the top of the website. Both the display and the website update together.',
      },
    ],
  },
  {
    title: "Reading Live Sensor Data",
    steps: [
      {
        heading: "Left panel — sensor cards",
        text:
          "The left side of the website shows the current temperature and pressure for each sensor location: High Side, Expansion Valve, Low Side, Evaporator, and Space. Click a group name to expand or collapse it.",
      },
      {
        heading: "Time-series chart",
        text:
          "The right side shows a live chart. Click any sensor label above the chart to add or remove it from the graph. Data scrolls in real time.",
      },
      {
        heading: "P-h diagram",
        text:
          'Click "P-h diagram" to see the refrigeration cycle plotted on a pressure–enthalpy chart. The four coloured dots show where each sensor sits in the cycle. Note: the corners of the cycle may not be precisely accurate due to sensor placement.',
      },
      {
        heading: "P vs T diagram",
        text:
          'Click "P vs T" to see pressure versus temperature for each sensor overlaid on the refrigerant saturation curve. Note: the corners of the cycle may not be precisely accurate due to sensor placement.',
      },
    ],
  },
  {
    title: "Manual Compressor Speed Override",
    steps: [
      {
        heading: "Set an RPM override",
        text:
          'Type a speed (in RPM) into the "Compressor RPM Override" box and click Set. The compressor will ramp to that speed and hold it, bypassing automatic control. The current RPM is shown above the box.',
      },
      {
        heading: "Return to automatic control",
        text:
          "Click Clear next to the RPM override box, or change the temperature setpoint. Either action hands control back to the automatic system.",
      },
    ],
  },
  {
    title: "Shutting Down the Compressor",
    steps: [
      {
        heading: "Press Shutdown on the display or website",
        text:
          'Tap "Shutdown" on the Nextion display or click "Shutdown Compressor" on the website. The display will show "Ramping RPM down …" while the compressor gradually slows.',
      },
      {
        heading: "Wait for shutdown to complete",
        text:
          "Once the compressor reaches its minimum speed the display returns to the normal screen. The compressor remains at low speed until you press Start again.",
      },
    ],
  },
  {
    title: "Viewing Historical Data",
    steps: [
      {
        heading: "Select a date",
        text:
          'In the Data section at the bottom of the website, click "Get dates" to load available days. Choose a date from the dropdown.',
      },
      {
        heading: "Show a time range",
        text:
          'Enter a start and end time in HH:MM:SS format and click "Show range". The chart will replay the sensor readings from that period.',
      },
      {
        heading: "Return to live data",
        text:
          'Click "Live data" to go back to real-time readings.',
      },
      {
        heading: "Download data files",
        text:
          'Click "Download Temperatures", "Download Pressures", or "Download Setpoints" to save a copy of the logged data as a text file.',
      },
    ],
  },
];

type Props = { onClose: () => void };

export default function UserManual({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="um-overlay" onClick={onClose}>
      <div className="um-modal" onClick={e => e.stopPropagation()}>
        <div className="um-header">
          <h2 className="um-title">User Manual</h2>
          <button className="um-close" onClick={onClose} aria-label="Close">&#x2715;</button>
        </div>
        <div className="um-body">
          {SECTIONS.map((section, si) => (
            <section key={si} className="um-section">
              <h3 className="um-section-title">
                <span className="um-section-num">{si + 1}</span>
                {section.title}
              </h3>
              <ol className="um-steps">
                {section.steps.map((step, i) => (
                  <li key={i} className="um-step">
                    {step.heading && <span className="um-step-heading">{step.heading} — </span>}
                    {step.text}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
