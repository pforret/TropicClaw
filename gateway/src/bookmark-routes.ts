import type { Router } from "./router.js";
import type { BookmarkService } from "../../apps/bookmarks/bookmark-service.js";
import type { AppRoute, OutboundResponse, UnifiedMessage, AppRouteContext } from "./types.js";

const URL_REGEX = /^\s*(https?:\/\/[^\s]+)\s*$/i;

export function registerBookmarkRoutes(router: Router, bookmarkService: BookmarkService) {
  // URL detection route (priority 50 — before built-in routes at 100)
  router.registerRoute({
    name: "bookmark-url",
    description: "Auto-bookmark bare URLs",
    pattern: URL_REGEX,
    priority: 50,
    handle: async (match, message, ctx) => {
      const url = match[1];
      const adapter = ctx.adapters.get(message.channel);
      adapter?.sendTyping?.(message.chatId);

      try {
        const bookmark = await bookmarkService.process(url);

        const lines = [
          `**${bookmark.title}**`,
          "",
          bookmark.summaryLong,
          "",
          `${bookmark.url}`,
        ];
        if (bookmark.tags.length > 0) {
          lines.push("", `Tags: ${bookmark.tags.join(", ")}`);
        }
        if (bookmark.publishedTo.length > 0) {
          lines.push("", `Published to: ${bookmark.publishedTo.join(", ")}`);
        }

        const fullText = lines.join("\n");
        const response = ctx.makeResponse("bookmarks", message, fullText);

        if (bookmark.imagePath) {
          // Telegram caption limit is 1024 chars — truncate if sending with image
          const caption = fullText.length > 1000
            ? `**${bookmark.title}**\n\n${bookmark.summaryShort}\n\n${bookmark.url}`
            : fullText;
          response.content.text = caption;
          response.content.media = { type: "image", localPath: bookmark.imagePath };
        }

        ctx.sessionStore.logMessage("bookmarks", "user", url, message.channel);
        ctx.sessionStore.logMessage("bookmarks", "assistant", lines.join("\n"), message.channel);

        return response;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[bookmark] Error for ${url}:`, msg);
        return ctx.makeResponse("bookmarks", message, `Bookmark failed: ${msg}`);
      }
    },
  });

  // /bookmarks command (priority 50)
  router.registerRoute({
    name: "bookmarks-cmd",
    description: "List or search saved bookmarks",
    pattern: /^\/bookmarks(?:\s+(.*))?$/i,
    priority: 50,
    handle: async (match, message, ctx) => {
      const args = (match[1] || "").trim();
      const parts = args.split(/\s+/);
      const subcommand = parts[0] || "list";

      if (subcommand === "list") {
        const bookmarks = bookmarkService.list(10);
        if (bookmarks.length === 0) {
          return ctx.makeResponse("bookmarks", message, "No bookmarks saved yet.");
        }
        const lines = bookmarks.map(
          (b, i) => `${i + 1}. **${b.title}**\n   ${b.url}\n   ${b.summaryShort}`
        );
        const total = bookmarkService.count();
        return ctx.makeResponse(
          "bookmarks",
          message,
          `Bookmarks (${total} total):\n\n${lines.join("\n\n")}`
        );
      }

      if (subcommand === "search") {
        const query = parts.slice(1).join(" ");
        if (!query) {
          return ctx.makeResponse("bookmarks", message, "Usage: /bookmarks search <query>");
        }
        const results = bookmarkService.search(query, 10);
        if (results.length === 0) {
          return ctx.makeResponse("bookmarks", message, `No bookmarks matching "${query}".`);
        }
        const lines = results.map((b) => `- **${b.title}**\n  ${b.url}`);
        return ctx.makeResponse("bookmarks", message, `Search results:\n\n${lines.join("\n\n")}`);
      }

      return ctx.makeResponse("bookmarks", message, "Usage: /bookmarks [list|search <query>]");
    },
  });
}
