import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  /** Heading id, for aria-labelledby. */
  id: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Wrap the children in one rounded card (default). Pass false to lay out several cards. */
  card?: boolean;
  className?: string;
}

/** An inset-grouped section: a heading, a rounded card and optional footnotes. */
export function Section({ title, id, action, footer, children, card = true, className }: SectionProps) {
  return (
    <section className={className ? `group ${className}` : 'group'} aria-labelledby={id}>
      <div className="group__header">
        <h2 className="group__title" id={id}>
          {title}
        </h2>
        {action}
      </div>
      {card ? <div className="card">{children}</div> : children}
      {footer}
    </section>
  );
}
