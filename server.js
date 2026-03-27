import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

// ─── CONFIG ────────────────────────────────────────────────────
const API_KEY = process.env.GREENHOUSE_API_KEY;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Bearer token for MCP server access
const PORT = process.env.PORT || 3001;
const TRANSPORT = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "sse"
const BASE = "https://harvest.greenhouse.io/v1";

if (!API_KEY) {
  console.error("ERROR: Set GREENHOUSE_API_KEY environment variable");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(API_KEY + ":").toString("base64");

// ─── BEARER TOKEN AUTH MIDDLEWARE ──────────────────────────────
function requireAuth(req, res, next) {
  // If no AUTH_TOKEN is set, allow all requests (backwards compatible)
  if (!AUTH_TOKEN) return next();

  // Check Authorization header: "Bearer <token>"
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header. Use: Bearer <token>" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || parts[1] !== AUTH_TOKEN) {
    return res.status(403).json({ error: "Invalid bearer token" });
  }

  next();
}

// ─── GREENHOUSE API HELPER ─────────────────────────────────────
async function gh(method, path, { body, onBehalfOf, query } = {}) {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }
  const headers = { Authorization: AUTH, "Content-Type": "application/json" };
  if (onBehalfOf) headers["On-Behalf-Of"] = String(onBehalfOf);

  const opts = { method, headers };
  if (body && ["POST", "PATCH", "PUT"].includes(method)) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Greenhouse ${res.status}: ${text}`);
  if (!text || res.status === 204) return { success: true };
  return JSON.parse(text);
}

// ─── CREATE MCP SERVER ─────────────────────────────────────────
const server = new McpServer({
  name: "greenhouse",
  version: "1.0.0",
  description: "Greenhouse ATS MCP Server — manage candidates, prospects, jobs, notes, stages, recruiters, and more",
});

// ════════════════════════════════════════════════════════════════
//  JOBS
// ════════════════════════════════════════════════════════════════

server.tool("list_jobs",
  "List all jobs in Greenhouse. Filter by status (open/closed/draft), department_id, or office_id.",
  { per_page: z.number().optional().describe("Results per page, max 500"), page: z.number().optional().describe("Page number"), status: z.string().optional().describe("open, closed, or draft") },
  async ({ per_page, page, status }) => {
    const data = await gh("GET", "/jobs", { query: { per_page, page, status } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job",
  "Get detailed info about a specific job by ID.",
  { job_id: z.number().describe("Greenhouse job ID") },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job_stages",
  "Get all interview stages for a specific job. Returns stage id, name, and interview plan.",
  { job_id: z.number().describe("Greenhouse job ID") },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}/stages`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_job",
  "Update a job's name, notes, department, offices, or other fields.",
  { job_id: z.number().describe("Job ID"), on_behalf_of: z.number().describe("User ID performing action"), updates: z.object({}).passthrough().describe("Fields to update: name, notes, department_id, office_ids, requisition_id") },
  async ({ job_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/jobs/${job_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job_openings",
  "Get openings for a specific job.",
  { job_id: z.number().describe("Greenhouse job ID") },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}/openings`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  CANDIDATES
// ════════════════════════════════════════════════════════════════

server.tool("list_candidates",
  "List candidates. Filter by email or job_id.",
  { per_page: z.number().optional(), page: z.number().optional(), email: z.string().optional().describe("Filter by email"), job_id: z.number().optional().describe("Filter by job ID") },
  async ({ per_page, page, email, job_id }) => {
    const data = await gh("GET", "/candidates", { query: { per_page, page, email, job_id } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_candidate",
  "Get detailed info about a candidate by ID.",
  { candidate_id: z.number().describe("Candidate ID") },
  async ({ candidate_id }) => {
    const data = await gh("GET", `/candidates/${candidate_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("create_candidate",
  "Create a new candidate. Provide first_name, last_name, and optional fields like email_addresses, phone_numbers, company, title, tags, applications.",
  { on_behalf_of: z.number().describe("User ID performing action"), candidate: z.object({ first_name: z.string(), last_name: z.string() }).passthrough().describe("Candidate data: first_name, last_name, email_addresses:[{value,type}], phone_numbers, company, title, tags, applications:[{job_id}]") },
  async ({ on_behalf_of, candidate }) => {
    const data = await gh("POST", "/candidates", { body: candidate, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_candidate",
  "Update an existing candidate by ID. Can update name, company, title, emails, phones, tags, custom_fields.",
  { candidate_id: z.number().describe("Candidate ID"), on_behalf_of: z.number().describe("User ID"), updates: z.object({}).passthrough().describe("Fields to update") },
  async ({ candidate_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/candidates/${candidate_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  PROSPECTS
// ════════════════════════════════════════════════════════════════

server.tool("create_prospect",
  "Create a new prospect (sourced candidate). Automatically sets is_prospect=true.",
  { on_behalf_of: z.number().describe("User ID"), prospect: z.object({ first_name: z.string(), last_name: z.string() }).passthrough().describe("Prospect data: first_name, last_name, email_addresses, phone_numbers, company, title, tags, applications:[{job_id}]") },
  async ({ on_behalf_of, prospect }) => {
    const data = await gh("POST", "/candidates", { body: { ...prospect, is_prospect: true }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_prospect",
  "Update an existing prospect by their candidate ID.",
  { prospect_id: z.number().describe("Prospect/candidate ID"), on_behalf_of: z.number().describe("User ID"), updates: z.object({}).passthrough().describe("Fields to update") },
  async ({ prospect_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/candidates/${prospect_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("convert_prospect_to_candidate",
  "Convert a prospect to a candidate by applying them to a job.",
  { prospect_id: z.number().describe("Prospect ID"), on_behalf_of: z.number().describe("User ID"), job_id: z.number().describe("Job ID to apply the prospect to") },
  async ({ prospect_id, on_behalf_of, job_id }) => {
    const data = await gh("PUT", `/candidates/${prospect_id}/convert_prospect`, { body: { job_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  NOTES
// ════════════════════════════════════════════════════════════════

server.tool("create_note",
  "Create a note on a candidate's activity feed.",
  { candidate_id: z.number().describe("Candidate ID"), on_behalf_of: z.number().describe("User ID"), user_id: z.number().describe("Note author user ID"), body: z.string().describe("Note text"), visibility: z.enum(["admin_only", "public"]).describe("Note visibility") },
  async ({ candidate_id, on_behalf_of, user_id, body, visibility }) => {
    const data = await gh("POST", `/candidates/${candidate_id}/activity_feed/notes`, { body: { user_id, body, visibility }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_candidate_activity",
  "Get the activity feed (notes, emails, activities) for a candidate.",
  { candidate_id: z.number().describe("Candidate ID") },
  async ({ candidate_id }) => {
    const data = await gh("GET", `/candidates/${candidate_id}/activity_feed`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  APPLICATIONS
// ════════════════════════════════════════════════════════════════

server.tool("list_applications",
  "List applications. Filter by status (active/rejected/hired) or job_id.",
  { per_page: z.number().optional(), page: z.number().optional(), status: z.string().optional().describe("active, rejected, or hired"), job_id: z.number().optional() },
  async ({ per_page, page, status, job_id }) => {
    const data = await gh("GET", "/applications", { query: { per_page, page, status, job_id } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_application",
  "Get details about a specific application by ID.",
  { application_id: z.number().describe("Application ID") },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("advance_application",
  "Advance an application to the next pipeline stage.",
  { application_id: z.number().describe("Application ID"), on_behalf_of: z.number().describe("User ID"), from_stage_id: z.number().describe("Current stage ID") },
  async ({ application_id, on_behalf_of, from_stage_id }) => {
    const data = await gh("POST", `/applications/${application_id}/advance`, { body: { from_stage_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("move_application",
  "Move an application to a specific stage.",
  { application_id: z.number().describe("Application ID"), on_behalf_of: z.number().describe("User ID"), from_stage_id: z.number().describe("Current stage ID"), to_stage_id: z.number().describe("Target stage ID") },
  async ({ application_id, on_behalf_of, from_stage_id, to_stage_id }) => {
    const data = await gh("POST", `/applications/${application_id}/move`, { body: { from_stage_id, to_stage_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("reject_application",
  "Reject an application. Optionally provide rejection_reason_id and notes.",
  { application_id: z.number().describe("Application ID"), on_behalf_of: z.number().describe("User ID"), rejection_reason_id: z.number().optional().describe("Rejection reason ID"), notes: z.string().optional().describe("Rejection notes") },
  async ({ application_id, on_behalf_of, rejection_reason_id, notes }) => {
    const body = {};
    if (rejection_reason_id) body.rejection_reason_id = rejection_reason_id;
    if (notes) body.notes = notes;
    const data = await gh("POST", `/applications/${application_id}/reject`, { body, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("unreject_application",
  "Unreject a previously rejected application.",
  { application_id: z.number().describe("Application ID"), on_behalf_of: z.number().describe("User ID") },
  async ({ application_id, on_behalf_of }) => {
    const data = await gh("POST", `/applications/${application_id}/unreject`, { body: {}, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  USERS (Recruiters / Coordinators)
// ════════════════════════════════════════════════════════════════

server.tool("list_users",
  "List all users (recruiters, coordinators, hiring managers). Filter by email.",
  { per_page: z.number().optional(), page: z.number().optional(), email: z.string().optional().describe("Filter by email") },
  async ({ per_page, page, email }) => {
    const data = await gh("GET", "/users", { query: { per_page, page, email } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_user",
  "Get details of a specific user by ID.",
  { user_id: z.number().describe("User ID") },
  async ({ user_id }) => {
    const data = await gh("GET", `/users/${user_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_recruiter_coordinator",
  "Update the recruiter and/or coordinator assigned to a candidate.",
  { candidate_id: z.number().describe("Candidate ID"), on_behalf_of: z.number().describe("User ID"), recruiter: z.object({}).passthrough().optional().describe("Recruiter: {id: N} or {email: 'x@co.com'}"), coordinator: z.object({}).passthrough().optional().describe("Coordinator: {id: N} or {email: 'x@co.com'}") },
  async ({ candidate_id, on_behalf_of, recruiter, coordinator }) => {
    const body = {};
    if (recruiter) body.recruiter = recruiter;
    if (coordinator) body.coordinator = coordinator;
    const data = await gh("PATCH", `/candidates/${candidate_id}`, { body, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  STAGES
// ════════════════════════════════════════════════════════════════

server.tool("list_all_stages",
  "List all job stages across all jobs.",
  { per_page: z.number().optional(), page: z.number().optional() },
  async ({ per_page, page }) => {
    const data = await gh("GET", "/job_stages", { query: { per_page, page } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  TAGS
// ════════════════════════════════════════════════════════════════

server.tool("add_candidate_tag",
  "Add a tag to a candidate.",
  { candidate_id: z.number().describe("Candidate ID"), on_behalf_of: z.number().describe("User ID"), tag: z.string().describe("Tag name") },
  async ({ candidate_id, on_behalf_of, tag }) => {
    const data = await gh("PUT", `/candidates/${candidate_id}/tags`, { body: { tag }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  REFERENCE DATA
// ════════════════════════════════════════════════════════════════

server.tool("list_departments", "List all departments.", {},
  async () => {
    const data = await gh("GET", "/departments");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("list_offices", "List all offices.", {},
  async () => {
    const data = await gh("GET", "/offices");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("list_rejection_reasons", "List all rejection reasons.", {},
  async () => {
    const data = await gh("GET", "/rejection_reasons");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("list_sources", "List all candidate sources.", {},
  async () => {
    const data = await gh("GET", "/sources");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  INTERVIEWS & SCORECARDS
// ════════════════════════════════════════════════════════════════

server.tool("list_scheduled_interviews",
  "List scheduled interviews for an application.",
  { application_id: z.number().describe("Application ID") },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}/scheduled_interviews`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("list_scorecards",
  "List scorecards for an application.",
  { application_id: z.number().describe("Application ID") },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}/scorecards`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════

async function main() {
  if (TRANSPORT === "sse") {
    // ── SSE MODE (for remote access by Claude, other agents, etc.) ──
    const app = express();
    const transports = {};

    // Health check is public (no auth) — used for uptime monitoring & wake-up
    app.get("/health", (req, res) => res.json({ status: "ok", tools: 29, auth: !!AUTH_TOKEN }));

    // SSE and messages endpoints require bearer token auth
    app.get("/sse", requireAuth, async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      res.on("close", () => delete transports[transport.sessionId]);
      await server.connect(transport);
    });

    app.post("/messages", requireAuth, async (req, res) => {
      const sessionId = req.query.sessionId;
      const transport = transports[sessionId];
      if (!transport) return res.status(400).json({ error: "Unknown session" });
      await transport.handlePostMessage(req, res);
    });

    app.listen(PORT, () => {
      console.log(`✅ Greenhouse MCP Server (SSE) running on http://localhost:${PORT}`);
      console.log(`   SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`\n📋 29 tools available — candidates, prospects, jobs, notes, stages, and more`);
      console.log(`\n🔗 Connect Claude Code:`);
      console.log(`   claude mcp add greenhouse-mcp http://localhost:${PORT}/sse`);
    });
  } else {
    // ── STDIO MODE (for direct Claude Code integration) ──
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Greenhouse MCP Server (stdio) running");
  }
}

main().catch(console.error);
