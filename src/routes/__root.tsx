import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import { AppNav } from "#/components/AppNav";
import { ThemeProvider, themeScript } from "#/lib/theme";
import {
	bodyClass,
	mainColumnClass,
	mainColumnDmClass,
	siteShellClass,
	siteShellDmClass,
} from "#/lib/ui";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "birdclaw",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	notFoundComponent: NotFoundView,
	shellComponent: RootDocument,
});

function NotFoundView() {
	return (
		<main className={mainColumnClass}>
			<div className="px-4 py-10 text-[var(--ink-soft)]">Not Found</div>
		</main>
	);
}

function RootDocument({ children }: { children: ReactNode }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const messagesMode = pathname.startsWith("/dms");

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				<script suppressHydrationWarning>{themeScript}</script>
			</head>
			<body className={bodyClass}>
				<ThemeProvider>
					<div className={messagesMode ? siteShellDmClass : siteShellClass}>
						<AppNav compact={messagesMode} />
						<main
							className={messagesMode ? mainColumnDmClass : mainColumnClass}
						>
							{children}
						</main>
					</div>
				</ThemeProvider>
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
