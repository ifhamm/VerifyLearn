/** @type {import('tailwindcss').Config} */
module.exports = {
  // Pastikan path content ini mencakup semua file HTML dan JS Anda
  content: [
    "./public/**/*.{html,js}",
    "./src/**/*.{html,js}" 
  ],
  theme: {
    extend: {
      colors: {
        base: '#ffffff', 
        panel: '#f4f4f5', 
        textMain: '#09090b', 
        textMuted: '#52525b', 
        brandOrange: '#ff4500', 
        brandViolet: '#7c3aed', 
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #ff4500, #7c3aed)',
        'grid-pattern': 'linear-gradient(to right, rgba(9, 9, 11, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(9, 9, 11, 0.05) 1px, transparent 1px)'
      },
      boxShadow: {
        'brutal': '4px 4px 0px 0px rgba(9,9,11,1)',
        'brutal-sm': '2px 2px 0px 0px rgba(9,9,11,1)',
      }
    }
  },
  plugins: [],
}