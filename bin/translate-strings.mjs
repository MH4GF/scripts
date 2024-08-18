#!/usr/bin/env zx

import OpenAI from "openai";
import jscodeshift from "jscodeshift";

const argv = minimist(process.argv.slice(2), {
	boolean: ["dry-run"],
	alias: { d: "dry-run" },
});

async function translateToEnglish(text, isDryRun = false, fileName = "") {
	if (isDryRun) {
		console.log(`File: ${fileName}, Would translate: "${text}"`);
		return `[DRYRUN] Would translate: "${text}"`;
	}

	const openai = new OpenAI();
	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content:
						"You are a translator. Translate the given Japanese text to English.",
				},
				{ role: "user", content: text },
			],
		});
		return response.choices[0].message.content.trim();
	} catch (error) {
		console.error(
			`Translation failed for text: "${text}" in file: "${fileName}"`,
			error,
		);
		return text; // fallback to original text on failure
	}
}

function containsJapanese(text) {
	return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(
		text,
	);
}

async function transform(fileInfo, api, options) {
	const j = api.jscodeshift;
	const { dryRun } = options;
	const filePath = fileInfo.path;

	try {
		const root = j(fileInfo.source, {
			tsx: true,
			jsx: true,
			tolerant: true,
			allowImportExportEverywhere: true,
			allowAwaitOutsideFunction: true,
		});

		const translationPromises = [];

		for (const path of root.find(j.StringLiteral).paths()) {
			if (containsJapanese(path.node.value)) {
				translationPromises.push(
					translateToEnglish(path.node.value, dryRun, filePath).then(
						(translatedText) => {
							j(path).replaceWith(j.stringLiteral(translatedText));
						},
					),
				);
			}
		}

		for (const path of root.find(j.JSXText).paths()) {
			const text = path.node.value.trim();
			if (containsJapanese(text)) {
				translationPromises.push(
					translateToEnglish(text, dryRun, filePath).then((translatedText) => {
						j(path).replaceWith(j.jsxText(` ${translatedText} `));
					}),
				);
			}
		}

		for (const path of root.find(j.Comment).paths()) {
			const commentText = path.value.value.trim();
			if (containsJapanese(commentText)) {
				translationPromises.push(
					translateToEnglish(commentText, dryRun, filePath).then(
						(translatedText) => {
							path.value.value = ` ${translatedText} `;
						},
					),
				);
			}
		}

		await Promise.all(translationPromises);
		return root.toSource();
	} catch (error) {
		console.error(`Failed to process ${filePath}: ${error.message}`);
		return fileInfo.source; // return original source on failure
	}
}

async function processFile(file, options) {
	try {
		const source = await fs.readFile(file, "utf8");
		const fileInfo = { path: file, source };
		const api = {
			jscodeshift: jscodeshift.withParser(
				file.endsWith(".ts") || file.endsWith(".tsx") ? "tsx" : undefined,
			),
		};

		const output = await transform(fileInfo, api, options);

		if (!options.dryRun) {
			await fs.writeFile(file, output);
			console.log(`Processed ${file}`);
		}
	} catch (error) {
		console.error(`Error processing ${file}:`, error);
		console.log(`Skipped ${file} due to error`);
	}
}

async function main() {
	const isDryRun = argv["dry-run"];
	const paths = argv._.length > 1 ? argv._.slice(1) : [process.cwd()];

	for (const p of paths) {
		const files = await glob(`${p}/**/*.{js,jsx,ts,tsx}`);
		for (const file of files) {
			await processFile(file, { dryRun: isDryRun });
		}
	}
}

main().catch(console.error);
