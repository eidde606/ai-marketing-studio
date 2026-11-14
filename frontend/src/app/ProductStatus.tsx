import type { ReactNode } from "react";

type StatusTone = "positive" | "neutral" | "warning";

export function AccountStatusNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <aside className="product-status product-status--positive" role="status">
      <strong>{title}</strong>
      <p>{description}</p>
    </aside>
  );
}

export function CapabilityStatus({
  label,
  available,
  availableText,
  unavailableText,
  detail,
}: {
  label: string;
  available: boolean;
  availableText: string;
  unavailableText: string;
  detail?: string;
}) {
  return (
    <li className="capability-status">
      <span>{label}</span>
      <strong aria-label={available ? availableText : unavailableText}>
        {available ? availableText : unavailableText}
      </strong>
      {detail && <small>{detail}</small>}
    </li>
  );
}

export function ProductNotice({
  title,
  description,
  tone = "neutral",
  children,
}: {
  title: string;
  description: string;
  tone?: StatusTone;
  children?: ReactNode;
}) {
  return (
    <aside className={`product-status product-status--${tone}`} role="note">
      <strong>{title}</strong>
      <p>{description}</p>
      {children}
    </aside>
  );
}

export function SubscriptionNotice({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <ProductNotice title={title} description={description}>
      {action}
    </ProductNotice>
  );
}
