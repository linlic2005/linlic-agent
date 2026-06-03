import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaperSearchPaper } from "./paper-search.ts";
import { createSafeReportSlug } from "./report-writer.ts";
import { ensureResearchWorkspace, researchWorkspaceName } from "./workspace.ts";

export interface ZoteroHttpResponseLike {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

export type ZoteroFetchLike = (
	url: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<ZoteroHttpResponseLike>;

export interface ZoteroConfig {
	apiKey?: string;
	userId?: string;
	groupId?: string;
	baseUrl?: string;
}

export interface ZoteroItem {
	key: string;
	itemType?: string;
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	doi?: string;
	url?: string;
	abstract?: string;
	raw?: unknown;
}

export interface ZoteroSearchResult {
	configured: boolean;
	query: string;
	libraryType?: "user" | "group";
	items: ZoteroItem[];
	warnings: string[];
	markdown: string;
}

export interface SearchZoteroLibraryOptions {
	query: string;
	limit?: number;
	config?: ZoteroConfig;
	fetcher?: ZoteroFetchLike;
	signal?: AbortSignal;
	logger?: { warn(message: string): void };
}

export interface BibtexPaperLike {
	title: string;
	authors?: string[];
	year?: number;
	venue?: string;
	doi?: string;
	url?: string;
	abstract?: string;
}

export interface ExportPapersToBibtexOptions {
	cwd: string;
	title: string;
	papers: BibtexPaperLike[];
	timestamp?: Date;
}

export interface ExportPapersToBibtexResult {
	absolutePath: string;
	relativePath: string;
	content: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const ZOTERO_API_VERSION = "3";
const ZOTERO_BASE_URL = "https://api.zotero.org";

function clampLimit(limit: number | undefined): number {
	if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readZoteroConfig(config: ZoteroConfig | undefined): Required<Pick<ZoteroConfig, "baseUrl">> & ZoteroConfig {
	return {
		apiKey: config?.apiKey ?? process.env.ZOTERO_API_KEY,
		userId: config?.userId ?? process.env.ZOTERO_USER_ID,
		groupId: config?.groupId ?? process.env.ZOTERO_GROUP_ID,
		baseUrl: config?.baseUrl ?? ZOTERO_BASE_URL,
	};
}

async function defaultFetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) {
	return fetch(url, init);
}

function buildMissingConfigWarning(config: ZoteroConfig): string | undefined {
	if (!config.apiKey) return "Zotero 未配置：缺少 ZOTERO_API_KEY，已跳过用户文献库检索。";
	if (!config.userId && !config.groupId) {
		return "Zotero 未配置：缺少 ZOTERO_USER_ID 或 ZOTERO_GROUP_ID，已跳过用户文献库检索。";
	}
	return undefined;
}

function buildZoteroItemsUrl(
	config: Required<Pick<ZoteroConfig, "baseUrl">> & ZoteroConfig,
	query: string,
	limit: number,
): { url: string; libraryType: "user" | "group" } {
	const libraryType: "user" | "group" = config.groupId ? "group" : "user";
	const libraryId = config.groupId ?? config.userId;
	const url = new URL(`${config.baseUrl}/${libraryType === "group" ? "groups" : "users"}/${libraryId}/items`);
	url.search = new URLSearchParams({
		q: query,
		qmode: "titleCreatorYear",
		limit: String(limit),
		format: "json",
	}).toString();
	return { url: url.toString(), libraryType };
}

function normalizeCreators(creators: unknown): string[] {
	if (!Array.isArray(creators)) return [];
	return creators
		.map((creator) => {
			const record = asRecord(creator);
			const name = asString(record?.name);
			if (name) return name;
			const firstName = asString(record?.firstName);
			const lastName = asString(record?.lastName);
			return [firstName, lastName].filter(Boolean).join(" ").trim();
		})
		.filter(Boolean)
		.slice(0, 12);
}

function extractYear(date: unknown): number | undefined {
	const direct = asNumber(date);
	if (direct) return direct;
	const text = asString(date);
	const match = text?.match(/\b((?:19|20)\d{2})\b/u);
	return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function normalizeDoi(doi: string | undefined): string | undefined {
	if (!doi) return undefined;
	const normalized = doi
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.toLowerCase();
	return normalized || undefined;
}

function mapZoteroItem(value: unknown): ZoteroItem | undefined {
	const record = asRecord(value);
	const data = asRecord(record?.data);
	const title = asString(data?.title);
	const key = asString(record?.key) ?? asString(data?.key);
	if (!title || !key) return undefined;
	const venue =
		asString(data?.publicationTitle) ??
		asString(data?.conferenceName) ??
		asString(data?.proceedingsTitle) ??
		asString(data?.bookTitle) ??
		asString(data?.websiteTitle) ??
		asString(data?.university);

	return {
		key,
		itemType: asString(data?.itemType),
		title,
		authors: normalizeCreators(data?.creators),
		year: extractYear(data?.date),
		venue,
		doi: normalizeDoi(asString(data?.DOI)),
		url: asString(data?.url),
		abstract: asString(data?.abstractNote),
		raw: value,
	};
}

function buildZoteroMarkdown(result: Omit<ZoteroSearchResult, "markdown">): string {
	const lines = ["# Zotero 文献库检索结果", "", `检索式：${result.query}`, ""];
	if (!result.configured) {
		lines.push("Zotero 未配置，已跳过用户文献库检索。", "");
	}
	if (result.warnings.length > 0) {
		lines.push("## 警告", "", ...result.warnings.map((warning) => `- ${warning}`), "");
	}
	lines.push("## 命中文献", "");
	if (result.items.length === 0) {
		lines.push("未在 Zotero 文献库中检索到匹配条目。");
	} else {
		for (const [index, item] of result.items.entries()) {
			lines.push(
				`### ${index + 1}. ${item.title}`,
				"",
				`- 作者：${item.authors.length > 0 ? item.authors.join(", ") : "未知"}`,
				`- 年份：${item.year ?? "未知"}`,
				`- venue：${item.venue ?? "未知"}`,
				`- DOI：${item.doi ?? "未知"}`,
				`- URL：${item.url ?? "未知"}`,
				"",
			);
		}
	}
	return lines.join("\n");
}

export async function searchZoteroLibrary(options: SearchZoteroLibraryOptions): Promise<ZoteroSearchResult> {
	const query = options.query.trim();
	const config = readZoteroConfig(options.config);
	const warnings: string[] = [];
	const missingConfigWarning = buildMissingConfigWarning(config);
	if (missingConfigWarning) {
		warnings.push(missingConfigWarning);
		const resultWithoutMarkdown = { configured: false, query, items: [], warnings };
		return { ...resultWithoutMarkdown, markdown: buildZoteroMarkdown(resultWithoutMarkdown) };
	}

	const limit = clampLimit(options.limit);
	const fetcher = options.fetcher ?? defaultFetch;
	const { url, libraryType } = buildZoteroItemsUrl(config, query, limit);

	try {
		const response = await fetcher(url, {
			signal: options.signal,
			headers: {
				"Zotero-API-Key": config.apiKey ?? "",
				"Zotero-API-Version": ZOTERO_API_VERSION,
			},
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Zotero Web API 返回 HTTP ${response.status}${body ? `：${body.slice(0, 200)}` : ""}`);
		}

		const payload = await response.json();
		const items = Array.isArray(payload)
			? payload.map(mapZoteroItem).filter((item): item is ZoteroItem => Boolean(item))
			: [];
		const resultWithoutMarkdown = {
			configured: true,
			query,
			libraryType,
			items,
			warnings,
		};
		return { ...resultWithoutMarkdown, markdown: buildZoteroMarkdown(resultWithoutMarkdown) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const warning = `Zotero 文献库检索失败，已继续执行其他流程：${message}`;
		warnings.push(warning);
		options.logger?.warn(warning);
		const resultWithoutMarkdown = {
			configured: true,
			query,
			libraryType,
			items: [],
			warnings,
		};
		return { ...resultWithoutMarkdown, markdown: buildZoteroMarkdown(resultWithoutMarkdown) };
	}
}

function formatTimestamp(date: Date): string {
	const year = String(date.getUTCFullYear()).padStart(4, "0");
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const second = String(date.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}-${hour}${minute}${second}`;
}

function normalizeBibtexText(value: string): string {
	return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function bibtexEscape(value: string): string {
	return normalizeBibtexText(value).replace(/\\/g, "\\textbackslash{}").replace(/&/g, "\\&");
}

function firstAuthorLastName(authors: string[] | undefined): string {
	const first = authors?.[0]?.trim();
	if (!first) return "paper";
	const parts = first.split(/\s+/u);
	return (
		parts
			.at(-1)
			?.replace(/[^\p{L}\p{N}]+/gu, "")
			.toLowerCase() || "paper"
	);
}

function firstTitleWord(title: string): string {
	return (
		title
			.normalize("NFKC")
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.find((word) => word.length >= 4) ?? "work"
	);
}

function buildBibtexKey(paper: BibtexPaperLike, usedKeys: Set<string>): string {
	const base = `${firstAuthorLastName(paper.authors)}${paper.year ?? "nd"}${firstTitleWord(paper.title)}`;
	let key = base;
	let index = 2;
	while (usedKeys.has(key)) {
		key = `${base}${index}`;
		index++;
	}
	usedKeys.add(key);
	return key;
}

function buildBibtexEntry(paper: BibtexPaperLike, usedKeys: Set<string>): string {
	const key = buildBibtexKey(paper, usedKeys);
	const fields = [
		["title", paper.title],
		["author", paper.authors?.join(" and ")],
		["year", paper.year ? String(paper.year) : undefined],
		["journal", paper.venue],
		["doi", paper.doi],
		["url", paper.url],
		["abstract", paper.abstract],
	].filter((field): field is [string, string] => Boolean(field[1]));

	return [`@article{${key},`, ...fields.map(([name, value]) => `  ${name} = {${bibtexEscape(value)}},`), "}"].join(
		"\n",
	);
}

export function buildBibtexForPapers(papers: BibtexPaperLike[]): string {
	const usedKeys = new Set<string>();
	return `${papers.map((paper) => buildBibtexEntry(paper, usedKeys)).join("\n\n")}\n`;
}

export function paperSearchToBibtexPaper(paper: PaperSearchPaper): BibtexPaperLike {
	return {
		title: paper.title,
		authors: paper.authors,
		year: paper.year,
		venue: paper.venue,
		doi: paper.doi,
		url: paper.url,
		abstract: paper.abstract,
	};
}

export async function exportPapersToBibtex(options: ExportPapersToBibtexOptions): Promise<ExportPapersToBibtexResult> {
	const workspace = await ensureResearchWorkspace(options.cwd);
	const slug = createSafeReportSlug(options.title);
	const timestamp = formatTimestamp(options.timestamp ?? new Date());
	const filename = `${slug}-${timestamp}.bib`;
	const absolutePath = join(workspace.directories.notes, filename);
	const relativePath = join(researchWorkspaceName, "notes", filename);
	const content = buildBibtexForPapers(options.papers);

	await writeFile(absolutePath, content, "utf8");
	return { absolutePath, relativePath, content };
}
