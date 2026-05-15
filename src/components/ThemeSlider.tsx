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

export function ThemeSlider() {
	const { isReady, theme, setTheme } = useTheme();

	return (
		<fieldset
			className="theme-slider-shell m-0 flex justify-center border-0 px-2 py-1 min-[1100px]:justify-start min-[1100px]:px-3"
			aria-label="Theme selector"
		>
			<div className="theme-slider flex flex-col items-center gap-1.5 min-[1100px]:flex-row">
				{THEME_OPTIONS.map((option, index) => {
					const Icon = option.icon;
					const isActive = option.key === theme || (index === 0 && !theme);

					const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
						if (isActive) return;

						const context: ThemeTransitionContext = {
							element: event.currentTarget,
							pointerClientX: event.clientX,
							pointerClientY: event.clientY,
						};

						startThemeTransition({
							nextTheme: option.key,
							currentTheme: theme,
							setTheme,
							context,
						});
					};

					return (
						<button
							key={option.key}
							type="button"
							className={cx(
								"theme-slider-button inline-flex size-9 items-center justify-center rounded-full border-0 bg-transparent text-[var(--ink-soft)] transition-[background,color,transform] duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] active:scale-95 disabled:cursor-default disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:color-mix(in_srgb,var(--accent)_54%,transparent)]",
								isActive &&
									"theme-slider-button-active bg-[var(--bg-active)] text-[var(--ink)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--line)_72%,transparent)]",
							)}
							onClick={handleClick}
							aria-label={option.label}
							aria-pressed={isActive}
							data-testid={`theme-${option.key}`}
							disabled={!isReady}
						>
							<Icon
								className="theme-slider-icon size-[17px]"
								strokeWidth={isActive ? 2.1 : 1.8}
							/>
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}
