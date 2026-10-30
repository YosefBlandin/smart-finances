// Every story renders with the app's tokens, base styles and fonts, in the language and colour scheme its globals name:
// locale en or es (next-intl, D-126) and theme light or dark (tokens.css data-theme). Accessibility violations fail
// the test runner (D-129, D-136).
import '@fontsource/chivo/400.css';
import '@fontsource/chivo/500.css';
import '@fontsource/chivo/700.css';
import '@fontsource/chivo/800.css';
import '@fontsource/chivo-mono/400.css';
import '@fontsource/chivo-mono/500.css';
import type { Decorator, Preview } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import en from '../messages/en.json';
import es from '../messages/es.json';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import styles from './preview.module.css';

const withLanguageAndTheme: Decorator = (Story, context) => {
  const locale = context.globals.locale === 'es' ? 'es' : 'en';
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('data-theme', theme);
  }
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      <div className={styles.frame} data-stack={context.parameters.stack === 'column' ? 'column' : 'row'}>
        <Story />
      </div>
    </NextIntlClientProvider>
  );
};

const preview: Preview = {
  decorators: [withLanguageAndTheme],
  globalTypes: {
    locale: {
      description: 'Language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Español' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      description: 'Colour scheme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: 'en', theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    controls: { expanded: true },
  },
};

export default preview;
