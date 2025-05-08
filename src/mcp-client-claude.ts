
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline";

dotenv.config();

class MCPClient {
  private client: Client | null = null;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  async connectToServer(serverScriptPath: string): Promise<void> {
    const command = serverScriptPath.endsWith(".py") ? "python" : "node";

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });

    this.client = new Client({ name: "mcp-client", version: "1.0.0" }, { capabilities: {} });
    await this.client.connect(this.transport);

    const toolsResponse = await this.client.request(
      { method: "tools/list" },
      ListToolsResultSchema
    );

    console.log("Connected to server with tools:", toolsResponse.tools.map((tool: any) => tool.name));
  }

  formatTools(tools: any[]) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  async processQuery(query: string): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const toolsResponse = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
    const formattedTools = this.formatTools(toolsResponse.tools);

    let messages: any[] = [{ role: "user", content: query }];
    const textResponses: string[] = [];

    let response = await this.anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages,
      tools: formattedTools,
    });

    while (true) {
      for (const content of response.content) {
        if (content.type === "text") {
          textResponses.push(content.text);
        } else if (content.type === "tool_use") {
          const toolResult = await this.client.request(
            { method: "tools/call", params: { name: content.name, args: content.input } },
            CallToolResultSchema
          );

          messages.push({ role: "assistant", content: response.content });
          messages.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: content.id,
              content: [{ type: "text", text: JSON.stringify(toolResult.content) }],
            }],
          });

          response = await this.anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages,
            tools: formattedTools,
          });

          if (response.content[0]?.type === "text") {
            textResponses.push(response.content[0].text);
          }

          continue;
        }
      }
      break;
    }

    return textResponses.join("\n");
  }

  async chatLoop(): Promise<void> {
    console.log("\nMCP Client Started! Type your queries or 'quit' to exit.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const ask = () => {
      rl.question("\nQuery: ", async (query) => {
        if (query.toLowerCase() === "quit") {
          await this.cleanup();
          rl.close();
          return;
        }
        const response = await this.processQuery(query);
        console.log("\n" + response);
        ask();
      });
    };

    ask();
  }

  async cleanup(): Promise<void> {
    if (this.transport) await this.transport.close();
  }
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.log("Usage: ts-node client.ts <server_script>");
    process.exit(1);
  }

  const client = new MCPClient();
  await client.connectToServer(path);
  await client.chatLoop();
}

main();
