import { createFileRoute } from "@tanstack/react-router";
import { maybeAutoUpdateBackup } from "#/lib/backup";
import { getTweetConversation } from "#/lib/queries";

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});
}

export const Route = createFileRoute("/api/conversation")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				await maybeAutoUpdateBackup();
				const url = new URL(request.url);
				const tweetId = url.searchParams.get("tweetId")?.trim();
				if (!tweetId) {
					return json({ ok: false, error: "Missing tweetId" }, 400);
				}

				const conversation = getTweetConversation(tweetId);
				if (!conversation) {
					return json({ ok: false, error: "Tweet not found" }, 404);
				}

				return json({ ok: true, ...conversation });
			},
		},
	},
});
