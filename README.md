
# MCP Client (OpenAI and Claude)

This repo contains two separate MCP clients — one is MCP Client with OpenAI Integration and another one is with Claude Integration — that can connect to local MCP server and handle interactions. The client uses standard input/output (stdio) to talk to the MCP server.

---

## Directory Structure

```
.
├── .git/
├── src/
│   ├── mcp-client-openai.ts
│   └── mcp-client-claude.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Setup Instructions

### 1. Install dependencies

```bash
npm install
```

### 2. Compile TypeScript

```bash
npm run build
```

This will generate the compiled JS files under the `build/` directory.

---

## Running the Client

Make sure your `.env` file is set up with the appropriate API key depending on the client:

```env
# For OpenAI
OPENAI_API_KEY=your_openai_key_here

OPENAI_MODEL=openai_model ex:(gpt-4o)

# For Claude
ANTHROPIC_API_KEY=your_anthropic_key_here

ANTHROPIC_MODEL=anthropic_model ex:(claude-3-5-sonnet-20241022)
```

---

### Run OpenAI Client

```bash
node build/mcp-client-openai.js path/to/server.py
```

### Run Claude Client

```bash
node build/mcp-client-claude.js path/to/server.py
```

Replace `path/to/server.py` with the path to the MCP server script you want to connect to — it can be local or remote.

---

## Notes

- You can use either `.py` (Python) or `.js` (Node) server scripts.
- The client will automatically detect the type and establish the transport.
- Tool results and LLM responses are streamed in an interactive prompt.

---

