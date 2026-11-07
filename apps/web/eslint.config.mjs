// ESLint (flat config): Next.js rules, React Hooks, jsx-a11y, and the dependency direction between layers (D-132, D-138, D-140).
import { FlatCompat } from '@eslint/eslintrc';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: dirname });

// One zone per layer: `target` must not import `from`. domain <- application <- adapters and app (D-138);
// app -> screens -> ui/patterns -> ui/primitives, and a tier never imports the tier above it (D-140).
const layers = (...names) => names.map((n) => `./src/${n}`);
const forbid = (target, from, message) => ({ target: `./src/${target}`, from: layers(...from), message });
const zones = [
  forbid(
    'domain',
    ['application', 'ports', 'adapters', 'app', 'ui', 'screens', 'queries', 'i18n', 'styles'],
    'domain imports only domain and @smart-finances/contracts (D-138).',
  ),
  forbid('application', ['adapters', 'app', 'ui', 'screens', 'queries', 'i18n', 'styles'], 'application imports only domain and ports (D-138).'),
  forbid('ports', ['adapters', 'app', 'ui', 'screens', 'queries'], 'ports describe what adapters provide; they never import them (D-138).'),
  forbid('ui', ['screens', 'queries', 'application', 'adapters'], 'ui never imports screens, queries, application or adapters (D-138, D-140).'),
  forbid('ui/primitives', ['ui/patterns', 'screens'], 'primitives import nothing from patterns or screens (D-140).'),
  forbid('ui/patterns', ['screens'], 'patterns import nothing from screens (D-140).'),
  forbid('screens', ['adapters', 'application'], 'screens receive data or call actions; they never import adapters or application (D-138).'),
  forbid('queries', ['adapters', 'application'], 'queries call /api/data/*; they never import adapters or application (D-138).'),
];

const frameworks = ['next', 'next/*', 'react', 'react-dom', 'react-dom/*', '@aws-sdk/*', '@tanstack/*'];

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'design/**',
      'fixtures/**',
      'playwright-report/**',
      'test-results/**',
      'storybook-static/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { rules: { ...jsxA11y.flatConfigs.recommended.rules } },
  { files: ['src/**/*.{ts,tsx}'], rules: { 'import/no-restricted-paths': ['error', { basePath: dirname, zones }] } },
  {
    files: ['src/domain/**/*.{ts,tsx}', 'src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: frameworks, message: 'Domain and application code stays free of frameworks and SDKs (D-138).' }],
        },
      ],
    },
  },
];

export default config;
