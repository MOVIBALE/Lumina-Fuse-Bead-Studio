import type { ReactNode } from "react";

export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export const workstationFieldLabelClass = "field-label";
export const workstationInputClass = "field-input";
export const mutedSectionCardClass = "panel panel--muted";
export const settingsWellClass = "settings-well";

export function resolveSectionCardClass(
  tone: "standard" | "muted" = "standard",
): string {
  return tone === "muted" ? mutedSectionCardClass : "panel";
}

interface PanelIntroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  badge?: ReactNode;
}

export function PanelIntro({
  eyebrow,
  title,
  description,
  action,
  badge,
}: PanelIntroProps) {
  return (
    <header className="panel-intro">
      <div className="panel-intro__copy">
        <div className="panel-intro__heading-row">
          <h1>{title}</h1>
          {eyebrow ? (
            <span className="panel-intro__eyebrow">{eyebrow}</span>
          ) : null}
          {badge}
        </div>
        {description ? (
          <p className="panel-intro__description">{description}</p>
        ) : null}
      </div>
      {action ? <div className="panel-intro__action">{action}</div> : null}
    </header>
  );
}

interface StatusBannerProps {
  tone?: "info" | "warning" | "error" | "success";
  className?: string;
  children: ReactNode;
}

export function StatusBanner({
  tone = "info",
  className,
  children,
}: StatusBannerProps) {
  return (
    <div
      className={cx("status-banner", `status-banner--${tone}`, className)}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
