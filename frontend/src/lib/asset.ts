/**
 * URL of a file in public/. The server edition is served from "/", the static builds
 * (Hugging Face, GitHub Pages) from wherever index.html lives, so paths go through BASE_URL.
 */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
