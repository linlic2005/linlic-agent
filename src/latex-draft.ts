import { access, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";

export interface LatexProjectFile {
	path: string;
	content: string;
}

export interface LatexMacro {
	name: string;
	argCount: number;
	replacement: string;
}

export interface LatexFormulaBlock {
	environment: string;
	label?: string;
	text: string;
	startChar: number;
	endChar: number;
	sectionHeading?: string;
}

export interface LatexFloatBlock {
	kind: "figure" | "table";
	label?: string;
	caption?: string;
	graphics: string[];
	text: string;
	startChar: number;
	endChar: number;
	sectionHeading?: string;
}

export interface LatexAppendixSection {
	heading: string;
	text: string;
	startChar: number;
	endChar: number;
}

export interface LatexDraftAnalysis {
	entryFile: string;
	files: LatexProjectFile[];
	combinedContent: string;
	expandedContent: string;
	macros: LatexMacro[];
	formulas: LatexFormulaBlock[];
	figures: LatexFloatBlock[];
	tables: LatexFloatBlock[];
	appendixSections: LatexAppendixSection[];
	citations: string[];
	labels: string[];
	refs: string[];
	warnings: string[];
}

const knownLatexCommands = new Set([
	"abstract",
	"appendix",
	"author",
	"begin",
	"caption",
	"centering",
	"cite",
	"citep",
	"citet",
	"documentclass",
	"emph",
	"end",
	"eqref",
	"frac",
	"hline",
	"include",
	"includegraphics",
	"input",
	"item",
	"label",
	"mathcal",
	"newcommand",
	"paragraph",
	"ref",
	"renewcommand",
	"section",
	"subsection",
	"subsubsection",
	"table",
	"textbf",
	"textit",
	"title",
	"usepackage",
]);

function isEscapedPercent(line: string, index: number): boolean {
	let backslashCount = 0;
	for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) {
		backslashCount++;
	}
	return backslashCount % 2 === 1;
}

export function stripLatexComments(content: string): string {
	return content
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => {
			for (let index = 0; index < line.length; index++) {
				if (line[index] === "%" && !isEscapedPercent(line, index)) return line.slice(0, index);
			}
			return line;
		})
		.join("\n");
}

function normalizeTexPath(baseDir: string, rawPath: string): string {
	const trimmed = rawPath.trim();
	const withExtension = extname(trimmed) ? trimmed : `${trimmed}.tex`;
	return isAbsolute(withExtension) ? withExtension : resolve(baseDir, withExtension);
}

async function fileExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

async function loadLatexFile(
	filePath: string,
	files: LatexProjectFile[],
	warnings: string[],
	visited: Set<string>,
	depth: number,
): Promise<string> {
	if (depth > 20) {
		warnings.push(`LaTeX 子文件递归层级过深，已停止展开：${filePath}`);
		return "";
	}
	if (visited.has(filePath)) {
		warnings.push(`检测到重复或循环引用的 LaTeX 子文件，已跳过：${filePath}`);
		return "";
	}
	if (!(await fileExists(filePath))) {
		warnings.push(`无法解析 LaTeX 子文件：${filePath}`);
		return "";
	}

	visited.add(filePath);
	const rawContent = await readFile(filePath, "utf8");
	const content = stripLatexComments(rawContent);
	files.push({ path: filePath, content });

	const includePattern = /\\(?:input|include)\s*\{([^}]+)\}/gi;
	let expanded = "";
	let cursor = 0;
	for (const match of content.matchAll(includePattern)) {
		const index = match.index ?? 0;
		expanded += content.slice(cursor, index);
		const includePath = normalizeTexPath(dirname(filePath), match[1] ?? "");
		const included = await loadLatexFile(includePath, files, warnings, visited, depth + 1);
		expanded += `\n${included}\n`;
		cursor = index + match[0].length;
	}
	expanded += content.slice(cursor);
	return expanded;
}

function extractBalancedBraced(text: string, startIndex: number): { value: string; endIndex: number } | undefined {
	if (text[startIndex] !== "{") return undefined;
	let depth = 0;
	for (let index = startIndex; index < text.length; index++) {
		const char = text[index];
		if (char === "{" && text[index - 1] !== "\\") depth++;
		if (char === "}" && text[index - 1] !== "\\") {
			depth--;
			if (depth === 0) return { value: text.slice(startIndex + 1, index), endIndex: index + 1 };
		}
	}
	return undefined;
}

function extractMacros(content: string): LatexMacro[] {
	const macros: LatexMacro[] = [];
	const commandPattern = /\\(?:newcommand|renewcommand|providecommand)\s*\{\\([A-Za-z]+)\}\s*(?:\[(\d+)])?\s*/g;
	for (const match of content.matchAll(commandPattern)) {
		const bodyStart = (match.index ?? 0) + match[0].length;
		const body = extractBalancedBraced(content, bodyStart);
		if (!body) continue;
		macros.push({
			name: match[1] ?? "",
			argCount: Number.parseInt(match[2] ?? "0", 10),
			replacement: body.value,
		});
	}

	for (const match of content.matchAll(/\\def\\([A-Za-z]+)(#[1-9])?\s*/g)) {
		const bodyStart = (match.index ?? 0) + match[0].length;
		const body = extractBalancedBraced(content, bodyStart);
		if (!body) continue;
		macros.push({
			name: match[1] ?? "",
			argCount: match[2] ? 1 : 0,
			replacement: body.value,
		});
	}

	return macros.filter((macro) => macro.name);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandMacros(content: string, macros: LatexMacro[]): string {
	let expanded = content;
	for (const macro of macros) {
		if (macro.argCount === 0) {
			expanded = expanded.replace(
				new RegExp(`\\\\${escapeRegExp(macro.name)}\\s*(?:\\{\\})?`, "g"),
				macro.replacement,
			);
			continue;
		}
		if (macro.argCount === 1) {
			expanded = expanded.replace(
				new RegExp(`\\\\${escapeRegExp(macro.name)}\\s*\\{([^{}]*)\\}`, "g"),
				(_match, arg) => macro.replacement.replace(/#1/g, String(arg)),
			);
		}
	}
	return expanded;
}

function extractFirstCommandArg(text: string, command: string): string | undefined {
	const pattern = new RegExp(`\\\\${command}(?:\\[[^\\]]*])?\\s*\\{`, "i");
	const match = text.match(pattern);
	if (!match?.index) {
		if (match?.index !== 0) return undefined;
	}
	const start = (match.index ?? 0) + match[0].length - 1;
	return extractBalancedBraced(text, start)?.value.trim();
}

function extractAllCommandArgs(text: string, commandPattern: string): string[] {
	const args: string[] = [];
	const pattern = new RegExp(`\\\\(?:${commandPattern})(?:\\[[^\\]]*])?\\s*\\{`, "gi");
	for (const match of text.matchAll(pattern)) {
		const start = (match.index ?? 0) + match[0].length - 1;
		const body = extractBalancedBraced(text, start);
		if (body?.value.trim()) args.push(body.value.trim());
	}
	return args;
}

function cleanLatexInline(text: string): string {
	return text
		.replace(/\\[A-Za-z]+\*?(?:\[[^\]]*])?\s*\{([^{}]*)\}/g, "$1")
		.replace(/\\[A-Za-z]+\*?/g, "")
		.replace(/[{}]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function nearestSectionHeading(content: string, index: number): string | undefined {
	const before = content.slice(0, index);
	const matches = Array.from(before.matchAll(/\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}/gi));
	return matches.at(-1)?.[1]?.trim();
}

function extractFormulas(content: string): LatexFormulaBlock[] {
	const formulas: LatexFormulaBlock[] = [];
	const envPattern = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}([\s\S]*?)\\end\{\1\}/gi;
	for (const match of content.matchAll(envPattern)) {
		const startChar = match.index ?? 0;
		const text = match[2] ?? "";
		formulas.push({
			environment: match[1] ?? "equation",
			label: extractFirstCommandArg(text, "label"),
			text: text.trim(),
			startChar,
			endChar: startChar + match[0].length,
			sectionHeading: nearestSectionHeading(content, startChar),
		});
	}

	for (const match of content.matchAll(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g)) {
		const startChar = match.index ?? 0;
		const text = match[1] ?? match[2] ?? "";
		formulas.push({
			environment: match[1] ? "displaymath" : "$$",
			label: extractFirstCommandArg(text, "label"),
			text: text.trim(),
			startChar,
			endChar: startChar + match[0].length,
			sectionHeading: nearestSectionHeading(content, startChar),
		});
	}

	return formulas.sort((a, b) => a.startChar - b.startChar);
}

function extractFloats(content: string, kind: "figure" | "table"): LatexFloatBlock[] {
	const envPattern = new RegExp(`\\\\begin\\{(${kind}\\*?)\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, "gi");
	const blocks: LatexFloatBlock[] = [];
	for (const match of content.matchAll(envPattern)) {
		const startChar = match.index ?? 0;
		const text = match[2] ?? "";
		const graphics = kind === "figure" ? extractAllCommandArgs(text, "includegraphics") : [];
		blocks.push({
			kind,
			label: extractFirstCommandArg(text, "label"),
			caption: cleanLatexInline(extractFirstCommandArg(text, "caption") ?? ""),
			graphics,
			text: text.trim(),
			startChar,
			endChar: startChar + match[0].length,
			sectionHeading: nearestSectionHeading(content, startChar),
		});
	}
	return blocks;
}

function extractAppendixSections(content: string): LatexAppendixSection[] {
	const appendixIndex = content.search(/\\appendix\b/i);
	if (appendixIndex < 0) return [];
	const appendixContent = content.slice(appendixIndex);
	const matches = Array.from(appendixContent.matchAll(/\\(?:section|subsection)\*?\{([^}]*)\}/gi));
	return matches.map((match, index) => {
		const start = appendixIndex + (match.index ?? 0);
		const next = matches[index + 1]?.index;
		const end = next === undefined ? content.length : appendixIndex + next;
		return {
			heading: match[1]?.trim() ?? "未命名附录章节",
			text: latexToPlainText(content.slice(start, end)),
			startChar: start,
			endChar: end,
		};
	});
}

function uniqueCommandValues(content: string, commandPattern: string): string[] {
	return Array.from(
		new Set(
			extractAllCommandArgs(content, commandPattern)
				.flatMap((value) => value.split(","))
				.map((value) => value.trim())
				.filter(Boolean),
		),
	);
}

function buildWarnings(content: string, macros: LatexMacro[], existingWarnings: string[]): string[] {
	const warnings = [...existingWarnings];
	const macroNames = new Set(macros.map((macro) => macro.name));
	const unknownCommands = Array.from(content.matchAll(/\\([A-Za-z]{3,})\b/g))
		.map((match) => match[1] ?? "")
		.filter((command) => command && !knownLatexCommands.has(command) && !macroNames.has(command));
	const uniqueUnknown = Array.from(new Set(unknownCommands)).slice(0, 12);
	if (uniqueUnknown.length > 0) {
		warnings.push(`存在未完全语义解析的 LaTeX 命令或宏：${uniqueUnknown.join(", ")}`);
	}
	return Array.from(new Set(warnings));
}

export function latexToPlainText(text: string): string {
	return stripLatexComments(text)
		.replace(/\\cite\w*\{([^}]+)\}/g, "[$1]")
		.replace(/\\(?:autoref|cref|Cref|ref|eqref)\{([^}]+)\}/g, "$1")
		.replace(/\\label\{[^}]+}/g, "")
		.replace(/\\caption(?:\[[^\]]*])?\{([^}]*)\}/g, "Caption: $1")
		.replace(/\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}/g, "\n$1\n")
		.replace(/\\begin\{[^}]+}|\s*\\end\{[^}]+}/g, "\n")
		.replace(/\\[A-Za-z]+\*?(?:\[[^\]]*])?\s*\{([^{}]*)\}/g, "$1")
		.replace(/\\[A-Za-z]+\*?/g, "")
		.replace(/[{}]/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export async function parseLatexDraftProject(entryFile: string): Promise<LatexDraftAnalysis> {
	const resolvedEntry = resolve(entryFile);
	const files: LatexProjectFile[] = [];
	const warnings: string[] = [];
	const combinedContent = await loadLatexFile(resolvedEntry, files, warnings, new Set(), 0);
	const macros = extractMacros(combinedContent);
	const expandedContent = expandMacros(combinedContent, macros);

	return {
		entryFile: resolvedEntry,
		files,
		combinedContent,
		expandedContent,
		macros,
		formulas: extractFormulas(expandedContent),
		figures: extractFloats(expandedContent, "figure"),
		tables: extractFloats(expandedContent, "table"),
		appendixSections: extractAppendixSections(expandedContent),
		citations: uniqueCommandValues(expandedContent, "cite\\w*"),
		labels: uniqueCommandValues(expandedContent, "label"),
		refs: uniqueCommandValues(expandedContent, "autoref|cref|Cref|ref|eqref"),
		warnings: buildWarnings(expandedContent, macros, warnings),
	};
}
