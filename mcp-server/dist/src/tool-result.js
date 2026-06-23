/** Wrap an ApiResult into an MCP tool result. */
export function toTool(r) {
    if (!r.ok) {
        return {
            content: [{ type: "text", text: `Error ${r.status || ""}: ${r.error}` }],
            isError: true,
        };
    }
    return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
}
/** A plain text tool result (optionally an error). */
export function textTool(text, isError = false) {
    return { content: [{ type: "text", text }], isError };
}
/** Re-creates the in-app DangerousToolRunner human-confirm gate for destructive ops. */
export function confirmGuard(confirm, summary) {
    if (confirm === true)
        return null;
    return textTool(`Refused — guarded action.\n${summary}\nRe-run with confirm: true to proceed.`, true);
}
