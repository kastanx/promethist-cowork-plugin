/**
 * End-to-end test: spawns the MCP server as a child process, connects a real MCP
 * client over stdio, lists tools, and calls `list_tenants`.
 *
 * Provide auth via the environment (NOT committed):
 *   PROMETHIST_BASE_URL=https://preview.eu.promethist.ai \
 *   PROMETHIST_COOKIE='authjs.session-token=...' \
 *   npm run test:e2e
 *
 * With a valid cookie/token this prints live tenants + projects. Without one it
 * still exercises the full MCP path (spawn -> initialize -> tools/list ->
 * tools/call -> structured error).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, "../src/index.ts");

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") env[k] = v;
}

async function main() {
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", serverEntry], env });
  const client = new Client({ name: "promethist-mcp-e2e", version: "0.0.0" });
  await client.connect(transport);
  console.log("✓ connected to MCP server");

  const { tools } = await client.listTools();
  console.log(`✓ tools/list -> [${tools.map((t) => t.name).join(", ")}]`);
  if (!tools.find((t) => t.name === "list_tenants")) {
    throw new Error("expected tool 'list_tenants' to be advertised");
  }

  const res = (await client.callTool({ name: "list_tenants", arguments: {} })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  console.log(`✓ tools/call list_tenants (isError=${res.isError ?? false}):`);
  for (const c of res.content ?? []) if (c.type === "text") console.log(c.text);

  await client.close();
  console.log("✓ done");
}

main().catch((e) => {
  console.error("✗ e2e failed:", e);
  process.exit(1);
});
