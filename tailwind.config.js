/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['DM Mono', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        // Chai Dark design system — matches DESIGN.md tokens
        chai: '#1A1410',
        surface: '#2C2218',
        'surface-raised': '#3D3025',
        'surface-elevated': '#4A3C2E',
        primary: '#F5EDD6',
        secondary: '#C4A882',
        muted: '#7A6A54',
        accent: {
          DEFAULT: '#E07B3A',
          hover: '#C4612A',
          light: '#F4A97B',
        },
        'ai-tint': '#A78BFA',
        success: '#4CAF7D',
        warning: '#D97706',
        danger: '#E05C5C',
      },
      borderColor: {
        DEFAULT: 'rgba(245, 237, 214, 0.08)',
        strong: 'rgba(245, 237, 214, 0.15)',
      },
    },
  },
  plugins: [],
}
