import { createFileRoute } from "@tanstack/react-router";
import { isValidRedirectUri } from "@/lib/github-utils";

export const Route = createFileRoute("/api/auth/url")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.GITHUB_CLIENT_ID;
        if (!clientId) {
          return Response.json({ error: "GitHub OAuth is not configured." }, { status: 500 });
        }

        const url = new URL(request.url);
        const redirectUri = url.searchParams.get("redirectUri") ?? "";
        if (!isValidRedirectUri(redirectUri)) {
          return Response.json({ error: "Invalid redirect URI" }, { status: 400 });
        }

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: "repo user",
        });

        return Response.json({
          url: `https://github.com/login/oauth/authorize?${params.toString()}`,
        });
      },
    },
  },
});
