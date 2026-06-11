// Pure, secret-free GitHub helpers. Safe to import anywhere.

export function isValidGitHubName(value: string): boolean {
  if (!value) return false;
  if (/^\.+$/.test(value)) return false;
  return /^[a-zA-Z0-9._-]{1,100}$/.test(value);
}

export function isValidBranchName(value: string): boolean {
  if (!value || value.length > 255) return false;
  if (/[\\^~: *?[\]@{}\x00-\x1f\x7f]/.test(value)) return false;
  if (/^[/.]|[/.]$/.test(value)) return false;
  if (/\/\/|\.\./.test(value)) return false;
  return true;
}

/** Sanitise a ZIP entry path so it cannot escape the repo root. Returns null to skip. */
export function sanitiseZipPath(raw: string): string | null {
  const normalised = raw.replace(/\\/g, "/");
  const parts: string[] = [];
  for (const seg of normalised.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  if (parts.length === 0) return null;
  const clean = parts.join("/");
  if (clean.startsWith("/")) return null;
  return clean;
}

/** Detect the common root directory prefix shared by every path. */
export function detectCommonRoot(paths: string[]): string {
  if (paths.length === 0) return "";
  const firstSegments = paths.map((p) => p.split("/")[0]);
  const allSameFirstSegment = firstSegments.every((s) => s === firstSegments[0]);
  if (!allSameFirstSegment) return "";
  const allHaveSubPath = paths.every((p) => p.indexOf("/") !== -1);
  if (!allHaveSubPath) return "";
  return firstSegments[0] + "/";
}

/** Validate a redirect URI: trusted origin + exact callback path. */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const protocolOk = parsed.protocol === "https:" || (isLocalhost && parsed.protocol === "http:");
    if (!protocolOk) return false;
    const normalised = parsed.pathname.replace(/\/+$/, "");
    return normalised === "/api/auth/callback";
  } catch {
    return false;
  }
}

/** Validate that a string is a genuine GitHub OAuth authorize URL. */
export function isValidGitHubOAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname === "/login/oauth/authorize"
    );
  } catch {
    return false;
  }
}

export const ZIP_MAX_ENTRIES = 10_000;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
