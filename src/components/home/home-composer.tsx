import { ArrowUp } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

interface HomeComposerProps {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function HomeComposer({
  disabled = false,
  value,
  onChange,
  onSubmit,
}: HomeComposerProps) {
  const canSubmit = !disabled && value.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      canSubmit
    ) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="home-prompt">
        给 Yoyoo 发消息
      </label>
      <textarea
        id="home-prompt"
        name="prompt"
        rows={1}
        maxLength={1200}
        disabled={disabled}
        placeholder="告诉 Yoyoo，你正在想什么"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        className="composer__send"
        type="submit"
        disabled={!canSubmit}
        aria-label="发送消息"
        title="发送消息"
      >
        <ArrowUp aria-hidden="true" size={19} strokeWidth={1.8} />
      </button>
    </form>
  );
}
