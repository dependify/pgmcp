#!/usr/bin/env node
/**
 * PostgreSQL MCP Server (Official SDK - stdio transport)
 * 
 * This server uses the official @modelcontextprotocol/sdk
 * with stdio transport for use with Claude Desktop and other MCP clients.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... node server.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";
import 'dotenv/config';

const { Pool } = pg;

// ============================================
// Configuration
// ============================================

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLE_WRITES = process.env.ENABLE_WRITES === 'true';

if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

// Create server instance
const server = new McpServer({
    name: "postgres-mcp-server",
    version: "2.0.0",
});

// ============================================
// Database Helpers
// ============================================

const createPool = () => new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000
});

const validId = (name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
const checkWrites = () => { if (!ENABLE_WRITES) throw new Error('Write operations disabled. Set ENABLE_WRITES=true'); };

// ============================================
// Register Tools
// ============================================

// Query tool
server.registerTool(
    "query",
    {
        description: "Execute a SQL query (read-only unless ENABLE_WRITES=true)",
        inputSchema: {
            query: z.string().describe("SQL query to execute"),
        },
    },
    async ({ query }) => {
        if (!ENABLE_WRITES) {
            const normalized = query.toLowerCase().trim();
            if (/^(insert|update|delete|drop|truncate|alter|create|grant|revoke)\s/i.test(normalized)) {
                return { content: [{ type: "text", text: "Error: Write operations disabled. Set ENABLE_WRITES=true" }] };
            }
        }
        const pool = createPool();
        try {
            const result = await pool.query(query);
            return { content: [{ type: "text", text: JSON.stringify({ rows: result.rows, rowCount: result.rowCount }, null, 2) }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// List databases
server.registerTool(
    "list_databases",
    {
        description: "List all databases",
        inputSchema: {},
    },
    async () => {
        const pool = createPool();
        try {
            const result = await pool.query("SELECT datname, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database WHERE datistemplate = false");
            return { content: [{ type: "text", text: JSON.stringify({ databases: result.rows }, null, 2) }] };
        } finally {
            await pool.end();
        }
    }
);

// List tables
server.registerTool(
    "list_tables",
    {
        description: "List all tables in a schema",
        inputSchema: {
            schema: z.string().default("public").describe("Schema name (default: public)"),
        },
    },
    async ({ schema = "public" }) => {
        const pool = createPool();
        try {
            const result = await pool.query(`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [schema]);
            return { content: [{ type: "text", text: JSON.stringify({ tables: result.rows }, null, 2) }] };
        } finally {
            await pool.end();
        }
    }
);

// Describe table
server.registerTool(
    "describe_table",
    {
        description: "Get detailed table schema including columns and constraints",
        inputSchema: {
            table: z.string().describe("Table name"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ table, schema = "public" }) => {
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        const pool = createPool();
        try {
            const cols = await pool.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, table]);
            const cons = await pool.query(`SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema = $1 AND table_name = $2`, [schema, table]);
            return { content: [{ type: "text", text: JSON.stringify({ columns: cols.rows, constraints: cons.rows }, null, 2) }] };
        } finally {
            await pool.end();
        }
    }
);

// Create table
server.registerTool(
    "create_table",
    {
        description: "Create a new table",
        inputSchema: {
            table: z.string().describe("Table name"),
            columns: z.string().describe("Column definitions (e.g., 'id SERIAL PRIMARY KEY, name TEXT NOT NULL')"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ table, columns, schema = "public" }) => {
        checkWrites();
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        const pool = createPool();
        try {
            await pool.query(`CREATE TABLE "${schema}"."${table}" (${columns})`);
            return { content: [{ type: "text", text: `Table ${table} created successfully` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Drop table
server.registerTool(
    "drop_table",
    {
        description: "Drop a table",
        inputSchema: {
            table: z.string().describe("Table name"),
            schema: z.string().default("public").describe("Schema name"),
            cascade: z.boolean().default(false).describe("Drop dependent objects"),
        },
    },
    async ({ table, schema = "public", cascade = false }) => {
        checkWrites();
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        const pool = createPool();
        try {
            await pool.query(`DROP TABLE IF EXISTS "${schema}"."${table}" ${cascade ? 'CASCADE' : ''}`);
            return { content: [{ type: "text", text: `Table ${table} dropped successfully` }] };
        } finally {
            await pool.end();
        }
    }
);

// List extensions
server.registerTool(
    "list_extensions",
    {
        description: "List installed and available extensions",
        inputSchema: {},
    },
    async () => {
        const pool = createPool();
        try {
            const installed = await pool.query("SELECT extname, extversion FROM pg_extension");
            const available = await pool.query("SELECT name, comment FROM pg_available_extensions WHERE installed_version IS NULL LIMIT 50");
            return { content: [{ type: "text", text: JSON.stringify({ installed: installed.rows, available: available.rows }, null, 2) }] };
        } finally {
            await pool.end();
        }
    }
);

// Enable extension (e.g., pgvector)
server.registerTool(
    "enable_extension",
    {
        description: "Enable a PostgreSQL extension (e.g., vector, uuid-ossp, pg_trgm)",
        inputSchema: {
            name: z.string().describe("Extension name (e.g., 'vector' for pgvector)"),
        },
    },
    async ({ name }) => {
        checkWrites();
        if (!validId(name)) return { content: [{ type: "text", text: "Error: Invalid extension name" }] };
        const pool = createPool();
        try {
            await pool.query(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
            return { content: [{ type: "text", text: `Extension ${name} enabled successfully` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Create function
server.registerTool(
    "create_function",
    {
        description: "Create a PostgreSQL function",
        inputSchema: {
            name: z.string().describe("Function name"),
            args: z.string().default("").describe("Function arguments (e.g., 'user_id INT')"),
            returns: z.string().describe("Return type (e.g., 'TEXT', 'TABLE(id INT, name TEXT)')"),
            body: z.string().describe("Function body (PL/pgSQL)"),
            language: z.string().default("plpgsql").describe("Language (plpgsql, sql)"),
            replace: z.boolean().default(true).describe("Use CREATE OR REPLACE"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ name, args = "", returns, body, language = "plpgsql", replace = true, schema = "public" }) => {
        checkWrites();
        if (!validId(name)) return { content: [{ type: "text", text: "Error: Invalid function name" }] };
        const pool = createPool();
        try {
            const replaceStr = replace ? "OR REPLACE" : "";
            await pool.query(`CREATE ${replaceStr} FUNCTION "${schema}"."${name}"(${args}) RETURNS ${returns} LANGUAGE ${language} AS $$ ${body} $$`);
            return { content: [{ type: "text", text: `Function ${name} created successfully` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Drop function
server.registerTool(
    "drop_function",
    {
        description: "Drop a PostgreSQL function",
        inputSchema: {
            name: z.string().describe("Function name"),
            args: z.string().default("").describe("Function argument types to match signature"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ name, args = "", schema = "public" }) => {
        checkWrites();
        if (!validId(name)) return { content: [{ type: "text", text: "Error: Invalid function name" }] };
        const pool = createPool();
        try {
            await pool.query(`DROP FUNCTION IF EXISTS "${schema}"."${name}"(${args})`);
            return { content: [{ type: "text", text: `Function ${name} dropped successfully` }] };
        } finally {
            await pool.end();
        }
    }
);

// Create index
server.registerTool(
    "create_index",
    {
        description: "Create an index (supports btree, hash, gin, gist, hnsw, ivfflat for vectors)",
        inputSchema: {
            name: z.string().describe("Index name"),
            table: z.string().describe("Table name"),
            columns: z.string().describe("Column(s) to index (e.g., 'email' or 'embedding vector_l2_ops')"),
            unique: z.boolean().default(false).describe("Create unique index"),
            method: z.string().default("btree").describe("Index method (btree, hash, gin, gist, hnsw, ivfflat)"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ name, table, columns, unique = false, method = "btree", schema = "public" }) => {
        checkWrites();
        if (!validId(name) || !validId(table)) return { content: [{ type: "text", text: "Error: Invalid name" }] };
        const pool = createPool();
        try {
            const uniqueStr = unique ? "UNIQUE" : "";
            await pool.query(`CREATE ${uniqueStr} INDEX "${name}" ON "${schema}"."${table}" USING ${method} (${columns})`);
            return { content: [{ type: "text", text: `Index ${name} created successfully` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Drop index
server.registerTool(
    "drop_index",
    {
        description: "Drop an index",
        inputSchema: {
            name: z.string().describe("Index name"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ name, schema = "public" }) => {
        checkWrites();
        if (!validId(name)) return { content: [{ type: "text", text: "Error: Invalid index name" }] };
        const pool = createPool();
        try {
            await pool.query(`DROP INDEX IF EXISTS "${schema}"."${name}"`);
            return { content: [{ type: "text", text: `Index ${name} dropped successfully` }] };
        } finally {
            await pool.end();
        }
    }
);

// Insert data
server.registerTool(
    "insert",
    {
        description: "Insert a row into a table",
        inputSchema: {
            table: z.string().describe("Table name"),
            data: z.string().describe("JSON object of column:value pairs (e.g., '{\"name\": \"John\", \"email\": \"john@example.com\"}')"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ table, data, schema = "public" }) => {
        checkWrites();
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        const pool = createPool();
        try {
            const parsed = JSON.parse(data);
            const keys = Object.keys(parsed);
            const cols = keys.map(k => `"${k}"`).join(', ');
            const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
            const result = await pool.query(`INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${vals}) RETURNING *`, Object.values(parsed));
            return { content: [{ type: "text", text: JSON.stringify({ inserted: result.rows[0] }, null, 2) }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Update data
server.registerTool(
    "update",
    {
        description: "Update rows in a table",
        inputSchema: {
            table: z.string().describe("Table name"),
            data: z.string().describe("JSON object of column:value pairs to update"),
            where: z.string().describe("WHERE clause (required for safety)"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ table, data, where, schema = "public" }) => {
        checkWrites();
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        if (!where) return { content: [{ type: "text", text: "Error: WHERE clause required for safety" }] };
        const pool = createPool();
        try {
            const parsed = JSON.parse(data);
            const keys = Object.keys(parsed);
            const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
            const result = await pool.query(`UPDATE "${schema}"."${table}" SET ${sets} WHERE ${where} RETURNING *`, Object.values(parsed));
            return { content: [{ type: "text", text: JSON.stringify({ updated: result.rows, rowCount: result.rowCount }, null, 2) }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        } finally {
            await pool.end();
        }
    }
);

// Delete data
server.registerTool(
    "delete",
    {
        description: "Delete rows from a table",
        inputSchema: {
            table: z.string().describe("Table name"),
            where: z.string().describe("WHERE clause (required for safety)"),
            schema: z.string().default("public").describe("Schema name"),
        },
    },
    async ({ table, where, schema = "public" }) => {
        checkWrites();
        if (!validId(table)) return { content: [{ type: "text", text: "Error: Invalid table name" }] };
        if (!where) return { content: [{ type: "text", text: "Error: WHERE clause required for safety" }] };
        const pool = createPool();
        try {
            const result = await pool.query(`DELETE FROM "${schema}"."${table}" WHERE ${where} RETURNING *`);
            return { content: [{ type: "text", text: JSON.stringify({ deleted: result.rows, rowCount: result.rowCount }, null, 2) }] };
        } finally {
            await pool.end();
        }
    }
);

// Server version
server.registerTool(
    "server_version",
    {
        description: "Get PostgreSQL server version",
        inputSchema: {},
    },
    async () => {
        const pool = createPool();
        try {
            const result = await pool.query("SELECT version()");
            return { content: [{ type: "text", text: result.rows[0].version }] };
        } finally {
            await pool.end();
        }
    }
);

// ============================================
// Run Server
// ============================================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`PostgreSQL MCP Server v2.0.0 running on stdio`);
    console.error(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    console.error(`Writes: ${ENABLE_WRITES ? 'enabled' : 'disabled'}`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
