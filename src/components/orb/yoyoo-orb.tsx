"use client";

import {
  type MotionStyle,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

import type { PresenceState } from "@/components/home/home-types";

import styles from "./orb-preview.module.css";

type OrbAmplitude = number | MotionValue<number>;

interface YoyooOrbProps {
  amplitude?: OrbAmplitude;
  size?: number | string;
  state: PresenceState;
}

interface OrbMotionPreset {
  glow: number;
  hue: number;
  reactivity: number;
  saturation: number;
  scale: number;
  speed: number;
}

const STATUS_BY_STATE: Record<PresenceState, string> = {
  idle: "待机中",
  preparing: "正在准备对话",
  listening: "正在聆听",
  thinking: "正在思考",
  speaking: "正在说话",
  muted: "麦克风已静音",
};

const MOTION_BY_STATE: Record<PresenceState, OrbMotionPreset> = {
  idle: {
    glow: 0.38,
    hue: 0,
    reactivity: 0,
    saturation: 0.98,
    scale: 0.96,
    speed: 0.6,
  },
  preparing: {
    glow: 0.54,
    hue: 6,
    reactivity: 0.12,
    saturation: 1.08,
    scale: 1,
    speed: 1.2,
  },
  listening: {
    glow: 0.76,
    hue: -4,
    reactivity: 1,
    saturation: 1.18,
    scale: 1.025,
    speed: 0.95,
  },
  thinking: {
    glow: 0.6,
    hue: 10,
    reactivity: 0.12,
    saturation: 1.12,
    scale: 1,
    speed: 1.4,
  },
  speaking: {
    glow: 0.72,
    hue: -9,
    reactivity: 0.72,
    saturation: 1.2,
    scale: 1.015,
    speed: 1.15,
  },
  muted: {
    glow: 0.08,
    hue: 0,
    reactivity: 0,
    saturation: 0.22,
    scale: 0.94,
    speed: 0.25,
  },
};

function useAmplitudeValue(amplitude: OrbAmplitude | undefined) {
  const fallback = useMotionValue(typeof amplitude === "number" ? amplitude : 0);
  return typeof amplitude === "object" ? amplitude : fallback;
}

/**
 * Adapted from SmoothUI's MIT-licensed Siri Orb. The palette, state mapping,
 * motion timing, markup, and CSS are Yoyoo-specific.
 */
export function YoyooOrb({ amplitude, size = 192, state }: YoyooOrbProps) {
  const reduceMotion = useReducedMotion();
  const amplitudeValue = useAmplitudeValue(amplitude);
  const preset = MOTION_BY_STATE[state];
  const status = STATUS_BY_STATE[state];
  const cssSize = typeof size === "number" ? `${size}px` : size;

  const reactiveScale = useTransform(
    amplitudeValue,
    (level) => preset.scale + level * preset.reactivity * 0.075,
  );
  const reactiveBlurRatio = useTransform(amplitudeValue, (level) => {
    const focus = 1 - level * preset.reactivity * 0.32;
    return 0.034 * focus;
  });

  const duration = reduceMotion ? 0 : 18 / preset.speed;
  const rootAnimation =
    !reduceMotion && state === "idle"
      ? { scale: [1, 1.025, 1] }
      : { scale: 1 };

  return (
    <motion.div
      animate={rootAnimation}
      aria-label={`Yoyoo 数字生命，${status}`}
      className={styles.orb}
      data-palette="cyber-spectrum"
      data-state={state}
      data-visual="fluid-orb"
      role="img"
      style={
        {
          "--orb-blur-ratio": reactiveBlurRatio,
          "--orb-duration": `${duration}s`,
          "--orb-hue": `${preset.hue}deg`,
          "--orb-saturation": preset.saturation,
          "--orb-size": cssSize,
          height: cssSize,
          width: cssSize,
        } as MotionStyle
      }
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              duration: 5.8,
              ease: [0.645, 0.045, 0.355, 1],
              repeat: state === "idle" ? Number.POSITIVE_INFINITY : 0,
            }
      }
    >
      <motion.span
        animate={{ opacity: preset.glow }}
        className={styles.glow}
        transition={{ duration: reduceMotion ? 0 : 0.55 }}
      />
      <motion.span className={styles.surface} style={{ scale: reactiveScale }}>
        <span aria-hidden="true" className={styles.sheen} />
        <span aria-hidden="true" className={styles.rim} />
      </motion.span>
    </motion.div>
  );
}
