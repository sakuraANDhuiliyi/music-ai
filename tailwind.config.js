/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ["'Noto Sans SC'", "'Space Grotesk'", "ui-sans-serif", "system-ui"],
                display: ["'Space Grotesk'", "'Noto Sans SC'", "ui-sans-serif", "system-ui"],
            },
        },
    },
    plugins: [],
}
