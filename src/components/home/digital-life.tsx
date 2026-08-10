import type { PresenceState } from "./home-types";

interface DigitalLifeProps {
  state: PresenceState;
  mode?: "home" | "live";
}

const statusByState: Record<PresenceState, string> = {
  idle: "待机中",
  preparing: "正在准备对话",
  listening: "正在聆听",
  thinking: "正在思考",
  speaking: "正在说话",
  muted: "麦克风已静音",
};

export function DigitalLife({ state, mode = "home" }: DigitalLifeProps) {
  const statusText = statusByState[state];

  return (
    <div className="presence-wrap" data-mode={mode}>
      <div
        className="digital-life"
        data-state={state}
        role="img"
        aria-label={`Yoyoo 数字生命，${statusText}`}
      >
        <span className="digital-life__field" aria-hidden="true" />
        <span className="digital-life__orbit digital-life__orbit--outer" aria-hidden="true" />
        <span className="digital-life__orbit digital-life__orbit--middle" aria-hidden="true" />
        <span className="digital-life__orbit digital-life__orbit--inner" aria-hidden="true" />
        <span className="digital-life__echo" aria-hidden="true" />
        <span className="digital-life__core" aria-hidden="true" />
      </div>
      <div className="presence-status" aria-live="polite">
        <span className="presence-status__signal" aria-hidden="true" />
        <span>{statusText}</span>
      </div>
    </div>
  );
}
