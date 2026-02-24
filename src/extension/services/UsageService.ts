/**
 * Usage Service
 *
 * Provides usage data from two sources:
 * 1. Rate limit cache file (~/.claude/rate-limit-cache.json) - if available from
 *    external tools or a previous CLI version that supported ANTHROPIC_LOG=debug.
 * 2. Session cost data from actual chat `result` messages - tracked in real time
 *    by ClaudeMessageProcessor (total_cost_usd, duration_ms, num_turns).
 *
 * NOTE: The Claude CLI does not expose rate limit headers (5h/7d utilization)
 * through any public interface. Previous versions attempted to capture these by
 * running `claude -p "." --model haiku` with ANTHROPIC_LOG=debug, but this
 * wasted API quota and never worked reliably. That approach has been removed.
 */
import * as vscode from "vscode";
import { EventEmitter } from "events";
import { UsageData } from "../../shared/types/usage";
import {
    readRateLimitCache,
    writeRateLimitCache,
    getCacheAgeMinutes,
    CachedRateLimits,
} from "./RateLimitCache";

// ============================================================================
// Types
// ============================================================================

interface RateLimitData {
    session5h: number; // 0-1 ratio from anthropic-ratelimit-unified-5h-utilization
    weekly7d: number; // 0-1 ratio from anthropic-ratelimit-unified-7d-utilization
    reset5h?: number; // Unix timestamp for 5h reset
    reset7d?: number; // Unix timestamp for 7d reset
}

// ============================================================================
// UsageService
// ============================================================================

export class UsageService implements vscode.Disposable {
    private _usageData: UsageData | undefined;
    private _errorMessage: string | undefined;
    private _dataEmitter = new EventEmitter();
    private _isDisposed = false;

    constructor(private readonly _outputChannel?: vscode.OutputChannel) {
        this._log("╔════════════════════════════════════════════╗");
        this._log("║   USAGE SERVICE INITIALIZING               ║");
        this._log("╚════════════════════════════════════════════╝");

        // Try to load from cache for instant display
        this._loadFromCache();
        this._log("✅ Initialized (rate limits loaded from cache if available)");
    }

    // ========================================================================
    // Logging
    // ========================================================================

    private _log(message: string, data?: unknown): void {
        const formatted = `[UsageService] ${message}`;
        if (this._outputChannel) {
            const logLine = data !== undefined ? `${formatted} ${JSON.stringify(data)}` : formatted;
            this._outputChannel.appendLine(logLine);
        }
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    private _loadFromCache(): boolean {
        this._log("📂 Checking rate limit cache...");

        const cache = readRateLimitCache();
        if (!cache) {
            this._log("   ℹ️  No cache found");
            return false;
        }

        const ageMinutes = getCacheAgeMinutes(cache);
        this._log(`   📂 Cache found (${ageMinutes} minutes old)`);

        const usageData = this._buildUsageDataFromCache(cache);
        this._usageData = usageData;

        this._dataEmitter.emit("update", usageData);
        this._log("   ✅ Loaded usage from cache");

        return true;
    }

    private _saveToCache(rateLimits: RateLimitData): void {
        writeRateLimitCache({
            session5h: rateLimits.session5h,
            weekly7d: rateLimits.weekly7d,
            reset5h: rateLimits.reset5h,
            reset7d: rateLimits.reset7d,
        });
        this._log("💾 Saved to cache");
    }

    private _buildUsageDataFromCache(cache: CachedRateLimits): UsageData {
        return this._buildUsageDataFromRateLimits({
            session5h: cache.session5h,
            weekly7d: cache.weekly7d,
            reset5h: cache.reset5h,
            reset7d: cache.reset7d,
        });
    }

    // ========================================================================
    // Event Handling
    // ========================================================================

    public onUsageUpdate(callback: (data: UsageData) => void): vscode.Disposable {
        this._dataEmitter.on("update", callback);
        return {
            dispose: () => {
                this._dataEmitter.off("update", callback);
            },
        };
    }

    public onError(callback: (error: string) => void): vscode.Disposable {
        this._dataEmitter.on("error", callback);
        return {
            dispose: () => {
                this._dataEmitter.off("error", callback);
            },
        };
    }

    // ========================================================================
    // Polling stubs (kept for API compatibility, no longer spawns processes)
    // ========================================================================

    public startPolling(): void {
        // No-op: rate limit data cannot be fetched via CLI without wasting API quota.
        // Cache is loaded on init; real-time cost is tracked via result messages.
    }

    public stopPolling(): void {
        // No-op
    }

    // ========================================================================
    // Data Fetching (public API kept for compatibility)
    // ========================================================================

    public async fetchUsageDataIfStale(): Promise<void> {
        // Reload from cache in case an external process updated it
        this._loadFromCache();
    }

    public async fetchUsageData(): Promise<void> {
        this._loadFromCache();
    }

    /**
     * Called when a Claude CLI session ends.
     * Reloads cache in case the CLI wrote rate limit data during the session.
     */
    public onClaudeSessionEnd(): void {
        this._log("🔔 Claude session ended, reloading cache...");
        setTimeout(() => {
            if (!this._isDisposed) {
                this._loadFromCache();
            }
        }, 500);
    }

    /**
     * Update rate limit data from external source (e.g., parsed from CLI debug output).
     * This can be called by other services that happen to capture rate limit headers.
     */
    public updateRateLimits(rateLimits: RateLimitData): void {
        this._saveToCache(rateLimits);
        const usageData = this._buildUsageDataFromRateLimits(rateLimits);
        this._usageData = usageData;
        this._errorMessage = undefined;
        this._dataEmitter.emit("update", usageData);
        this._log("📡 Rate limits updated from external source");
    }

    // ========================================================================
    // Data Building
    // ========================================================================

    private _buildUsageDataFromRateLimits(rateLimits: RateLimitData): UsageData {
        const sessionResetTime = rateLimits.reset5h
            ? this._formatResetTime(rateLimits.reset5h)
            : "~5 hr";
        const weeklyResetTime = rateLimits.reset7d
            ? this._formatResetTime(rateLimits.reset7d)
            : "~7 days";

        return {
            currentSession: {
                usageCost: rateLimits.session5h,
                costLimit: 1,
                resetsIn: sessionResetTime,
            },
            weekly: {
                costLikely: rateLimits.weekly7d,
                costLimit: 1,
                resetsAt: weeklyResetTime,
            },
        };
    }

    private _formatResetTime(timestamp: number): string {
        const resetDate = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();

        if (diffMs <= 0) {
            return "Now";
        }

        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        const parts: string[] = [];
        if (diffHours > 0) {
            parts.push(`${diffHours} hr`);
        }
        if (diffMinutes > 0 || parts.length === 0) {
            parts.push(`${diffMinutes} min`);
        }

        const timeStr = resetDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        });

        if (diffHours >= 24) {
            const dateStr = resetDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            });
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return `${dateStr} at ${timeStr} (${timezone})`;
        }

        return `${parts.join(" ")} @ ${timeStr}`;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    public get currentUsage(): UsageData | undefined {
        return this._usageData;
    }

    public get lastError(): string | undefined {
        return this._errorMessage;
    }

    public dispose(): void {
        this._isDisposed = true;
        this._dataEmitter.removeAllListeners();
        this._log("🧹 UsageService disposed");
    }
}
