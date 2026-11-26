/**
 * S198's test helpers for the one player and its corner mini-player. jsdom plays nothing (`play` is
 * not implemented and `paused` stays true), so a test marks the element it holds as playing at a
 * given time, then checks that the very same element, stubbed values and all, is what the corner
 * holds after the move: an identity check, never a copy.
 */
import { screen } from "@testing-library/react";
import { expect } from "vitest";

/** Marks `video` as playing at `time` seconds: `paused` and `ended` false, `currentTime` read back as set. */
export function markPlaying(video: HTMLVideoElement, time: number): void
{
	let at = time;
	let paused = false;
	Object.defineProperties(video, {
		paused: {
			configurable: true,
			get: () => paused,
		},
		ended: {
			configurable: true,
			get: () => false,
		},
		currentTime: {
			configurable: true,
			get: () => at,
			set: (value: number) =>
			{
				at = value;
			},
		},
		pause: {
			configurable: true,
			value: () =>
			{
				paused = true;
				video.dispatchEvent(new Event("pause"));
			},
		},
		play: {
			configurable: true,
			value: () =>
			{
				paused = false;
				video.dispatchEvent(new Event("play"));
				return Promise.resolve();
			},
		},
	});
}

/** The corner player, which is always mounted and hidden while it holds nothing. */
export function corner(): HTMLElement
{
	return screen.getByTestId("corner-player");
}

/** Whether the corner player shows. */
export function cornerShown(): boolean
{
	return !corner().hidden;
}

/**
 * Checks the corner player shows and holds `video` itself, at `time` or later: the same element
 * the host held, moved, not a new one (S198 AC 1).
 */
export function expectInCorner(video: HTMLVideoElement, time: number): void
{
	expect(cornerShown()).toBe(true);
	expect(corner().querySelector("video")).toBe(video);
	expect(video.isConnected).toBe(true);
	expect(video.paused).toBe(false);
	expect(video.currentTime).toBeGreaterThanOrEqual(time);
}
