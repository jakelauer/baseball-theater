/**
 * hls.js ships types for its full build only; its light build (`hls.js/light`, which
 * `VideoPlayer` loads, #415) has the same API minus subtitles, alternate audio and DRM,
 * so it reuses them.
 */
declare module "hls.js/light"
{
	export * from "hls.js";
	export { default } from "hls.js";
}
