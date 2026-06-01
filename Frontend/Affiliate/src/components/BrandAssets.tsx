/**
 * Brand Assets Component
 * Centralized production-ready branding with optimization
 *
 * ISSUE #3 FIX: Replace placeholder icons with production branding
 * - RevlumaLogo: Official branding (replaces CPU icon)
 * - FounderImage: Optimized founder photo with fallback
 * - Lazy loading and responsive rendering
 */

import React from 'react';

/**
 * Revluma Logo Component
 * Used in navbar and footer
 * Production-ready with proper sizing and alt text
 */
export const RevlumaLogo: React.FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({
  className = '',
  size = 'md'
}) => {
  const sizeMap = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  };

  return (
    <div className={`${sizeMap[size]} ${className} rounded-lg bg-gradient-to-br from-white to-zinc-200 flex items-center justify-center border border-zinc-800 flex-shrink-0`}>
      {/* SVG Logo – Revluma R Icon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full p-1"
        aria-label="Revluma"
      >
        <rect width="24" height="24" fill="white" rx="4" />
        <path
          d="M8 6h4v10h-4V6zm0 12h4v2H8z"
          fill="#1a1a1a"
        />
        <path
          d="M13 8h3c1.1 0 2 .9 2 2v2c0 1.1-.9 2-2 2h-1v4h-2V8z"
          fill="#1a1a1a"
        />
      </svg>
    </div>
  );
};

/**
 * Luminor Terminal Logo
 * Brand secondary mark
 */
export const LuminorLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex items-center gap-1 ${className}`}>
    <div className="w-4 h-4 rounded-sm bg-violet-600 flex items-center justify-center flex-shrink-0">
      <span className="text-[8px] font-bold text-white">LT</span>
    </div>
    <span className="text-xs font-semibold text-white">LUMINOR</span>
  </div>
);

/**
 * Founder Profile Image Component
 * Optimized with lazy loading and responsive sizing
 * Production-ready with proper error handling and fallback
 */
interface FounderImageProps {
  src: string;
  alt: string;
  name: string;
  className?: string;
  priority?: boolean;
}

export const FounderImage: React.FC<FounderImageProps> = ({
  src,
  alt,
  name,
  className = 'w-36 h-36',
  priority = false
}) => {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  return (
    <div className={`${className} rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center border border-zinc-800 relative overflow-hidden group flex-shrink-0`}>
      {/* Placeholder gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-700/20 to-zinc-900/20" />

      {/* Image */}
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded && !error ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          setError(true);
          setIsLoaded(true);
        }}
        width={144}
        height={144}
      />

      {/* Fallback when image not loaded */}
      {(!isLoaded || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 z-10 bg-gradient-to-br from-zinc-700/10 to-zinc-900/10">
          <div className="w-12 h-12 rounded-full bg-zinc-700/50 flex items-center justify-center mb-2">
            <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Founder</div>
          <div className="text-[10px] font-bold text-zinc-300 uppercase mt-0.5 truncate max-w-[100px]">{name}</div>
        </div>
      )}

      {/* Loading skeleton */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-800 via-zinc-700 to-zinc-800 animate-pulse" />
      )}
    </div>
  );
};

/**
 * Brand colors
 */
export const BRAND_COLORS = {
  primary: '#ffffff',
  secondary: '#6366f1', // violet-500
  accent: '#fbbf24',    // amber-400
  dark: '#09090b',      // zinc-950
  text: '#f4f4f5'       // zinc-100
};

/**
 * Generate optimized image URLs with sizing
 */
export function getOptimizedImageUrl(
  source: string,
  width: number,
  height: number,
  quality: 'low' | 'medium' | 'high' = 'high'
): string {
  const qualityMap = { low: 60, medium: 80, high: 95 };

  // For Vercel/Next.js Image Optimization
  if (source.includes('vercel.app') || source.includes('nextjs')) {
    return `${source}?w=${width}&h=${height}&q=${qualityMap[quality]}&fit=crop`;
  }

  // For standard URLs
  return source;
}
