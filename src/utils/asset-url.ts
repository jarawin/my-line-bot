/**
 * Returns the full URL for a self-hosted static asset.
 * Files are served from the /img/ route and stored in IMAGE_DIR (./data/images/).
 */
export function assetUrl(filename: string): string {
    const base = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/img/${filename}`;
}
