import type { CSSProperties } from "react";
import "./TextInput.css";

export interface TextInputProps {
  readonly label?: string;
  readonly value: string;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly style?: CSSProperties;
  readonly id?: string;
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  style,
  id
}: TextInputProps) {
  const input = (
    <input
      id={id}
      className={"fm-input" + (mono ? " fm-input--mono" : "")}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      style={label ? undefined : style}
    />
  );

  if (!label) return input;

  return (
    <span className="fm-field" style={style}>
      <label htmlFor={id}>{label}</label>
      {input}
    </span>
  );
}
