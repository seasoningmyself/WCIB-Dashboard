import React from "react";

const LOGO_SOURCE = "/wcib-logo-transparent.png";

export function BrandArtwork({
  variant,
}: {
  variant: "full" | "mark";
}) {
  return (
    <span
      aria-hidden="true"
      className={`brand-artwork is-${variant}`}
    >
      <img alt="" draggable={false} src={LOGO_SOURCE} />
    </span>
  );
}

export function AuthBrand({ context }: { context?: string }) {
  return (
    <div
      aria-label="West Coast Insurance Brokers"
      className="login-brand is-logo"
    >
      <BrandArtwork variant="full" />
      {context === undefined ? null : (
        <span className="login-brand-context">{context}</span>
      )}
    </div>
  );
}
