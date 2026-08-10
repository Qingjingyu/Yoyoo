"use client";

import { useAnimationFrame, useMotionValue } from "motion/react";
import { useState } from "react";

import type { PresenceState } from "@/components/home/home-types";

import styles from "./orb-preview.module.css";
import { YoyooOrb } from "./yoyoo-orb";

const PREVIEW_STATES: ReadonlyArray<{
  label: string;
  state: PresenceState;
}> = [
  { label: "待机中", state: "idle" },
  { label: "正在准备对话", state: "preparing" },
  { label: "正在聆听", state: "listening" },
  { label: "正在思考", state: "thinking" },
  { label: "正在说话", state: "speaking" },
  { label: "麦克风已静音", state: "muted" },
];

function usePreviewAmplitude(state: PresenceState) {
  const amplitude = useMotionValue(0);

  useAnimationFrame((time) => {
    const active = state === "listening" || state === "speaking";
    if (!active) {
      amplitude.set(amplitude.get() * 0.9);
      return;
    }

    const seconds = time / 1000;
    const envelope =
      0.4 +
      0.2 * Math.sin(seconds * 2.1) +
      0.11 * Math.sin(seconds * 5.2 + 1.4) +
      0.05 * Math.sin(seconds * 9.7 + 0.2);
    amplitude.set(Math.min(0.72, Math.max(0.08, envelope)));
  });

  return amplitude;
}

export function OrbPreview() {
  const [state, setState] = useState<PresenceState>("idle");
  const amplitude = usePreviewAmplitude(state);
  const current = PREVIEW_STATES.find((item) => item.state === state) ?? PREVIEW_STATES[0];

  return (
    <section className={styles.preview} aria-labelledby="orb-preview-title">
      <div className={styles.focus}>
        <p className={styles.eyebrow}>DIGITAL PRESENCE / 01</p>
        <h1 id="orb-preview-title">Yoyoo</h1>

        <div className={styles.orbStage}>
          <YoyooOrb amplitude={amplitude} size={232} state={state} />
        </div>

        <div className={styles.status} aria-live="polite">
          <span aria-hidden="true" />
          {current.label}
        </div>
      </div>

      <div className={styles.stateSelector} aria-label="数字生命状态预览">
        {PREVIEW_STATES.map((item) => (
          <button
            aria-label={`预览${item.label}`}
            aria-pressed={state === item.state}
            className={styles.stateButton}
            key={item.state}
            onClick={() => setState(item.state)}
            type="button"
          >
            {item.label.replace("正在", "")}
          </button>
        ))}
      </div>
    </section>
  );
}

