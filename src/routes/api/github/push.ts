import { createFileRoute } from "@tanstack/react-router";
import { Octokit } from "@octokit/rest";
import { unzipSync } from "fflate";
import {
  isValidGitHubName,
  isValidBranchName,
  sanitiseZipPath,
  detectCommonRoot,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_UNCOMPRESSED_BYTES,
  MAX_UPLOAD_BYTES,
} from "@/lib/github-utils";

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const spaceIdx = header.indexOf(" ");
  if (spaceIdx === -1) return null;
  const scheme = header.slice(0, spaceIdx);
  const token = header.slice(spaceIdx + 1).trim();
  return scheme === "Bearer" && token.length > 0 ? token : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const Route = createFileRoute("/api/github/push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = extractBearerToken(request);
        if (!token) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "Invalid form data" }, { status: 400 });
        }

        const owner = (form.get("owner")?.toString() ?? "").trim();
        const repo = (form.get("repo")?.toString() ?? "").trim();
        const branch = (form.get("branch")?.toString() ?? "").trim() || "main";
        const commitMessage =
          (form.get("commitMessage")?.toString() ?? "").trim().slice(0, 500) ||
          "Update from Zip Sync";
        const file = form.get("file");

        if (!owner || !repo || !(file instanceof File)) {
          return Response.json(
            { error: "Missing required fields: owner, repo, or file" },
            { status: 400 },
          );
        }
        if (!isValidGitHubName(owner)) {
          return Response.json({ error: "Invalid owner name" }, { status: 400 });
        }
        if (!isValidGitHubName(repo)) {
          return Response.json({ error: "Invalid repository name" }, { status: 400 });
        }
        if (!isValidBranchName(branch)) {
          return Response.json({ error: "Invalid branch name" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return Response.json({ error: "File exceeds the 50 MB size limit" }, { status: 413 });
        }
        if (file.size === 0) {
          return Response.json({ error: "The selected file is empty" }, { status: 400 });
        }

        const octokit = new Octokit({ auth: token });

        try {
          // 1. Parse ZIP and sanitise paths
          const buffer = new Uint8Array(await file.arrayBuffer());
          let entries: Record<string, Uint8Array>;
          try {
            entries = unzipSync(buffer);
          } catch {
            return Response.json({ error: "Invalid or corrupt ZIP file" }, { status: 400 });
          }

          const entryNames = Object.keys(entries);
          if (entryNames.length > ZIP_MAX_ENTRIES) {
            return Response.json(
              { error: `ZIP exceeds the maximum of ${ZIP_MAX_ENTRIES} entries` },
              { status: 400 },
            );
          }

          let totalUncompressed = 0;
          const rawFiles: { path: string; content: Uint8Array }[] = [];
          for (const name of entryNames) {
            const content = entries[name];
            // fflate includes directory entries as zero-length keys ending in "/"
            if (name.endsWith("/")) continue;
            totalUncompressed += content.length;
            if (totalUncompressed > ZIP_MAX_UNCOMPRESSED_BYTES) {
              return Response.json(
                { error: "ZIP uncompressed size exceeds the 500 MB limit" },
                { status: 400 },
              );
            }
            const safePath = sanitiseZipPath(name);
            if (!safePath) continue;
            rawFiles.push({ path: safePath, content });
          }

          if (rawFiles.length === 0) {
            return Response.json({ error: "ZIP contains no valid files" }, { status: 400 });
          }

          // 2. Strip common root directory
          const commonRoot = detectCommonRoot(rawFiles.map((f) => f.path));
          const filesToCommit = rawFiles
            .map((f) => ({
              ...f,
              path: commonRoot ? f.path.slice(commonRoot.length) : f.path,
            }))
            .filter((f) => f.path.length > 0);

          if (filesToCommit.length === 0) {
            return Response.json(
              { error: "ZIP contains no committable files after path normalisation" },
              { status: 400 },
            );
          }

          // 3. Resolve current branch tip (handles empty repos)
          let baseTreeSha = "";
          let parentCommitSha: string | null = null;
          try {
            const { data: refData } = await octokit.rest.git.getRef({
              owner,
              repo,
              ref: `heads/${branch}`,
            });
            parentCommitSha = refData.object.sha;
            const { data: commitData } = await octokit.rest.git.getCommit({
              owner,
              repo,
              commit_sha: parentCommitSha,
            });
            baseTreeSha = commitData.tree.sha;
          } catch (e: unknown) {
            const err = e as { status?: number };
            if (err.status === 404 || err.status === 409) {
              baseTreeSha = "";
            } else {
              throw e;
            }
          }

          // 4. Upload blobs in parallel batches
          const BATCH_SIZE = 5;
          const treeEntries: Array<{
            path: string;
            mode: "100644";
            type: "blob";
            sha: string;
          }> = [];

          for (let i = 0; i < filesToCommit.length; i += BATCH_SIZE) {
            const batch = filesToCommit.slice(i, i + BATCH_SIZE);
            const blobs = await Promise.all(
              batch.map((f) =>
                octokit.rest.git.createBlob({
                  owner,
                  repo,
                  content: toBase64(f.content),
                  encoding: "base64",
                }),
              ),
            );
            for (let j = 0; j < batch.length; j++) {
              treeEntries.push({
                path: batch[j].path,
                mode: "100644",
                type: "blob",
                sha: blobs[j].data.sha,
              });
            }
          }

          // 5. Create Git tree
          const { data: newTree } = await octokit.rest.git.createTree({
            owner,
            repo,
            tree: treeEntries,
            ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
          });

          // 6. Create commit
          const { data: newCommit } = await octokit.rest.git.createCommit({
            owner,
            repo,
            message: commitMessage,
            tree: newTree.sha,
            parents: parentCommitSha ? [parentCommitSha] : [],
          });

          // 7. Update or create branch ref
          if (parentCommitSha) {
            await octokit.rest.git.updateRef({
              owner,
              repo,
              ref: `heads/${branch}`,
              sha: newCommit.sha,
              force: false,
            });
          } else {
            await octokit.rest.git.createRef({
              owner,
              repo,
              ref: `refs/heads/${branch}`,
              sha: newCommit.sha,
            });
          }

          return Response.json({
            success: true,
            commitSha: newCommit.sha,
            branch,
            url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
            branchUrl: `https://github.com/${owner}/${repo}/tree/${branch}`,
          });
        } catch (error: unknown) {
          const err = error as { status?: number; message?: string };
          console.error("[/api/github/push]", err.message);
          return Response.json(
            { error: err.message || "Failed to push to GitHub" },
            { status: err.status ?? 500 },
          );
        }
      },
    },
  },
});
