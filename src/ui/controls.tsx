import { useId, useState, type ReactNode } from 'react'
import { Icon } from './Icons'

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="switch-row" style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <span className="switch-text">
        {label}
        {hint ? <div className="field-hint">{hint}</div> : null}
      </span>
    </label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full = true,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  full?: boolean
}) {
  return (
    <div className={full ? 'segmented full' : 'segmented'} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          data-active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format: (value: number) => string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)', minWidth: 52, textAlign: 'right' }}>
        {format(value)}
      </span>
    </div>
  )
}

export function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="group">
      <button type="button" className="group-head" data-open={open} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="group-title">{title}</span>
        <Icon name="chevron" size={14} className="chev" />
      </button>
      {open ? (
        <div className="group-content" id={id}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
