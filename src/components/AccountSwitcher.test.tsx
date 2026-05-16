import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSwitcher } from "./AccountSwitcher";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	vi.unstubAllGlobals();
});

function mockStatus() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				accounts: [
					{
						id: "acct_primary",
						name: "Peter Steinberger",
						handle: "@steipete",
						profileId: "profile_me",
						avatarHue: 18,
						transport: "archive",
						isDefault: 1,
						createdAt: "2026-05-16T12:00:00.000Z",
					},
					{
						id: "acct_openclaw",
						name: "OpenClaw",
						handle: "@openclaw",
						avatarHue: 210,
						transport: "bird",
						isDefault: 0,
						createdAt: "2026-05-16T12:00:00.000Z",
					},
				],
				archives: [],
				stats: { home: 0, mentions: 0, dms: 0, needsReply: 0, inbox: 0 },
				transport: { statusText: "local" },
			}),
		),
	);
}

describe("AccountSwitcher", () => {
	it("renders a web-styled account menu with avatars", async () => {
		mockStatus();

		render(<AccountSwitcher />);

		const trigger = await screen.findByRole("button", {
			name: "Active account: @steipete",
		});
		expect(trigger).toHaveTextContent("@steipete");
		expect(screen.getByText("PS")).toBeInTheDocument();

		fireEvent.click(trigger);

		expect(
			screen.getByRole("listbox", { name: "Active account" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("option", { name: /@openclaw/i }),
		).toBeInTheDocument();
		expect(screen.getByText("O")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("option", { name: /@openclaw/i }));

		await waitFor(() => {
			expect(window.localStorage.getItem("birdclaw:selected-account-id")).toBe(
				"acct_openclaw",
			);
		});
		expect(
			screen.queryByRole("listbox", { name: "Active account" }),
		).toBeNull();
	});
});
