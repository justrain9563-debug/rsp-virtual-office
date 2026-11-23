/** RSP brand colours live here (navy + safety orange placeholders: swap for the official values). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4fb', 100: '#d6e4f5', 200: '#a9c6ea', 400: '#4f7fbf', 500: '#2a5d9c', 600: '#1b4a82', 700: '#123a6b', 800: '#0d2b50', 900: '#081c35', 950: '#050f1e' },
        accent: { 300: '#ffb27a', 400: '#ff8f45', 500: '#f26b1d', 600: '#d45510' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        pixel: ['"Press Start 2P"', 'monospace'],
      },
    },
  },
  plugins: [],
};
