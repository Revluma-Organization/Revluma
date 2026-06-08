interface RevlumaLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

const logoUrl = new URL('../../assets/images/Revluma-logo.png', import.meta.url).href;

export function RevlumaLogo({ className = '', size = 32, showText = false }: RevlumaLogoProps) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <img
        src={logoUrl}
        alt="Revluma"
        width={size}
        height={size}
        style={{ borderRadius: size * 0.125, objectFit: 'contain', flexShrink: 0 }}
      />
      {showText && (
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 700,
          fontSize: size * 0.5,
          letterSpacing: '-0.02em',
          color: 'var(--color-text)',
        }}>
          Revluma
        </span>
      )}
    </div>
  );
}
