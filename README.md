# PostgreSQL MCP Server v2.0

**Deployed at: https://pgmcp.dependifyllc.com**

Official MCP SDK implementation with **16 database tools**.

---

## SSE Transport (Primary)

The recommended way to connect is via Server-Sent Events (SSE).

### SSE Connection URL

```
https://pgmcp.dependifyllc.com/sse?apiKey=YOUR_API_KEY&databaseUrl=YOUR_DATABASE_URL
```

### JavaScript Example

```javascript
const apiKey = 'your-api-key';
const dbUrl = encodeURIComponent('postgres://user:pass@host:5432/db?sslmode=require');
const url = `https://pgmcp.dependifyllc.com/sse?apiKey=${apiKey}&databaseUrl=${dbUrl}`;

const eventSource = new EventSource(url);

eventSource.onopen = () => console.log('Connected to MCP server');

eventSource.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('Connection ID:', data.connectionId);
  console.log('Tools available:', data.tools);
});

eventSource.addEventListener('response', (e) => {
  const response = JSON.parse(e.data);
  console.log('Response:', response);
});

eventSource.onerror = (e) => console.error('SSE Error:', e);
```

### Sending MCP Messages

After establishing SSE connection, send messages via POST:

```javascript
async function callTool(connectionId, toolName, args) {
  const response = await fetch('https://pgmcp.dependifyllc.com/mcp/message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'your-api-key',
      'X-Database-URL': 'postgres://...'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      connectionId: connectionId,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  return response.json();
}

// Example: List tables
callTool(connectionId, 'list_tables', {});
```

### SSE Events

| Event | Description |
|-------|-------------|
| `connected` | Initial connection with `connectionId`, `tools` count |
| `response` | Response to MCP message |
| `ping` | Keep-alive (every 30s) |

---

## REST API (Alternative)

For simple requests without persistent connection.

### Health Check
```bash
curl https://pgmcp.dependifyllc.com/health
```

### List Tools
```bash
curl -X POST https://pgmcp.dependifyllc.com/mcp/message \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Execute Tool
```bash
curl -X POST https://pgmcp.dependifyllc.com/mcp/message \
  -H "X-API-Key: YOUR_KEY" \
  -H "X-Database-URL: postgres://..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tables","arguments":{}}}'
```

---

## Available Tools (16)

| Tool | Description |
|------|-------------|
| `query` | Execute SQL |
| `list_databases` | List all databases |
| `list_tables` | List tables in schema |
| `describe_table` | Get columns & constraints |
| `create_table` | Create new table |
| `drop_table` | Drop table |
| `list_extensions` | List extensions |
| `enable_extension` | Enable extension (pgvector) |
| `create_function` | Create PL/pgSQL function |
| `drop_function` | Drop function |
| `create_index` | Create index (btree, hnsw) |
| `drop_index` | Drop index |
| `insert` | Insert row |
| `update` | Update rows |
| `delete` | Delete rows |
| `server_version` | Get PostgreSQL version |

---

## Environment Variables (Coolify)

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_KEY` | Yes | API key for authentication |
| `ENABLE_WRITES` | Yes | Set `true` for write operations |
| `ALLOWED_ORIGINS` | No | CORS origins |
| `PORT` | No | Default: 3000 |

---

## MCP Powers Configuration

Add to your `mcp.json` or IDE MCP config:

```json
{
  "mcpServers": {},
  "powers": {
    "mcpServers": {
      "power-postgres-mcp": {
        "url": "https://pgmcp.dependifyllc.com/sse",
        "headers": {
          "X-API-Key": "${MCP_API_KEY}",
          "X-Database-URL": "${DATABASE_URL}"
        }
      }
    }
  }
}
```

---

## Environment Variables

In your project `.env.local`:
```bash
POSTGRES_MCP_URL=https://pgmcp.dependifyllc.com
MCP_API_KEY=your-api-key
DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
```
