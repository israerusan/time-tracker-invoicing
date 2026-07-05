import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * Runs the SAME ruleset as Obsidian's automated community-plugin review
 * (eslint-plugin-obsidianmd) so review failures are caught locally before a release.
 * `npm run lint` is a hard gate (`--max-warnings 0`); a warning can still block review.
 */
export default tseslint.config(
	{
		ignores: [
			"main.js",
			"node_modules/**",
			"tests/**",
			"scripts/**",
			"esbuild.config.mjs",
			"version-bump.mjs",
			"eslint.config.mjs",
			"src/**/*.mjs",
			"src/**/*.d.mts",
		],
	},
	// The Obsidian review bot's ruleset: manifest validation, settings-tab headings,
	// static-style assignment, forbidden elements, sentence-case, command naming, etc.
	// (It already brings typescript-eslint's non-type-checked base rules.)
	...obsidianmd.configs.recommended,
	// Enable type-aware parsing on the plugin source (the obsidianmd recommended set
	// ships with type-checked linting disabled). Scoped to src/**/*.ts so the JS/JSON
	// config files above are never parsed with type info.
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// `ui/sentence-case` with enforceCamelCaseLower fires on our product name
			// ("Time Tracker") and proper nouns (Premium) — lowercasing them would be
			// wrong, and the actual review does not flag these strings. Setting NAMES
			// are already sentence case.
			"obsidianmd/ui/sentence-case": "off",
			// Advises the declarative settings API added in Obsidian 1.13.0; this plugin
			// targets minAppVersion 1.5.0 and uses the classic display() settings tab.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			// Flagged spots use Obsidian's own createEl/createDiv helpers on real elements;
			// the suggested rewrites aren't typed in the current obsidian d.ts and our
			// usage is safe. Keep the readable createEl calls.
			"obsidianmd/prefer-create-el": "off",
		},
	}
);
