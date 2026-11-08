// Chivo (words and amounts) and Chivo Mono (raw imported text and ids), bundled from the @fontsource packages (D-22, D-58).
// Latin covers English and Spanish. Each font sets a CSS variable that base.css puts in front of the font tokens.
// Not preloaded (D-190): with swap the text paints at once in the fallback, and six preloaded files would come first.
import localFont from 'next/font/local';

export const chivo = localFont({
  variable: '--font-chivo',
  display: 'swap',
  preload: false,
  src: [
    { path: '../../../../node_modules/@fontsource/chivo/files/chivo-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../../node_modules/@fontsource/chivo/files/chivo-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../../node_modules/@fontsource/chivo/files/chivo-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../../../../node_modules/@fontsource/chivo/files/chivo-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
});

export const chivoMono = localFont({
  variable: '--font-chivo-mono',
  display: 'swap',
  preload: false,
  src: [
    { path: '../../../../node_modules/@fontsource/chivo-mono/files/chivo-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../../node_modules/@fontsource/chivo-mono/files/chivo-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
});

// Put this on <html> so both variables exist everywhere.
export const fontVariables = `${chivo.variable} ${chivoMono.variable}`;
