import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { textTool } from "./tool-result.js";

// Live agent testing via the engine's PUBLIC pipeline endpoint (GET /api/pipeline/{key}).
// No auth (engine SecurityConfiguration = permitAll). ONE call = ONE turn; the conversation
// threads via a `sessionId` cookie the engine sets — we store it per session label, in memory,
// for the MCP server's lifetime, so multi-turn works across stateless tool calls.
// Ported from a coworker's agent_chat.sh + SKILL.md (text mode; stop at #response-end to halve
// latency since the engine holds the stream open via Flux.never()).
const sessions = new Map<string, string>();

export function registerTestTools(server: McpServer) {
  server.registerTool(
    "test_agent",
    {
      title: "Test a Promethist agent (live chat)",
      description:
        "Hold ONE turn of a real text conversation with a LIVE Promethist agent on the engine, to test BEHAVIOR " +
        "(which interactive/multimodal element or tool actually fires, answer quality, scope, memory, etc.) — static " +
        "config review can't catch these. ONE call = ONE turn; the conversation persists internally, so call " +
        "REPEATEDLY and choose each next line from the reply you just read — roleplay a persona, do NOT pre-script. " +
        "Start with message='#intro' and new=true to get the opening, then continue. Works on Published/live-Preview " +
        "(agent_ref) AND any Draft/revision (agent_ref + revision). No auth/token needed. The reply is the agent's " +
        "spoken text plus markers: ⟦tool: X⟧ = a tool/element was invoked, ⟦shows: X⟧ = an interactive element was " +
        "actually shown. ALWAYS read get_guide('testing') first for the methodology, then critique the config in plain " +
        "language and offer to fix + re-test. Testing creates real engine sessions/usage — keep runs short.",
      inputSchema: {
        agent_ref: z.string().optional().describe("Agent ref/slug (from get_agent). Tested as agent:<ref> (published / live preview)."),
        revision: z.number().optional().describe("Test a specific Draft/revision instead: agent:<ref>.<revision> (revision from get_agent / get_agent_revisions)."),
        agent_key: z.string().optional().describe("Raw engine key override, e.g. 'agent:thomasJefferson' or 'agent:thomasJefferson.8'. Use instead of agent_ref."),
        message: z.string().optional().describe("Your line for this turn, written from the reply you just read. Default '#intro' (the agent's opening)."),
        locale: z.string().optional().describe("BCP-47 locale, e.g. en-US, cs-CZ. Default en-US — match a locale the agent supports."),
        session: z.string().optional().describe("Session label that threads turns together. Default derived from the key. Use a DISTINCT label per persona."),
        new: z.boolean().optional().describe("Start a fresh session (drop stored state). Use on the first '#intro' of each persona."),
        diagnose: z.boolean().optional().describe("Also surface the reasoning→realtime hand-off frames (⟦plan⟧/⟦instruction⟧) to see WHY a turn behaved oddly. Slower."),
      },
    },
    async (a) => {
      const key = a.agent_key ?? (a.agent_ref ? `agent:${a.agent_ref}${a.revision != null ? `.${a.revision}` : ""}` : "");
      if (!key) return textTool("Provide agent_ref (+ optional revision) or agent_key — e.g. agent_ref='thomasJefferson'.", true);
      const label = a.session ?? key;
      const message = a.message ?? "#intro";
      const locale = a.locale ?? "en-US";
      const diagnose = a.diagnose === true;
      if (a.new === true) sessions.delete(label);

      const qs = new URLSearchParams({ outputFormat: "TEXT", inputFormat: "TEXT", textOnly: "true", locale, text: message });
      const url = `${config.baseUrl.replace(/\/+$/, "")}/api/pipeline/${key}?${qs.toString()}`;

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
      const headers: Record<string, string> = { Accept: "text/plain" };
      const stored = sessions.get(label);
      if (stored) headers["Cookie"] = `sessionId=${stored}`;

      const out: string[] = [];
      try {
        const res = await fetch(url, { method: "GET", headers, signal: controller.signal });

        // capture/refresh the engine's sessionId cookie (threads the conversation)
        const h = res.headers as any;
        const setCookies: string[] = h.getSetCookie ? h.getSetCookie() : res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : [];
        for (const c of setCookies) {
          const m = /(?:^|;\s*)sessionId=([^;]+)/.exec(c);
          if (m) sessions.set(label, m[1]);
        }

        if (!res.ok) {
          clearTimeout(timeout);
          return textTool(`Engine returned ${res.status} for ${key}. Is it reachable? Use agent_ref for a published/preview agent, or agent_ref+revision for a draft.`, true);
        }
        if (!res.body) { clearTimeout(timeout); return textTool("No response body from engine.", true); }

        const reader = (res.body as any).getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let cite = false;
        let done = false;
        while (!done) {
          const { value, done: rdone } = await reader.read();
          if (rdone) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const t = buf.slice(0, nl).trimEnd();
            buf = buf.slice(nl + 1);
            if (t.startsWith("#response-end")) { if (!diagnose) { done = true; break; } continue; }
            if (t.startsWith("#exit")) { done = true; break; }
            if (t.startsWith("Supporting citations:")) { cite = true; continue; }
            if (t.startsWith("#tool-call")) {
              if (/result=completed/.test(t)) continue;
              const m = /name=([A-Za-z0-9_]+)/.exec(t);
              if (m) out.push(`  ⟦tool: ${m[1]}⟧`);
              continue;
            }
            if (t.startsWith("#multimodal-interaction")) {
              const m = /"ref":"([^"]+)"/.exec(t);
              out.push(`  ⟦shows: ${m ? m[1] : "?"}⟧`);
              continue;
            }
            if (diagnose && t.startsWith("#realtime-planning")) {
              const tx = t.replace(/^#realtime-planning:(.*?&)?text=/, "").trim();
              if (tx) out.push(`  ⟦reasoning→plan⟧ ${tx.slice(0, 700)}`);
              continue;
            }
            if (diagnose && t.startsWith("#realtime-instruction")) {
              const tx = t.replace(/^#realtime-instruction:(.*?&)?text=/, "").trim();
              if (tx) out.push(`  ⟦reasoning→instruction⟧ ${tx.slice(0, 700)}`);
              continue;
            }
            if (t.startsWith("#")) continue;
            if (t === "") continue;
            if (!cite) out.push(t);
          }
        }
        try { await reader.cancel(); } catch { /* */ }
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") {
          clearTimeout(timeout);
          return textTool(`test_agent failed: ${err.message}`, true);
        }
      } finally {
        clearTimeout(timeout);
        controller.abort(); // drop the connection (engine keeps the stream open after the turn)
      }

      let body = out.length ? out.join("\n") : "(no spoken text returned)";
      if (timedOut) body += "\n  (turn cut off at 90s — engine slow or no #response-end)";
      return { content: [{ type: "text" as const, text: `You:   ${message}\nAgent:\n${body}` }] };
    },
  );
}
