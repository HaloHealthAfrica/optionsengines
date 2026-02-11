/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        slate: {
          950: '#0b1221',
        },
        brand: {
          50: '#eef8ff',
          100: '#d7eeff',
          200: '#b3ddff',
          300: '#79c7ff',
          400: '#3aa8ff',
          500: '#0f86ff',
          600: '#0a6de5',
          700: '#0b59b7',
          800: '#0f4a92',
          900: '#0f3c75',
        },
        cyan: {
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
      boxShadow: {
        card: '0 8px 24px -16px rgba(15, 24, 42, 0.5)',
        glass: '0 12px 48px -24px rgba(15, 23, 42, 0.7)',
      },
      backdropBlur: {
        glass: '20px',
      },
    },
  },
  plugins: [],
};
