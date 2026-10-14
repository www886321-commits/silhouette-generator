import { useEffect, useId, useState } from 'react';

const parseHex = (text: string) => {
  const hex = text.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toUpperCase();
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + hex.replace(/./g, '$&$&').toUpperCase();
  return null;
};

export function ColorField({ label, name = label, value, onChange }: {
  label: string; name?: string; value: string; onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());
  const [invalid, setInvalid] = useState(false);
  const messageId = useId();
  useEffect(() => { setDraft(value.toUpperCase()); setInvalid(false); }, [value]);
  const commit = () => {
    const hex = parseHex(draft);
    if (!hex) { setInvalid(true); return; }
    onChange(hex);
    setDraft(hex);
    setInvalid(false);
  };
  return <div className="color-field">
    <span className="color-field-name">{name}</span>
    <div className="color-field-inputs">
      <input className="hex-input" type="text" aria-label={`${label} HEX色值`}
        aria-invalid={invalid} aria-describedby={invalid ? messageId : undefined}
        value={draft} maxLength={7} spellCheck={false} autoComplete="off" placeholder="#FFFFFF"
        title="输入 6 位 HEX 色值，例如 #F11B18；也支持 3 位简写"
        onChange={event => {
          const text = event.target.value;
          setDraft(text); setInvalid(false);
          if (/^#?[\da-f]{6}$/i.test(text.trim())) onChange(parseHex(text)!);
        }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(value.toUpperCase()); setInvalid(false); }
        }} />
      <input className="color-picker" type="color" aria-label={label} value={value}
        title="打开颜色选择器" onChange={event => onChange(event.target.value)} />
    </div>
    {invalid && <small id={messageId} className="hex-error" role="status">请输入 3 或 6 位十六进制色值</small>}
  </div>;
}
