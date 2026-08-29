import Link from "next/link";

export function ProductMark({ href = "/dashboard", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className={`product-mark ${compact ? "product-mark-compact" : ""}`} aria-label="AI Book Studio 작업실로 이동">
      <span className="product-mark-symbol" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="product-mark-copy">
        <strong>AI Book Studio</strong>
        <small>Editorial OS</small>
      </span>
    </Link>
  );
}
