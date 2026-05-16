import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maybeAutoSyncBackupMock = vi.hoisted(() => vi.fn());
const syncDirectMessagesViaCachedBirdMock = vi.hoisted(() => vi.fn());
const syncMentionThreadsMock = vi.hoisted(() => vi.fn());
const syncMentionsMock = vi.hoisted(() => vi.fn());
const syncTimelineCollectionMock = vi.hoisted(() => vi.fn());
const syncHomeTimelineMock = vi.hoisted(() => vi.fn());

vi.mock("./backup", () => ({
	maybeAutoSyncBackup: (...args: unknown[]) => maybeAutoSyncBackupMock(...args),
}));

vi.mock("./dms-live", () => ({
	syncDirectMessagesViaCachedBird: (...args: unknown[]) =>
		syncDirectMessagesViaCachedBirdMock(...args),
}));

vi.mock("./mention-threads-live", () => ({
	syncMentionThreads: (...args: unknown[]) => syncMentionThreadsMock(...args),
}));

vi.mock("./mentions-live", () => ({
	syncMentions: (...args: unknown[]) => syncMentionsMock(...args),
}));

vi.mock("./timeline-collections-live", () => ({
	syncTimelineCollection: (...args: unknown[]) =>
		syncTimelineCollectionMock(...args),
}));

vi.mock("./timeline-live", () => ({
	syncHomeTimeline: (...args: unknown[]) => syncHomeTimelineMock(...args),
}));

import {
	buildAccountSyncLaunchAgentPlist,
	installAccountSyncLaunchAgent,
	parseAccountSyncSteps,
	runAccountSyncJob,
} from "./account-sync-job";

describe("account sync job", () => {
	let tempDir: string | undefined;

	beforeEach(() => {
		maybeAutoSyncBackupMock.mockReset();
		syncDirectMessagesViaCachedBirdMock.mockReset();
		syncMentionThreadsMock.mockReset();
		syncMentionsMock.mockReset();
		syncTimelineCollectionMock.mockReset();
		syncHomeTimelineMock.mockReset();
		maybeAutoSyncBackupMock.mockResolvedValue({
			ok: true,
			enabled: false,
			skipped: true,
		});
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	it("parses comma-separated step lists", () => {
		expect(parseAccountSyncSteps("timeline,mentions,dms")).toEqual([
			"timeline",
			"mentions",
			"dms",
		]);
		expect(() => parseAccountSyncSteps("timeline,unknown")).toThrow(
			"--steps must contain",
		);
	});

	it("builds an account-scoped launchd command", () => {
		const agent = buildAccountSyncLaunchAgentPlist({
			account: "acct_openclaw",
			program: "/opt/homebrew/bin/birdclaw",
			steps: ["timeline", "mentions", "dms"],
			allowBirdAccount: true,
			envFile: "~/.config/bird/openclaw.env",
		});

		expect(agent.programArguments).toEqual([
			"/bin/bash",
			"-lc",
			expect.stringContaining("'--account' 'acct_openclaw'"),
		]);
		expect(agent.programArguments[2]).toContain(
			"'--steps' 'timeline,mentions,dms'",
		);
		expect(agent.programArguments[2]).toContain("'--allow-bird-account'");
		expect(agent.plist).toContain("com.steipete.birdclaw.account-sync");
	});

	it("installs without loading when requested", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-account-job-"));
		const result = await installAccountSyncLaunchAgent({
			account: "acct_openclaw",
			launchAgentsDir: tempDir,
			load: false,
			program: "/opt/homebrew/bin/birdclaw",
		});

		expect(result.loaded).toBe(false);
		expect(result.plistPath).toBe(
			path.join(tempDir, "com.steipete.birdclaw.account-sync.plist"),
		);
		expect(result.programArguments).toContain("--account");
		expect(result.programArguments).toContain("acct_openclaw");
	});

	it("writes an audit entry when backup sync fails", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-account-job-"));
		const logPath = path.join(tempDir, "audit.jsonl");
		const lockPath = path.join(tempDir, "sync.lock");
		syncMentionsMock.mockResolvedValue({
			ok: true,
			source: "bird",
			count: 3,
		});
		maybeAutoSyncBackupMock.mockRejectedValue(new Error("backup failed"));

		const result = await runAccountSyncJob({
			steps: ["mentions"],
			logPath,
			lockPath,
			db: {} as never,
		});

		expect(result).toMatchObject({
			ok: false,
			error: "backup failed",
			steps: [{ kind: "mentions", ok: true, count: 3, source: "bird" }],
		});
		const entry = JSON.parse(readFileSync(logPath, "utf8").trim()) as unknown;
		expect(entry).toMatchObject({
			ok: false,
			error: "backup failed",
			steps: [{ kind: "mentions", ok: true, count: 3, source: "bird" }],
		});
	});

	it("refuses Bird-backed non-default account sync without an assertion", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-account-job-"));
		const logPath = path.join(tempDir, "audit.jsonl");
		const lockPath = path.join(tempDir, "sync.lock");
		const db = {
			prepare: () => ({
				get: () => ({ id: "acct_primary" }),
			}),
		} as never;

		const result = await runAccountSyncJob({
			account: "acct_openclaw",
			steps: ["timeline"],
			logPath,
			lockPath,
			db,
		});

		expect(syncHomeTimelineMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			steps: [
				{
					kind: "timeline",
					ok: false,
					error: expect.stringContaining("--allow-bird-account"),
				},
			],
		});
	});

	it("forces non-default saved collection syncs through xurl without an assertion", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-account-job-"));
		const logPath = path.join(tempDir, "audit.jsonl");
		const lockPath = path.join(tempDir, "sync.lock");
		const db = {
			prepare: () => ({
				get: () => ({ id: "acct_primary" }),
			}),
		} as never;
		syncTimelineCollectionMock.mockResolvedValue({
			source: "xurl",
			count: 4,
		});

		const result = await runAccountSyncJob({
			account: "acct_openclaw",
			steps: ["likes"],
			logPath,
			lockPath,
			db,
		});

		expect(syncTimelineCollectionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "likes",
				account: "acct_openclaw",
				mode: "xurl",
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			steps: [{ kind: "likes", ok: true, count: 4, source: "xurl" }],
		});
	});

	it("refuses explicit Bird saved collection syncs for non-default accounts without an assertion", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-account-job-"));
		const logPath = path.join(tempDir, "audit.jsonl");
		const lockPath = path.join(tempDir, "sync.lock");
		const db = {
			prepare: () => ({
				get: () => ({ id: "acct_primary" }),
			}),
		} as never;

		const result = await runAccountSyncJob({
			account: "acct_openclaw",
			steps: ["bookmarks"],
			mode: "bird",
			logPath,
			lockPath,
			db,
		});

		expect(syncTimelineCollectionMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			steps: [
				{
					kind: "bookmarks",
					ok: false,
					error: expect.stringContaining("--allow-bird-account"),
				},
			],
		});
	});
});
