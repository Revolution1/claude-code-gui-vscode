/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Using 'any' for conversation message data where types are dynamic

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * Represents a single message in a conversation
 */
export interface ConversationMessage {
    type: string;
    data?: any;
    timestamp?: string;
    [key: string]: unknown;
}

/**
 * Represents a complete conversation
 */
export interface Conversation {
    sessionId: string;
    startTime: string | undefined;
    endTime: string;
    messageCount: number;
    totalCost: number;
    totalTokens: {
        input: number;
        output: number;
    };
    messages: ConversationMessage[];
    filename: string;
}

/**
 * Represents an entry in the conversation index
 */
export interface ConversationIndexEntry {
    filename: string;
    sessionId: string;
    startTime: string;
    endTime: string;
    messageCount: number;
    totalCost: number;
    firstUserMessage: string;
    lastUserMessage: string;
}

/**
 * Options for saving a conversation
 */
export interface SaveConversationOptions {
    sessionId: string;
    totalCost: number;
    totalTokens: {
        input: number;
        output: number;
    };
}

/**
 * Service for managing conversation persistence
 * Handles saving, loading, and indexing conversations
 */
export class ConversationService implements vscode.Disposable {
    private _conversationsPath: string | undefined;
    private _conversationIndex: ConversationIndexEntry[] = [];
    private _currentConversation: ConversationMessage[] = [];
    private _conversationStartTime: string | undefined;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._initializeConversations();
        this._conversationIndex = this._context.workspaceState.get("claude.conversationIndex", []);
    }

    /**
     * Get the conversation index.
     * Merges extension-managed conversations with CLI session JSONL files.
     */
    public getConversationIndex(): ConversationIndexEntry[] {
        const cliSessions = this._readCLISessionIndex();
        if (cliSessions.length === 0) {
            return this._conversationIndex;
        }

        // Merge: CLI sessions take priority (by sessionId), then add extension-only entries
        const merged = new Map<string, ConversationIndexEntry>();
        for (const entry of cliSessions) {
            merged.set(entry.sessionId || entry.filename, entry);
        }
        for (const entry of this._conversationIndex) {
            const key = entry.sessionId || entry.filename;
            if (!merged.has(key)) {
                merged.set(key, entry);
            }
        }
        return Array.from(merged.values());
    }

    /**
     * Get the latest conversation from the index
     */
    public getLatestConversation(): ConversationIndexEntry | undefined {
        if (this._conversationIndex.length === 0) {
            return undefined;
        }
        return this._conversationIndex[this._conversationIndex.length - 1];
    }

    /**
     * Load a specific conversation by filename
     */
    public loadConversation(filename: string): Conversation | undefined {
        // Try extension-managed conversation files first
        if (this._conversationsPath) {
            try {
                const filePath = path.join(this._conversationsPath, filename);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, "utf8");
                    const conversation: Conversation = JSON.parse(content);
                    this._currentConversation = conversation.messages;
                    this._conversationStartTime = conversation.startTime;
                    return conversation;
                }
            } catch (error) {
                console.error("Error loading extension conversation:", error);
            }
        }

        // Try CLI session JSONL file (filename is the session ID)
        try {
            return this._loadCLISession(filename);
        } catch (error) {
            console.error("Error loading CLI session:", error);
            return undefined;
        }
    }

    /**
     * Load a CLI session JSONL file and convert it to Conversation format.
     */
    private _loadCLISession(sessionId: string): Conversation | undefined {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            return undefined;
        }

        const projectDirName = cwd.replace(/\//g, "-");
        const sessionPath = path.join(
            os.homedir(),
            ".claude",
            "projects",
            projectDirName,
            `${sessionId}.jsonl`,
        );

        if (!fs.existsSync(sessionPath)) {
            return undefined;
        }

        const content = fs.readFileSync(sessionPath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim());
        const messages: ConversationMessage[] = [];
        let startTime: string | undefined;
        let endTime = "";

        for (const line of lines) {
            try {
                const msg = JSON.parse(line);
                if (msg.type !== "user" && msg.type !== "assistant") {
                    continue;
                }

                if (!startTime && msg.timestamp) {
                    startTime = msg.timestamp;
                }
                if (msg.timestamp) {
                    endTime = msg.timestamp;
                }

                // Convert CLI message format to extension ConversationMessage format
                if (msg.type === "user" && msg.message?.content) {
                    const msgContent = msg.message.content;
                    let text = "";
                    if (typeof msgContent === "string") {
                        text = msgContent;
                    } else if (Array.isArray(msgContent)) {
                        const textBlock = msgContent.find(
                            (c: { type: string }) => c.type === "text",
                        );
                        text = textBlock?.text || "";
                    }
                    if (text.trim()) {
                        messages.push({
                            type: "userInput",
                            data: text,
                            timestamp: msg.timestamp,
                        });
                    }
                } else if (msg.type === "assistant" && msg.message?.content) {
                    const msgContent = msg.message.content;
                    if (Array.isArray(msgContent)) {
                        for (const block of msgContent) {
                            if (block.type === "text" && block.text?.trim()) {
                                messages.push({
                                    type: "output",
                                    data: block.text,
                                    text: block.text,
                                    timestamp: msg.timestamp,
                                });
                            } else if (block.type === "tool_use") {
                                messages.push({
                                    type: "toolUse",
                                    data: {
                                        toolName: block.name,
                                        rawInput: block.input,
                                    },
                                    toolName: block.name,
                                    rawInput: block.input,
                                    timestamp: msg.timestamp,
                                });
                            }
                        }
                    }
                }
            } catch {
                // Skip unparseable lines
            }
        }

        if (messages.length === 0) {
            return undefined;
        }

        this._currentConversation = messages;
        this._conversationStartTime = startTime;

        return {
            sessionId,
            startTime,
            endTime,
            messageCount: messages.length,
            totalCost: 0,
            totalTokens: { input: 0, output: 0 },
            messages,
            filename: sessionId,
        };
    }

    /**
     * Add a message to the current conversation
     */
    public addMessage(message: ConversationMessage): void {
        const timestamp = new Date().toISOString();
        this._currentConversation.push({
            ...message,
            timestamp,
        });

        if (!this._conversationStartTime) {
            this._conversationStartTime = timestamp;
        }
    }

    /**
     * Clear the current conversation
     */
    public clearCurrentConversation(): void {
        this._currentConversation = [];
        this._conversationStartTime = undefined;
    }

    /**
     * Get the current conversation messages
     */
    public getCurrentConversation(): ConversationMessage[] {
        return this._currentConversation;
    }

    /**
     * Save the current conversation to disk
     */
    public async saveCurrentConversation(options: SaveConversationOptions): Promise<void> {
        if (!this._conversationsPath || this._currentConversation.length === 0) {
            return;
        }

        try {
            const endTime = new Date().toISOString();
            const filename = `conversation-${endTime.replace(/[:.]/g, "-")}.json`;

            const conversation: Conversation = {
                sessionId: options.sessionId,
                startTime: this._conversationStartTime,
                endTime,
                messageCount: this._currentConversation.length,
                totalCost: options.totalCost,
                totalTokens: options.totalTokens,
                messages: this._currentConversation,
                filename,
            };

            // Write conversation file
            const filePath = path.join(this._conversationsPath, filename);
            const fileUri = vscode.Uri.file(filePath);
            const content = new TextEncoder().encode(JSON.stringify(conversation, null, 2));
            await vscode.workspace.fs.writeFile(fileUri, content);

            // Update index
            const firstUserMessage = this._findFirstUserMessage();
            const lastUserMessage = this._findLastUserMessage();

            const indexEntry: ConversationIndexEntry = {
                filename,
                sessionId: options.sessionId,
                startTime: this._conversationStartTime || endTime,
                endTime,
                messageCount: this._currentConversation.length,
                totalCost: options.totalCost,
                firstUserMessage,
                lastUserMessage,
            };

            // Check if we already have this session in the index and update it
            const existingIndex = this._conversationIndex.findIndex(
                (entry) => entry.sessionId === options.sessionId,
            );

            if (existingIndex >= 0) {
                this._conversationIndex[existingIndex] = indexEntry;
            } else {
                this._conversationIndex.push(indexEntry);
            }

            // Save index to workspace state
            await this._context.workspaceState.update(
                "claude.conversationIndex",
                this._conversationIndex,
            );

            console.log("Saved conversation:", filename);
        } catch (error) {
            console.error("Error saving conversation:", error);
        }
    }

    /**
     * Delete a conversation by filename
     */
    public async deleteConversation(filename: string): Promise<boolean> {
        if (!this._conversationsPath) {
            return false;
        }

        try {
            const filePath = path.join(this._conversationsPath, filename);
            const fileUri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.delete(fileUri);

            // Remove from index
            this._conversationIndex = this._conversationIndex.filter(
                (entry) => entry.filename !== filename,
            );
            await this._context.workspaceState.update(
                "claude.conversationIndex",
                this._conversationIndex,
            );

            return true;
        } catch (error) {
            console.error("Error deleting conversation:", error);
            return false;
        }
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        // Nothing to dispose
    }

    // ==================== Private Methods ====================

    /**
     * Read CLI session JSONL files from ~/.claude/projects/<project-dir>/
     * and build a conversation index from them.
     */
    private _readCLISessionIndex(): ConversationIndexEntry[] {
        try {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) {
                return [];
            }

            // CLI project directory: ~/.claude/projects/<cwd-with-dashes>
            // e.g. /home/user/code/myproject -> -home-user-code-myproject
            const projectDirName = cwd.replace(/\//g, "-");
            const projectPath = path.join(os.homedir(), ".claude", "projects", projectDirName);

            if (!fs.existsSync(projectPath)) {
                return [];
            }

            const files = fs.readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
            const entries: ConversationIndexEntry[] = [];

            for (const file of files) {
                try {
                    const entry = this._parseSessionFile(
                        path.join(projectPath, file),
                        file,
                    );
                    if (entry) {
                        entries.push(entry);
                    }
                } catch {
                    // Skip files that can't be parsed
                }
            }

            return entries;
        } catch (error) {
            console.log("[ConversationService] Error reading CLI sessions:", error);
            return [];
        }
    }

    /**
     * Parse a single CLI session JSONL file to extract index metadata.
     * Only reads the first and last few lines for efficiency.
     */
    private _parseSessionFile(
        filePath: string,
        filename: string,
    ): ConversationIndexEntry | null {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim());
        if (lines.length === 0) {
            return null;
        }

        let sessionId = "";
        let firstTimestamp = "";
        let lastTimestamp = "";
        let firstUserMessage = "";
        let lastUserMessage = "";
        let messageCount = 0;

        for (const line of lines) {
            try {
                const msg = JSON.parse(line);

                // Skip queue-operation and other meta messages
                if (msg.type !== "user" && msg.type !== "assistant") {
                    continue;
                }

                messageCount++;

                if (!sessionId && msg.sessionId) {
                    sessionId = msg.sessionId;
                }
                if (!firstTimestamp && msg.timestamp) {
                    firstTimestamp = msg.timestamp;
                }
                if (msg.timestamp) {
                    lastTimestamp = msg.timestamp;
                }

                // Extract user message text
                if (msg.type === "user" && msg.message?.content) {
                    const content = msg.message.content;
                    let text = "";
                    if (typeof content === "string") {
                        text = content;
                    } else if (Array.isArray(content)) {
                        const textBlock = content.find(
                            (c: { type: string }) => c.type === "text",
                        );
                        text = textBlock?.text || "";
                    }

                    // Skip empty/trivial prompts (e.g. "." used by UsageService)
                    if (text.trim() && text.trim() !== ".") {
                        if (!firstUserMessage) {
                            firstUserMessage = text.substring(0, 200);
                        }
                        lastUserMessage = text.substring(0, 200);
                    }
                }
            } catch {
                // Skip unparseable lines
            }
        }

        if (messageCount === 0 || !firstUserMessage) {
            return null;
        }

        return {
            filename: sessionId || filename.replace(".jsonl", ""),
            sessionId,
            startTime: firstTimestamp,
            endTime: lastTimestamp,
            messageCount,
            totalCost: 0,
            firstUserMessage,
            lastUserMessage,
        };
    }

    private async _initializeConversations(): Promise<void> {
        try {
            const storagePath = this._context.storageUri?.fsPath;
            if (!storagePath) {
                return;
            }

            this._conversationsPath = path.join(storagePath, "conversations");

            // Create conversations directory if it doesn't exist
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(this._conversationsPath));
            } catch {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(this._conversationsPath));
                console.log(`Created conversations directory at: ${this._conversationsPath}`);
            }
        } catch (error) {
            console.error("Failed to initialize conversations directory:", error);
        }
    }

    private _findFirstUserMessage(): string {
        for (const msg of this._currentConversation) {
            if (msg.type === "userInput" && msg.data) {
                const text = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
                return text.substring(0, 100) + (text.length > 100 ? "..." : "");
            }
        }
        return "";
    }

    private _findLastUserMessage(): string {
        for (let i = this._currentConversation.length - 1; i >= 0; i--) {
            const msg = this._currentConversation[i];
            if (msg.type === "userInput" && msg.data) {
                const text = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
                return text.substring(0, 100) + (text.length > 100 ? "..." : "");
            }
        }
        return "";
    }
}
