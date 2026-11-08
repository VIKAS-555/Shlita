import React from 'react';

interface ShlitaLogoProps {
  size?: number;
  className?: string;
  showGlow?: boolean;
}

export const ShlitaLogo: React.FC<ShlitaLogoProps> = ({
  size = 30,
  className = '',
  showGlow = true,
}) => {
  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
      {showGlow && (
        <div
          className="absolute -inset-1 rounded-full blur-md opacity-35 bg-gradient-to-tr from-accent-violet via-cyan-400 to-solana pointer-events-none transition-opacity duration-300 group-hover:opacity-60"
          style={{ width: size + 8, height: size + 8 }}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 transition-transform duration-300 group-hover:scale-105"
      >
        <defs>
          <linearGradient id="shlitaGrad" x1="4" y1="3" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#14F195" />
            <stop offset="50%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#8B72FF" />
          </linearGradient>
        </defs>

        {/* 3 Upper Energy Nodes */}
        <circle cx="8" cy="4" r="1.75" fill="#14F195" />
        <circle cx="16" cy="3.5" r="2" fill="#06B6D4" />
        <circle cx="24" cy="4" r="1.75" fill="#8B72FF" />

        {/* Dynamic Stylized Shin (ש) Trident Geometry */}
        <path
          d="M 6.5 8 C 6.5 7.2 7.2 6.5 8 6.5 C 8.8 6.5 9.5 7.2 9.5 8 L 9.5 17.5 C 9.5 21 11.8 23.5 14.8 23.8 L 14.8 7.5 C 14.8 6.7 15.3 6 16 6 C 16.7 6 17.2 6.7 17.2 7.5 L 17.2 23.8 C 20.2 23.5 22.5 21 22.5 17.5 L 22.5 8 C 22.5 7.2 23.2 6.5 24 6.5 C 24.8 6.5 25.5 7.2 25.5 8 L 25.5 17.5 C 25.5 23.5 21.2 26.5 16 26.5 C 10.8 26.5 6.5 23.5 6.5 17.5 Z"
          fill="url(#shlitaGrad)"
        />

        {/* Modern Accent Cyber Core */}
        <path
          d="M 12 18 C 13.5 19.5 15 20 16 20 C 17 20 18.5 19.5 20 18"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeOpacity="0.75"
        />
      </svg>
    </div>
  );
};
