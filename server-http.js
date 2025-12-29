#!/usr/bin/env node
/**
 * PostgreSQL MCP Server (HTTP Transport for Remote Deployment)
 * 
 * This wrapper provides HTTP/SSE transport for the MCP server,
 * allowing remote deployment on platforms like Coolify.
 * 
 * It wraps the official MCP SDK server with HTTP endpoints.
 * 
 * Usage:
 *   MCP_API_KEY=your-key DATABASE_URL=postgres://... node server-http.js
 */

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';
import 'dotenv/config';

// Allow self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Configuration
// ============================================

const API_KEY = process.env.MCP_API_KEY;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
const ENABLE_WRITES = process.env.ENABLE_WRITES === 'true';

if (!API_KEY) console.error('WARNING: MCP_API_KEY not set - server will reject requests');

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: ALLOWED_ORIGINS[0] === '*' ? '*' : ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Database-URL', 'X-API-Key', 'Cache-Control']
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));
app.use(express.json({ limit: '5mb' }));

// ============================================
// Authentication
// ============================================

const auth = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.apiKey;
    if (!API_KEY) return res.status(503).json({ error: 'MCP_API_KEY not configured' });
    if (!key) return res.status(403).json({ error: 'API key required' });

    // timingSafeEqual requires same length buffers
    const keyBuf = Buffer.from(key);
    const apiBuf = Buffer.from(API_KEY);
    if (keyBuf.length !== apiBuf.length || !crypto.timingSafeEqual(keyBuf, apiBuf)) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    next();
};

// ============================================
// Database Helpers
// ============================================

const createPool = (url) => new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30000 });
const validUrl = (url) => { try { return new URL(url).protocol.startsWith('postgres'); } catch { return false; } };
const validId = (name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
const checkWrites = () => { if (!ENABLE_WRITES) throw new Error('Write operations disabled. Set ENABLE_WRITES=true'); };

// ============================================
// MCP Tools Definition (matches official SDK format)
// ============================================

const MCP_TOOLS = [
    { name: 'query', description: 'Execute SQL query', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'SQL query' } }, required: ['query'] } },
    { name: 'list_databases', description: 'List all databases', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_tables', description: 'List tables in schema', inputSchema: { type: 'object', properties: { schema: { type: 'string', default: 'public' } } } },
    { name: 'describe_table', description: 'Get table schema', inputSchema: { type: 'object', properties: { table: { type: 'string' }, schema: { type: 'string', default: 'public' } }, required: ['table'] } },
    { name: 'create_table', description: 'Create table', inputSchema: { type: 'object', properties: { table: { type: 'string' }, columns: { type: 'string' }, schema: { type: 'string', default: 'public' } }, required: ['table', 'columns'] } },
    { name: 'drop_table', description: 'Drop table', inputSchema: { type: 'object', properties: { table: { type: 'string' }, schema: { type: 'string', default: 'public' }, cascade: { type: 'boolean', default: false } }, required: ['table'] } },
    { name: 'list_extensions', description: 'List extensions', inputSchema: { type: 'object', properties: {} } },
    { name: 'enable_extension', description: 'Enable extension (e.g., vector)', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'create_function', description: 'Create function', inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'string', default: '' }, returns: { type: 'string' }, body: { type: 'string' }, language: { type: 'string', default: 'plpgsql' }, replace: { type: 'boolean', default: true }, schema: { type: 'string', default: 'public' } }, required: ['name', 'returns', 'body'] } },
    { name: 'drop_function', description: 'Drop function', inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'string', default: '' }, schema: { type: 'string', default: 'public' } }, required: ['name'] } },
    { name: 'create_index', description: 'Create index', inputSchema: { type: 'object', properties: { name: { type: 'string' }, table: { type: 'string' }, columns: { type: 'string' }, unique: { type: 'boolean', default: false }, method: { type: 'string', default: 'btree' }, schema: { type: 'string', default: 'public' } }, required: ['name', 'table', 'columns'] } },
    { name: 'drop_index', description: 'Drop index', inputSchema: { type: 'object', properties: { name: { type: 'string' }, schema: { type: 'string', default: 'public' } }, required: ['name'] } },
    { name: 'insert', description: 'Insert row', inputSchema: { type: 'object', properties: { table: { type: 'string' }, data: { type: 'string', description: 'JSON object of column:value pairs' }, schema: { type: 'string', default: 'public' } }, required: ['table', 'data'] } },
    { name: 'update', description: 'Update rows', inputSchema: { type: 'object', properties: { table: { type: 'string' }, data: { type: 'string' }, where: { type: 'string' }, schema: { type: 'string', default: 'public' } }, required: ['table', 'data', 'where'] } },
    { name: 'delete', description: 'Delete rows', inputSchema: { type: 'object', properties: { table: { type: 'string' }, where: { type: 'string' }, schema: { type: 'string', default: 'public' } }, required: ['table', 'where'] } },
    { name: 'server_version', description: 'Get PostgreSQL version', inputSchema: { type: 'object', properties: {} } },
];

// ============================================
// Tool Execution
// ============================================

async function executeTool(dbUrl, toolName, args) {
    const pool = createPool(dbUrl);
    const s = args.schema || 'public';

    try {
        switch (toolName) {
            case 'query': {
                if (!ENABLE_WRITES && /^(insert|update|delete|drop|truncate|alter|create|grant|revoke)\s/i.test(args.query.trim())) {
                    throw new Error('Write operations disabled');
                }
                const r = await pool.query(args.query);
                return { rows: r.rows, rowCount: r.rowCount };
            }
            case 'list_databases': {
                const r = await pool.query("SELECT datname, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database WHERE datistemplate = false");
                return { databases: r.rows };
            }
            case 'list_tables': {
                const r = await pool.query(`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [s]);
                return { tables: r.rows };
            }
            case 'describe_table': {
                if (!validId(args.table)) throw new Error('Invalid table name');
                const cols = await pool.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [s, args.table]);
                const cons = await pool.query(`SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema = $1 AND table_name = $2`, [s, args.table]);
                return { columns: cols.rows, constraints: cons.rows };
            }
            case 'create_table': {
                checkWrites();
                if (!validId(args.table)) throw new Error('Invalid table name');
                await pool.query(`CREATE TABLE "${s}"."${args.table}" (${args.columns})`);
                return { success: true, message: `Table ${args.table} created` };
            }
            case 'drop_table': {
                checkWrites();
                if (!validId(args.table)) throw new Error('Invalid table name');
                await pool.query(`DROP TABLE IF EXISTS "${s}"."${args.table}" ${args.cascade ? 'CASCADE' : ''}`);
                return { success: true, message: `Table ${args.table} dropped` };
            }
            case 'list_extensions': {
                const installed = await pool.query("SELECT extname, extversion FROM pg_extension");
                const available = await pool.query("SELECT name, comment FROM pg_available_extensions WHERE installed_version IS NULL LIMIT 50");
                return { installed: installed.rows, available: available.rows };
            }
            case 'enable_extension': {
                checkWrites();
                if (!validId(args.name)) throw new Error('Invalid extension name');
                await pool.query(`CREATE EXTENSION IF NOT EXISTS "${args.name}"`);
                return { success: true, message: `Extension ${args.name} enabled` };
            }
            case 'create_function': {
                checkWrites();
                if (!validId(args.name)) throw new Error('Invalid function name');
                const replaceStr = args.replace ? "OR REPLACE" : "";
                await pool.query(`CREATE ${replaceStr} FUNCTION "${s}"."${args.name}"(${args.args || ''}) RETURNS ${args.returns} LANGUAGE ${args.language || 'plpgsql'} AS $$ ${args.body} $$`);
                return { success: true, message: `Function ${args.name} created` };
            }
            case 'drop_function': {
                checkWrites();
                if (!validId(args.name)) throw new Error('Invalid function name');
                await pool.query(`DROP FUNCTION IF EXISTS "${s}"."${args.name}"(${args.args || ''})`);
                return { success: true, message: `Function ${args.name} dropped` };
            }
            case 'create_index': {
                checkWrites();
                if (!validId(args.name) || !validId(args.table)) throw new Error('Invalid name');
                const uniqueStr = args.unique ? "UNIQUE" : "";
                await pool.query(`CREATE ${uniqueStr} INDEX "${args.name}" ON "${s}"."${args.table}" USING ${args.method || 'btree'} (${args.columns})`);
                return { success: true, message: `Index ${args.name} created` };
            }
            case 'drop_index': {
                checkWrites();
                if (!validId(args.name)) throw new Error('Invalid index name');
                await pool.query(`DROP INDEX IF EXISTS "${s}"."${args.name}"`);
                return { success: true, message: `Index ${args.name} dropped` };
            }
            case 'insert': {
                checkWrites();
                if (!validId(args.table)) throw new Error('Invalid table name');
                const parsed = JSON.parse(args.data);
                const keys = Object.keys(parsed);
                const cols = keys.map(k => `"${k}"`).join(', ');
                const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
                const r = await pool.query(`INSERT INTO "${s}"."${args.table}" (${cols}) VALUES (${vals}) RETURNING *`, Object.values(parsed));
                return { inserted: r.rows[0] };
            }
            case 'update': {
                checkWrites();
                if (!validId(args.table) || !args.where) throw new Error('Invalid');
                const parsed = JSON.parse(args.data);
                const keys = Object.keys(parsed);
                const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
                const r = await pool.query(`UPDATE "${s}"."${args.table}" SET ${sets} WHERE ${args.where} RETURNING *`, Object.values(parsed));
                return { updated: r.rows, rowCount: r.rowCount };
            }
            case 'delete': {
                checkWrites();
                if (!validId(args.table) || !args.where) throw new Error('Invalid');
                const r = await pool.query(`DELETE FROM "${s}"."${args.table}" WHERE ${args.where} RETURNING *`);
                return { deleted: r.rows, rowCount: r.rowCount };
            }
            case 'server_version': {
                const r = await pool.query("SELECT version()");
                return { version: r.rows[0].version };
            }
            default: throw new Error(`Unknown tool: ${toolName}`);
        }
    } finally {
        await pool.end();
    }
}

// ============================================
// SSE Transport (MCP Protocol)
// ============================================

const sseConnections = new Map();

app.get('/sse', auth, (req, res) => {
    const dbUrl = req.headers['x-database-url'] || req.query.databaseUrl;
    if (!validUrl(dbUrl)) return res.status(400).json({ error: 'DATABASE_URL required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const id = crypto.randomUUID();
    sseConnections.set(id, { res, dbUrl });

    res.write(`event: connected\ndata: ${JSON.stringify({ connectionId: id, serverInfo: { name: 'postgres-mcp-server', version: '2.0.0' }, tools: MCP_TOOLS.length, writesEnabled: ENABLE_WRITES })}\n\n`);

    const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 30000);
    req.on('close', () => { clearInterval(ping); sseConnections.delete(id); });
});

// MCP JSON-RPC endpoint
app.post('/mcp/message', auth, async (req, res) => {
    const { connectionId, method, params, id } = req.body;
    const dbUrl = req.headers['x-database-url'] || req.body.databaseUrl || sseConnections.get(connectionId)?.dbUrl;

    try {
        let result;
        switch (method) {
            case 'initialize':
                result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'postgres-mcp-server', version: '2.0.0' } };
                break;
            case 'tools/list':
                result = { tools: MCP_TOOLS };
                break;
            case 'tools/call':
                if (!validUrl(dbUrl)) throw new Error('DATABASE_URL required');
                const toolResult = await executeTool(dbUrl, params.name, params.arguments || {});
                result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
                break;
            default:
                throw new Error(`Unknown method: ${method}`);
        }

        const response = { jsonrpc: '2.0', id, result };
        const conn = sseConnections.get(connectionId);
        if (conn) conn.res.write(`event: response\ndata: ${JSON.stringify(response)}\n\n`);
        res.json(response);
    } catch (e) {
        const errorResponse = { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
        res.json(errorResponse);
    }
});

// REST API endpoints
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0.0', tools: MCP_TOOLS.length, writesEnabled: ENABLE_WRITES }));

app.post('/tools/:tool', auth, async (req, res) => {
    const dbUrl = req.headers['x-database-url'] || req.body.databaseUrl;
    if (!validUrl(dbUrl)) return res.status(400).json({ error: 'DATABASE_URL required' });
    try {
        const result = await executeTool(dbUrl, req.params.tool, req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// Streamable HTTP Transport (MCP Powers Compatible)
// Single endpoint for both SSE and JSON-RPC
// ============================================

// GET /mcp - SSE stream for server-to-client messages
app.get('/mcp', auth, (req, res) => {
    const dbUrl = req.headers['x-database-url'] || req.query.databaseUrl;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const id = crypto.randomUUID();
    sseConnections.set(id, { res, dbUrl });

    // Send endpoint info for client to POST to
    res.write(`event: endpoint\ndata: ${JSON.stringify({ endpoint: `/mcp?sessionId=${id}` })}\n\n`);

    const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 30000);
    req.on('close', () => { clearInterval(ping); sseConnections.delete(id); });
});

// POST /mcp - JSON-RPC messages from client
app.post('/mcp', auth, async (req, res) => {
    const { method, params, id } = req.body;
    const sessionId = req.query.sessionId;
    const dbUrl = req.headers['x-database-url'] || req.body.databaseUrl || sseConnections.get(sessionId)?.dbUrl;

    try {
        let result;
        switch (method) {
            case 'initialize':
                result = {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'postgres-mcp-server', version: '2.0.0' }
                };
                break;
            case 'tools/list':
                result = { tools: MCP_TOOLS };
                break;
            case 'tools/call':
                if (!validUrl(dbUrl)) throw new Error('DATABASE_URL required via X-Database-URL header');
                const toolResult = await executeTool(dbUrl, params.name, params.arguments || {});
                result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
                break;
            case 'notifications/initialized':
                result = {};
                break;
            default:
                throw new Error(`Unknown method: ${method}`);
        }

        res.json({ jsonrpc: '2.0', id, result });
    } catch (e) {
        res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`
╔══════════════════════════════════════════════════════════════╗
║  PostgreSQL MCP Server v2.0.0 (HTTP Transport)               ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(54)}║
║  Auth: ${(API_KEY ? '✓ API Key' : '✗ DISABLED').padEnd(54)}║
║  Writes: ${(ENABLE_WRITES ? '✓ Enabled' : '✗ Disabled').padEnd(52)}║
║  Tools: ${String(MCP_TOOLS.length).padEnd(54)}║
╚══════════════════════════════════════════════════════════════╝
`));
