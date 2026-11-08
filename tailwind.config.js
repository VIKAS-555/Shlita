/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./packages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0D14',
        card: '#12151F',
        'card-elevated': '#171A26',
        sidebar: '#0E1019',
        border: 'rgba(255, 255, 255, 0.08)',
        'border-hover': 'rgba(255, 255, 255, 0.16)',
        solana: {
          DEFAULT: '#14F195',
          purple: '#9945FF',
        },
        accent: {
          violet: '#8B72FF',
          cyan: '#06B6D4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
