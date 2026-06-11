import { createFileRoute } from "@tanstack/react-router";
import { Octokit } from "@octokit/rest";

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const spaceIdx = header.indexOf(" ");
  if (spaceIdx === -1) return null;
  const scheme = header.slice(0, spaceIdx);
  const token = header.slice(spaceIdx + 1).trim();
  return scheme === "Bearer" && token.length > 0 ? token : null;
}

export const Route = createFileRoute("/api/github/repos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = extractBearerToken(request);
        if (!token) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const octokit = new Octokit({ auth: token });

        try {
          const { data } = await octokit.rest.repos.listForAuthenticatedUser({
            visibility: "all",
            sort: "updated",
            per_page: 100,
          });
          const slim = data.map(({ id, full_name, private: isPrivate }) => ({
            id,
            full_name,
            private: isPrivate,
          }));
          return Response.json(slim);
        } catch (error: unknown) {
          const err = error as { status?: number; message?: string };
          console.error("[/api/github/repos]", err.message);
          return Response.json(
            { error: err.message ?? "Failed to fetch repositories" },
            { status: err.status ?? 500 },
          );
        }
      },
    },
  },
});
