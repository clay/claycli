'use strict';

const globals = require('globals');
const tseslint = require('typescript-eslint');

// Shared rules for both JS and TS files
const sharedRules = {
  // possible errors
  'no-extra-parens': 1,
  // best practices
  complexity: [2, 8],
  'default-case': 2,
  'guard-for-in': 2,
  'no-alert': 1,
  'no-floating-decimal': 1,
  'no-self-compare': 2,
  'no-throw-literal': 2,
  'no-void': 2,
  'quote-props': [2, 'as-needed'],
  'wrap-iife': 2,
  // variables
  'no-undef': 2,
  'no-unused-vars': [2,
    {
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_'
    }
  ],
  // node.js
  'handle-callback-err': [2, '^.*(e|E)rr'],
  'no-mixed-requires': 0,
  'no-new-require': 2,
  'no-path-concat': 2,
  // stylistic issues
  'brace-style': [2, '1tbs', { allowSingleLine: true }],
  'comma-style': [2, 'last'],
  indent: [2, 2, { SwitchCase: 1 }],
  'max-nested-callbacks': [2, 4],
  'no-nested-ternary': 2,
  'no-trailing-spaces': 2,
  'no-underscore-dangle': 0,
  'no-unneeded-ternary': 1,
  'one-var': 0,
  quotes: [2, 'single', 'avoid-escape'],
  semi: [2, 'always'],
  'keyword-spacing': 2,
  'space-before-blocks': [2, 'always'],
  'space-before-function-paren': [2, { anonymous: 'always', named: 'never' }],
  'space-infix-ops': [1, { int32Hint: false }],
  'spaced-comment': [2, 'always'],
  // legacy jshint rules
  'max-depth': [2, 4],
  'max-params': [2, 4]
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'website/**',
      'lib/gulp-plugins/gulp-newer/**'
    ]
  },
  // JavaScript files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs,
        ...globals.jest,
        // legacy globals from old config
        expect: false,
        chai: false,
        sinon: false
      }
    },
    rules: {
      ...sharedRules,
      'vars-on-top': 2,
      strict: [2, 'safe']
    }
  },
  // TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      parser: tseslint.parser,
      parserOptions: {
        projectService: true
      },
      globals: {
        ...globals.node,
        ...globals.commonjs,
        ...globals.jest
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      ...sharedRules,
      // Override base rules with TS-aware equivalents
      'no-unused-vars': 0,
      '@typescript-eslint/no-unused-vars': [2,
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  // Browser globals for client-side code
  {
    files: ['lib/cmd/compile/_client-init.js', 'lib/cmd/pack/mount-component-modules.js'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  }
];
