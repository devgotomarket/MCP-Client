import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline";

dotenv.config();

interface MCPClientConfig {
  name?: string;
  version?: string;
}

class MCPClient {
  private client: Client | null = null;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;

  constructor(config: MCPClientConfig = {}) {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    this.openai = new OpenAI({ apiKey });
  }

  async connectToServer(serverScriptPath: string): Promise<void> {
    console.log(`Connecting to server at: ${serverScriptPath}`);
    
    const isPython = serverScriptPath.endsWith(".py");
    const isJs = serverScriptPath.endsWith(".js");

    if (!isPython && !isJs) {
      throw new Error("Server script must be a .py or .js file");
    }

    const command = isPython ? "python" : "node";
    console.log(`Using command: ${command}`);

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });
    console.log("Transport created");

    this.client = new Client(
      {
        name: "openai-mcp-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    console.log("Client created");

    await this.client.connect(this.transport);
    console.log("Client connected to transport");

    const response = await this.client.request(
      { method: "tools/list" },
      ListToolsResultSchema
    );

    console.log(
      "\nConnected to server with tools:",
      response.tools.map((tool: any) => tool.name)
    );
  }

  async processQuery(query: string): Promise<string> {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    let messages = [
      {
        role: "system",
        content: "You are a helpful assistant that can use tools."
      },
      {
        role: "user",
        content: query,
      },
    ];

    // Get available tools from the server
    const toolsResponse = await this.client.request(
      { method: "tools/list" },
      ListToolsResultSchema
    );

    // Format tools for OpenAI
    // Format tools for OpenAI
    const availableTools = toolsResponse.tools.map((tool: any) => ({
    type: "function" as const,  // Add 'as const' to make the type literal
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema
    }
  }));

    const finalText: string[] = [];
    
    try {
      // Initial OpenAI API call
      console.log("Sending query to OpenAI...");
      let currentResponse = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL,
        messages: messages as any,
        tools: availableTools as any,  // Cast to any if TypeScript still complains
        tool_choice: "auto" as const,  // Add 'as const' here too
      });
      
      // Process the response
      const responseMessage = currentResponse.choices[0].message;
      
      // Add the assistant's message to the conversation
      messages.push(responseMessage as any);
      
      // Handle text response
      if (responseMessage.content) {
        finalText.push(responseMessage.content);
      }
      
      // Handle tool calls
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
          finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
          
          // Execute the tool call through MCP
          try {
            console.log(`Executing tool: ${toolName}`);
            const result = await this.client.request(
              {
                method: "tools/call",
                params: {
                  name: toolName,
                  arguments: toolArgs,
                },
              },
              CallToolResultSchema
            );
            
            // Format the tool response
            let toolResultText = "";
            if (Array.isArray(result.content)) {
              toolResultText = result.content
                .filter(item => item.type === "text")
                .map(item => item.text)
                .join("\n");
            } else {
              toolResultText = JSON.stringify(result.content);
            }
            
            // Add the tool response to the conversation
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: toolResultText,
            } as any);
            
            // Get the next response from OpenAI with the tool result
            const nextResponse = await this.openai.chat.completions.create({
              model: process.env.OPENAI_MODEL,
              messages: messages as any,
              tools: availableTools,
              tool_choice: "auto",
            });
            
            const nextMessage = nextResponse.choices[0].message;
            
            if (nextMessage.content) {
              finalText.push(nextMessage.content);
            }
            
            // If there are more tool calls, we would need to process them recursively
            // For simplicity in this example, we'll just note additional tool calls
            if (nextMessage.tool_calls && nextMessage.tool_calls.length > 0) {
              finalText.push(`[Additional tool calls detected]`);
              
              // This would be where you'd recursively process additional tool calls
              // For a complete implementation, you'd need a recursive function
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            finalText.push(`[Error calling tool: ${errorMessage}]`);
            console.error(`Error calling tool ${toolName}:`, error);
          }
        }
      }
      
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        console.error("OpenAI API Error:", error.status, error.message);
        console.error(error.code, error.type);
        return `Error: ${error.message}`;
      } else {
        console.error("Unexpected error:", error);
        return `Unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    return finalText.join("\n");
  }

  async chatLoop(): Promise<void> {
    console.log("\nMCP Client Started!");
    console.log("Type your queries or 'quit' to exit.");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      rl.question("\nQuery: ", async (query: string) => {
        try {
          if (query.toLowerCase() === "quit") {
            await this.cleanup();
            rl.close();
            return;
          }

          const response = await this.processQuery(query);
          console.log("\n" + response);
          askQuestion();
        } catch (error) {
          console.error("\nError:", error);
          askQuestion();
        }
      });
    };

    askQuestion();
  }

  async cleanup(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
  }
}

// Main execution function
export async function main() {
  console.log("OpenAI MCP Client is starting..."); 
  
  if (process.argv.length < 3) {
    console.log("Usage: node build/openai-client.js <path_to_server_script>");
    process.exit(1);
  }

  const client = new MCPClient();
  try {
    console.log(`Attempting to connect to server at: ${process.argv[2]}`);
    await client.connectToServer(process.argv[2]);
    console.log("Successfully connected to server, starting chat loop");
    await client.chatLoop();
  } catch (error) {
    console.error("Error:", error);
    await client.cleanup();
    process.exit(1);
  }
}

// Entry point
if (process.argv[1]?.includes('openai-client')) {
  console.log("Auto-starting main function");
  main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
}

export default MCPClient;