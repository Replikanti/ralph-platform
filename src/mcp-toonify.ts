#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// TOON Converter Logic
function jsonToToon(obj: any, indent = 0): string {
    const spaces = " ".repeat(indent);
    
    if (obj === null) return "null";
    if (obj === undefined) return "undefined";
    
    if (Array.isArray(obj)) {
        // Simple list: item1, item2
        if (obj.every(i => typeof i !== 'object' || i === null)) {
            return obj.join(", ");
        }
        // Complex list
        return obj.map(i => jsonToToon(i, indent)).join("\n");
    }
    
    if (typeof obj === 'object') {
        return Object.entries(obj).map(([k, v]) => {
            if (Array.isArray(v) && v.every(i => typeof i !== 'object')) {
                return `${spaces}${k}: ${v.join(", ")}`;
            }
            if (typeof v === 'object' && v !== null) {
                return `${spaces}${k}:\n${jsonToToon(v, indent + 2)}`;
            }
            return `${spaces}${k}: ${v}`;
        }).join("\n");
    }
    
    return String(obj);
}

// Server Setup
const server = new Server(
    {
        name: "ralph-toonify",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "toonify",
                description: "Optimizes JSON content into TOON format to save tokens. Use this for large data structures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: {
                            type: "string",
                            description: "JSON string or text content to optimize",
                        },
                    },
                    required: ["content"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "toonify") {
        const content = request.params.arguments?.content as string;
        try {
            // Try to parse as JSON first
            const json = JSON.parse(content);
            const toon = jsonToToon(json);
            return {
                content: [{ type: "text", text: toon }],
            };
        } catch {
            // If not JSON, return as is (or apply basic compression)
            return {
                content: [{ type: "text", text: content }],
            };
        }
    }
    throw new Error("Tool not found");
});

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

run().catch(console.error);
