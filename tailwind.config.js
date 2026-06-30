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
        // Lotus Pond design system — all values are CSS vars (see tokens.css)
        // so every token flips between dark (default) and light mode.
        chai: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        'surface-elevated': 'var(--color-surface-elevated)',
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        muted: 'var(--color-text-muted)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          light: 'var(--color-accent-light)',
        },
        'ai-tint': 'var(--color-ai-tint)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-error)',
        info: 'var(--color-info)',
      },
      borderColor: {
        DEFAULT: 'var(--color-border)',
        strong: 'var(--color-border-strong)',
      },
      borderRadius: {
        sm: '0.375rem',   /* 6px — matches --radius-sm */
        DEFAULT: '0.625rem', /* 10px — matches --radius */
        lg: '0.875rem',   /* 14px — matches --radius-lg */
      },
    },
  },
  plugins: [],
}
