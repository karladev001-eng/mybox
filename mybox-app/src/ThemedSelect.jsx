import { useEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export function ThemedSelect({
  id,
  label,
  icon: Icon,
  options,
  value,
  onChange,
  disabled = false,
  compact = false,
  placement = "top",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const selected = options[selectedIndex];

  const focusOption = (index) => {
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
  };

  const openPicker = (index = selectedIndex) => {
    if (disabled || !options.length) return;
    setOpen(true);
    setActiveIndex(index);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const closePicker = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  if (!selected) return null;
  const classes = [
    "composer-picker",
    `placement-${placement}`,
    compact ? "compact" : "",
    open ? "open" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={classes}>
      <button
        ref={triggerRef}
        type="button"
        className="composer-picker-trigger"
        aria-label={`${label}：${selected.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        title={`${label}：${selected.label}`}
        onClick={() => open ? closePicker() : openPicker()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 0 : options.length - 1;
            openPicker((selectedIndex + offset) % options.length);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closePicker(true);
          }
        }}
      >
        {Icon && <Icon size={15} aria-hidden="true" />}
        <span>{selected.label}</span>
        <CaretDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div id={`${id}-listbox`} className="composer-picker-popup" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              ref={(node) => { optionRefs.current[index] = node; }}
              type="button"
              role="option"
              key={option.id}
              aria-selected={option.id === value}
              className={`${index === activeIndex ? "active" : ""}${option.id === value ? " selected" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  focusOption(event.key === "Home" ? 0 : options.length - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closePicker(true);
                } else if (event.key === "Tab") {
                  setOpen(false);
                }
              }}
              onClick={() => {
                onChange(option.id);
                closePicker(true);
              }}
            >
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              {option.id === value && <Check size={16} weight="bold" aria-label="選択中" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
