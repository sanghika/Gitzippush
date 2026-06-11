import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");

        if (!code) {
          return new Response("No code provided.", { status: 400 });
        }

        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return new Response("GitHub OAuth is not configured.", { status: 500 });
        }

        let accessToken: string | null = null;
        try {
          const ghResponse = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
            signal: AbortSignal.timeout(15_000),
          });

          if (!ghResponse.ok) {
            return new Response("GitHub token exchange failed.", { status: 502 });
          }

          const payload = (await ghResponse.json()) as Record<string, unknown>;
          if (typeof payload.access_token === "string" && payload.access_token) {
            accessToken = payload.access_token;
          }
        } catch (error) {
          console.error("[/api/auth/callback]", error);
          return new Response("Authentication failed.", { status: 500 });
        }

        if (!accessToken) {
          return new Response("Failed to retrieve access token.", { status: 400 });
        }

        // The opener window is same-origin as this callback page, so post the
        // token back to this page's own origin.
        const safeToken = JSON.stringify(accessToken);
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Authenticating…</title></head>
<body>
<p>Authentication successful. This window will close automatically.</p>
<script>
(function(){
  var t=${safeToken};
  if(window.opener){
    window.opener.postMessage({type:'OAUTH_AUTH_SUCCESS',token:t}, window.location.origin);
    window.close();
  } else {
    window.location.href='/';
  }
})();
</script>
</body>
</html>`;

        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'",
            "X-Frame-Options": "DENY",
          },
        });
      },
    },
  },
});
