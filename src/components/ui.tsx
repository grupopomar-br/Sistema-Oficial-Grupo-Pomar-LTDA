"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { Priority } from "@/lib/domain/model";
import { monthLabel, shiftMonth } from "@/lib/domain/dates";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-logo" aria-hidden="true">
        <svg width="29" height="32" viewBox="0 0 29 32" fill="none">
          <path
            d="M14.5 2 26 8.6v14L14.5 30 3 23V9L14.5 2Z"
            stroke="currentColor"
            strokeWidth="2.3"
          />
          <path
            d="M10 23V11.5l5-3 5 3v6l-5 3v-5l3-2"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        <span className="brand-name">GRUPO POMAR</span>
        <strong>Central Operacional</strong>
      </span>
    </div>
  );
}
export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`}
      type={props.type ?? "button"}
    >
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`icon-button ${props.className ?? ""}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function PriorityBadge({ value }: { value: Priority }) {
  return (
    <Badge
      tone={
        value === "P0" || value === "P1"
          ? "danger"
          : value === "P2"
            ? "amber"
            : "neutral"
      }
    >
      {value}
    </Badge>
  );
}
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Button variant="primary" onClick={onAction}>
          <Plus size={16} />
          {action}
        </Button>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="month-picker">
      <IconButton
        label="Mês anterior"
        onClick={() => onChange(shiftMonth(value, -1))}
      >
        <ChevronLeft size={16} />
      </IconButton>
      <label>
        <span className="sr-only">Mês de referência</span>
        <input
          type="month"
          value={value}
          onChange={(event) =>
            event.target.value && onChange(event.target.value)
          }
        />
        <span aria-hidden="true">{monthLabel(value)}</span>
      </label>
      <IconButton
        label="Próximo mês"
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        <ChevronRight size={16} />
      </IconButton>
    </div>
  );
}
export function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  accent = false,
  onClick,
}: {
  title: string;
  value: ReactNode;
  detail?: string;
  icon?: LucideIcon;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`stat-card ${accent ? "stat-card-accent" : ""}`}>
      <div className="stat-top">
        <span>{title}</span>
        {Icon && <Icon size={17} />}
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-bottom">
        <span>{detail}</span>
        {onClick && (
          <button
            type="button"
            onClick={onClick}
            aria-label={`Ver ${title.toLowerCase()}`}
          >
            <ArrowUpRight size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <div className="pagination">
      <span>
        {(page - 1) * size + 1}–{Math.min(page * size, total)} de {total}
      </span>
      <div>
        <IconButton
          label="Página anterior"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <span>
          {page} / {pages}
        </span>
        <IconButton
          label="Próxima página"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </IconButton>
      </div>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""} ${drawer ? "drawer" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="Fechar janela" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export function Skeleton() {
  return (
    <div className="view-skeleton" role="status" aria-label="Carregando">
      <div />
      <div />
      <div />
    </div>
  );
}
