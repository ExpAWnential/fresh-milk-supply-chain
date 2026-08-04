import type { CSSProperties, ReactNode } from "react";
import "./PageHeader.css";

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
}

export function PageHeader({ title, subtitle, children, style }: PageHeaderProps) {
  return (
    <header className="fm-pagehead" style={style}>
      <div>
        <h1 className="fm-pagehead__title">{title}</h1>
        {subtitle ? <p className="fm-pagehead__sub">{subtitle}</p> : null}
      </div>
      {children ? (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {children}
        </div>
      ) : null}
    </header>
  );
}
