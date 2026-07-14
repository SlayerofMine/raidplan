/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Editor chrome palette (dark).
        panel: "#151a22",
        panelborder: "#232b38",
        accent: "#4f9dff",
      },
    },
  },
  plugins: [],
};
