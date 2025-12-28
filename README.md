# PostgreSQL MCP Server v2.0

**Deployed at: https://pgmcp.dependifyllc.com**

Official MCP SDK implementation with **16 database tools**.

## Two Transport Options

| File | Transport | Use Case |
|------|-----------|----------|
| `server.js` | stdio | Claude Desktop, local MCP clients |
| `server-http.js` | HTTP/SSE | Remote deployment (Coolify) |

## Quick Start (Local/stdio)

```bash
npm install
DATABASE_URL=postgres://... ENABLE_WRITES=true node server.js
```

## Production Deployment (Coolify)

The server is deployed at **https://pgmcp.dependifyllc.com**

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `MCP_API_KEY` | API key for authentication |
| `ENABLE_WRITES` | Set `true` to allow write operations |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) |
| `PORT` | HTTP port (default: 3000) |

## Available Tools

| Tool | Description |
|------|-------------|
| `query` | Execute SQL (read-only unless ENABLE_WRITES) |
| `list_databases` | List all databases |
| `list_tables` | List tables in schema |
| `describe_table` | Get table columns & constraints |
| `create_table` | Create new table |
| `drop_table` | Drop table |
| `list_extensions` | List installed/available extensions |
| `enable_extension` | Enable extension (pgvector, uuid-ossp) |
| `create_function` | Create PL/pgSQL function |
| `drop_function` | Drop function |
| `create_index` | Create index (btree, hnsw, ivfflat) |
| `drop_index` | Drop index |
| `insert` | Insert row |
| `update` | Update rows |
| `delete` | Delete rows |
| `server_version` | Get PostgreSQL version |

## API Usage

### Health Check
```bash
curl https://pgmcp.dependifyllc.com/health
```

### MCP Protocol (tools/list)
```bash
curl -X POST https://pgmcp.dependifyllc.com/mcp/message \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Execute Query
```bash
curl -X POST https://pgmcp.dependifyllc.com/mcp/message \
  -H "X-API-Key: YOUR_KEY" \
  -H "X-Database-URL: postgres://..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tables","arguments":{}}}'
```

## Claude Desktop Config (stdio)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "DATABASE_URL": "postgres://...",
        "ENABLE_WRITES": "true"
      }
    }
  }
}
```

## Kiro Power Config (HTTP)

Uses environment variables in `.env.local`:
```bash
POSTGRES_MCP_URL=https://pgmcp.dependifyllc.com
MCP_API_KEY=your-api-key
DATABASE_URL=postgres://...
```
