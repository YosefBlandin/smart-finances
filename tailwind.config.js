/** @type {import('tailwindcss').Config} */
module.exports = {
  important: true,
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'rgba(var(--color-primary-50), var(--tw-text-opacity))',
          100: 'rgba(var(--color-primary-100), var(--tw-text-opacity))',
          200: 'rgba(var(--color-primary-200), var(--tw-text-opacity))',
          300: 'rgba(var(--color-primary-300), var(--tw-text-opacity))',
          400: 'rgba(var(--color-primary-400), var(--tw-text-opacity))',
          500: 'rgba(var(--color-primary-500), var(--tw-text-opacity))',
          600: 'rgba(var(--color-primary-600), var(--tw-text-opacity))',
          700: 'rgba(var(--color-primary-700), var(--tw-text-opacity))',
          800: 'rgba(var(--color-primary-800), var(--tw-text-opacity))',
          900: 'rgba(var(--color-primary-900), var(--tw-text-opacity))'
        },
        secondary: {
          50: 'rgba(var(--color-secondary-50), var(--tw-text-opacity))',
          100: 'rgba(var(--color-secondary-100), var(--tw-text-opacity))',
          200: 'rgba(var(--color-secondary-200), var(--tw-text-opacity))',
          300: 'rgba(var(--color-secondary-300), var(--tw-text-opacity))',
          400: 'rgba(var(--color-secondary-400), var(--tw-text-opacity))',
          500: 'rgba(var(--color-secondary-500), var(--tw-text-opacity))',
          600: 'rgba(var(--color-secondary-600), var(--tw-text-opacity))',
          700: 'rgba(var(--color-secondary-700), var(--tw-text-opacity))',
          800: 'rgba(var(--color-secondary-800), var(--tw-text-opacity))',
          900: 'rgba(var(--color-secondary-900), var(--tw-text-opacity))'
        },
      },
    },
    plugins: [],
  }
}
