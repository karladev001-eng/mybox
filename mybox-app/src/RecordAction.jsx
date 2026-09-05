export function RecordAction({ label, icon: Icon, onClick, disabled = false }) {
  return <button type="button" className="record-icon-action" aria-label={label} data-tooltip={label} onClick={onClick} disabled={disabled}><Icon size={16} aria-hidden="true" /></button>;
}
