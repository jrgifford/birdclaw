import { Monitor, Moon, Sun } from "lucide-react";
import type { MouseEvent } from "react";
import { type ThemeValue, useTheme } from "#/lib/theme";
import {
	startThemeTransition,
	type ThemeTransitionContext,
} from "#/lib/theme-transition";
import { cx } from "#/lib/ui";

const THEME_OPTIONS = [
	{ key: "system", icon: Monitor, label: "System default" },
	{ key: "light", icon: Sun, label: "Light theme" },
	{ key: "dark", icon: Moon, label: "Dark theme" },
] as const satisfies Array<{
	key: ThemeValue;
	icon: typeof Sun;
	label: string;
}>;

function themeIndex(theme: ThemeValue) {
	return THEME_OPTIONS.findIndex((option) => option.key === theme);
}

export function ThemeSlider() {
	const { isReady, theme, setTheme } = useTheme();
	const activeIndex = Math.max(themeIndex(theme), 0);
	const activeOption = THEME_OPTIONS[activeIndex];
	const nextOption = THEME_OPTIONS[(activeIndex + 1) % THEME_OPTIONS.length];
	const Icon = activeOption.icon;

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		const context: ThemeTransitionContext = {
			element: event.currentTarget,
			pointerClientX: event.clientX,
			pointerClientY: event.clientY,
		};

		startThemeTransition({
			nextTheme: nextOption.key,
			currentTheme: theme,
			setTheme,
			context,
		});
	};

	return (
		<div
			className="theme-toggle-shell flex justify-center px-2 py-1 min-[1100px]:justify-start min-[1100px]:px-3"
			title={`${activeOption.label}; click for ${nextOption.label}`}
		>
			<button
				type="button"
				className={cx(
					"theme-toggle-button inline-flex size-11 items-center justify-center rounded-full border border-[var(--line)] bg-transparent text-[var(--ink-soft)] transition-[background,border-color,color,transform,box-shadow] duration-150 hover:border-[color:color-mix(in_srgb,var(--accent)_38%,var(--line))] hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] active:scale-95 disabled:cursor-default disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:color-mix(in_srgb,var(--accent)_54%,transparent)]",
					"shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--line)_44%,transparent)]",
				)}
				onClick={handleClick}
				aria-label={`Theme: ${activeOption.label}. Switch to ${nextOption.label}.`}
				data-testid="theme-toggle"
				disabled={!isReady}
			>
				<Icon
					className="theme-toggle-icon size-[19px]"
					strokeWidth={2}
					aria-hidden="true"
				/>
			</button>
		</div>
	);
}
