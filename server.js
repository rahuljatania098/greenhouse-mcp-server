import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const API_KEY = process.env.GREENHOUSE_API_KEY;
const PORT = process.env.PORT || 3001;
const TRANSPORT = process.env.MCP_TRANSPORT || "stdio";
const BASE = "https://harvest.greenhouse.io/v1";

if (!API_KEY) {
  console.error("ERROR: Set GREENHOUSE_API_KEY environment variable");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(API_KEY + ":").toString("base64");

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

const server = new McpServer({
  name: "greenhouse",
  version: "1.0.0",
  description: "Greenhouse ATS MCP Server",
});

// JOBS
server.tool("list_jobs", "List all jobs. Filter by status (open/closed/draft).",
  { per_page: z.number().optional(), page: z.number().optional(), status: z.string().optional() },
  async ({ per_page, page, status }) => {
    const data = await gh("GET", "/jobs", { query: { per_page, page, status } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job", "Get detailed info about a specific job by ID.",
  { job_id: z.number().describe("Greenhouse job ID") },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job_stages", "Get all interview stages for a specific job.",
  { job_id: z.number().describe("Greenhouse job ID") },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}/stages`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_job", "Update a job's name, notes, department, offices, or other fields.",
  { job_id: z.number(), on_behalf_of: z.number(), updates: z.object({}).passthrough() },
  async ({ job_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/jobs/${job_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_job_openings", "Get openings for a specific job.",
  { job_id: z.number() },
  async ({ job_id }) => {
    const data = await gh("GET", `/jobs/${job_id}/openings`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// CANDIDATES
server.tool("list_candidates", "List candidates. Filter by email or job_id.",
  { per_page: z.number().optional(), page: z.number().optional(), email: z.string().optional(), job_id: z.number().optional() },
  async ({ per_page, page, email, job_id }) => {
    const data = await gh("GET", "/candidates", { query: { per_page, page, email, job_id } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_candidate", "Get detailed info about a candidate by ID.",
  { candidate_id: z.number() },
  async ({ candidate_id }) => {
    const data = await gh("GET", `/candidates/${candidate_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("create_candidate", "Create a new candidate with first_name, last_name, and optional fields.",
  { on_behalf_of: z.number(), candidate: z.object({ first_name: z.string(), last_name: z.string() }).passthrough() },
  async ({ on_behalf_of, candidate }) => {
    const data = await gh("POST", "/candidates", { body: candidate, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_candidate", "Update an existing candidate by ID.",
  { candidate_id: z.number(), on_behalf_of: z.number(), updates: z.object({}).passthrough() },
  async ({ candidate_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/candidates/${candidate_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// PROSPECTS
server.tool("create_prospect", "Create a new prospect (sourced candidate). Sets is_prospect=true.",
  { on_behalf_of: z.number(), prospect: z.object({ first_name: z.string(), last_name: z.string() }).passthrough() },
  async ({ on_behalf_of, prospect }) => {
    const data = await gh("POST", "/candidates", { body: { ...prospect, is_prospect: true }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_prospect", "Update an existing prospect by their candidate ID.",
  { prospect_id: z.number(), on_behalf_of: z.number(), updates: z.object({}).passthrough() },
  async ({ prospect_id, on_behalf_of, updates }) => {
    const data = await gh("PATCH", `/candidates/${prospect_id}`, { body: updates, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("convert_prospect_to_candidate", "Convert a prospect to a candidate by applying them to a job.",
  { prospect_id: z.number(), on_behalf_of: z.number(), job_id: z.number() },
  async ({ prospect_id, on_behalf_of, job_id }) => {
    const data = await gh("PUT", `/candidates/${prospect_id}/convert_prospect`, { body: { job_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// NOTES
server.tool("create_note", "Create a note on a candidate's activity feed.",
  { candidate_id: z.number(), on_behalf_of: z.number(), user_id: z.number(), body: z.string(), visibility: z.enum(["admin_only", "public"]) },
  async ({ candidate_id, on_behalf_of, user_id, body, visibility }) => {
    const data = await gh("POST", `/candidates/${candidate_id}/activity_feed/notes`, { body: { user_id, body, visibility }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_candidate_activity", "Get the activity feed for a candidate.",
  { candidate_id: z.number() },
  async ({ candidate_id }) => {
    const data = await gh("GET", `/candidates/${candidate_id}/activity_feed`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// APPLICATIONS
server.tool("list_applications", "List applications. Filter by status or job_id.",
  { per_page: z.number().optional(), page: z.number().optional(), status: z.string().optional(), job_id: z.number().optional() },
  async ({ per_page, page, status, job_id }) => {
    const data = await gh("GET", "/applications", { query: { per_page, page, status, job_id } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_application", "Get details about a specific application by ID.",
  { application_id: z.number() },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("advance_application", "Advance an application to the next pipeline stage.",
  { application_id: z.number(), on_behalf_of: z.number(), from_stage_id: z.number() },
  async ({ application_id, on_behalf_of, from_stage_id }) => {
    const data = await gh("POST", `/applications/${application_id}/advance`, { body: { from_stage_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("move_application", "Move an application to a specific stage.",
  { application_id: z.number(), on_behalf_of: z.number(), from_stage_id: z.number(), to_stage_id: z.number() },
  async ({ application_id, on_behalf_of, from_stage_id, to_stage_id }) => {
    const data = await gh("POST", `/applications/${application_id}/move`, { body: { from_stage_id, to_stage_id }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("reject_application", "Reject an application.",
  { application_id: z.number(), on_behalf_of: z.number(), rejection_reason_id: z.number().optional(), notes: z.string().optional() },
  async ({ application_id, on_behalf_of, rejection_reason_id, notes }) => {
    const body = {};
    if (rejection_reason_id) body.rejection_reason_id = rejection_reason_id;
    if (notes) body.notes = notes;
    const data = await gh("POST", `/applications/${application_id}/reject`, { body, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("unreject_application", "Unreject a previously rejected application.",
  { application_id: z.number(), on_behalf_of: z.number() },
  async ({ application_id, on_behalf_of }) => {
    const data = await gh("POST", `/applications/${application_id}/unreject`, { body: {}, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// USERS
server.tool("list_users", "List all users (recruiters, coordinators, hiring managers).",
  { per_page: z.number().optional(), page: z.number().optional(), email: z.string().optional() },
  async ({ per_page, page, email }) => {
    const data = await gh("GET", "/users", { query: { per_page, page, email } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_user", "Get details of a specific user by ID.",
  { user_id: z.number() },
  async ({ user_id }) => {
    const data = await gh("GET", `/users/${user_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("update_recruiter_coordinator", "Update the recruiter and/or coordinator assigned to a candidate.",
  { candidate_id: z.number(), on_behalf_of: z.number(), recruiter: z.object({}).passthrough().optional(), coordinator: z.object({}).passthrough().optional() },
  async ({ candidate_id, on_behalf_of, recruiter, coordinator }) => {
    const body = {};
    if (recruiter) body.recruiter = recruiter;
    if (coordinator) body.coordinator = coordinator;
    const data = await gh("PATCH", `/candidates/${candidate_id}`, { body, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// STAGES
server.tool("list_all_stages", "List all job stages across all jobs.",
  { per_page: z.number().optional(), page: z.number().optional() },
  async ({ per_page, page }) => {
    const data = await gh("GET", "/job_stages", { query: { per_page, page } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// TAGS
server.tool("add_candidate_tag", "Add a tag to a candidate.",
  { candidate_id: z.number(), on_behalf_of: z.number(), tag: z.string() },
  async ({ candidate_id, on_behalf_of, tag }) => {
    const data = await gh("PUT", `/candidates/${candidate_id}/tags`, { body: { tag }, onBehalfOf: on_behalf_of });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// REFERENCE DATA
server.tool("list_departments", "List all departments.", {},
  async () => { const data = await gh("GET", "/departments"); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
);
server.tool("list_offices", "List all offices.", {},
  async () => { const data = await gh("GET", "/offices"); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
);
server.tool("list_rejection_reasons", "List all rejection reasons.", {},
  async () => { const data = await gh("GET", "/rejection_reasons"); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
);
server.tool("list_sources", "List all candidate sources.", {},
  async () => { const data = await gh("GET", "/sources"); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
);

// INTERVIEWS & SCORECARDS
server.tool("list_scheduled_interviews", "List scheduled interviews for an application.",
  { application_id: z.number() },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}/scheduled_interviews`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("list_scorecards", "List scorecards for an application.",
  { application_id: z.number() },
  async ({ application_id }) => {
    const data = await gh("GET", `/applications/${application_id}/scorecards`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// START SERVER
async function main() {
  if (TRANSPORT === "sse") {
    const app = express();
    const transports = {};

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      res.on("close", () => delete transports[transport.sessionId]);
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId;
      const transport = transports[sessionId];
      if (!transport) return res.status(400).json({ error: "Unknown session" });
      await transport.handlePostMessage(req, res);
    });

    app.get("/health", (req, res) => res.json({ status: "ok", tools: 29 }));

    app.listen(PORT, () => {
      console.log("Greenhouse MCP Server (SSE) running on port " + PORT);
      console.log("SSE endpoint: /sse");
      console.log("Health check: /health");
      console.log("29 tools available");
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Greenhouse MCP Server (stdio) running");
  }
}

main().catch(console.error);
