import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    languageOptions: {
      globals: {
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        console: "readonly",
        HTMLAudioElement: "readonly",
        HTMLCanvasElement: "readonly",
        HTMLElement: "readonly",
        Audio: "readonly",
        document: "readonly",
        window: "readonly",
        sessionStorage: "readonly",
      },
    },
    rules: {
      // Allow inline multi-attribute templates (our style)
      "vue/max-attributes-per-line": "off",
      // Allow single-line element content
      "vue/singleline-html-element-content-newline": "off",
      // Ant Design uses camelCase v-model modifiers
      "vue/attribute-hyphenation": "off",
      // Allow multi-word component names (views like SetupView are fine)
      "vue/multi-word-component-names": "off",
      // Allow v-html when needed
      "vue/no-v-html": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        jest: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        test: "readonly",
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/", ".pnp.cjs", ".pnp.loader.mjs", ".yarn/"],
  },
];
