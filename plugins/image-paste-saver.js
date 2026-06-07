/**
 * Image Paste Saver Plugin for OpenCode
 *
 * Uses the `chat.message` hook to intercept image attachments before they are sent to the model.
 * Saves images to `{project}/.opencode/tmp/` and injects file paths so the agent can delegate
 * image analysis to vision-dev.
 *
 * Solves the problem: primary text-only agents (Erribaba/Zero) cannot see image data,
 * but this plugin intercepts images before they reach the model and saves them to disk.
 *
 * Hook: chat.message - Called when a new message is received, before sending to LLM.
 * Access to `output.parts` which contains FilePart with image data in `url` field.
 *
 * Storage location: `{project_dir}/.opencode/tmp/opencode-img-{timestamp}.{ext}`
 * Supported formats: PNG, JPEG, GIF, WebP, SVG, BMP
 *
 * Lifecycle:
 * - Tracks all saved file paths in memory
 * - On dispose, deletes all tracked files
 * - On init, cleans up stale files older than 1 hour (crash recovery)
 */

import { writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

const IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB limit
const STALE_FILE_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const FILE_PREFIX = "opencode-img-"
const TMP_DIR_NAME = ".opencode/tmp"

/**
 * Ensure the temp directory exists, create if needed
 * @param {string} projectDir - Project root directory
 * @returns {string} - Absolute path to the temp directory
 */
function ensureTmpDir(projectDir) {
  const tmpDir = join(projectDir, TMP_DIR_NAME)
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true })
  }
  return tmpDir
}

/**
 * Extract and save base64 image from data URL
 * @param {string} dataUrl - Data URL like "data:image/png;base64,..."
 * @param {string} tmpDir - Directory to save the image
 * @returns {string|null} - Saved file path or null
 */
function saveImageFromDataUrl(dataUrl, tmpDir) {
  try {
    // Parse data URL: data:<mime>;base64,<data>
    const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/)
    if (!match) return null

    const mime = match[1]
    const base64Data = match[2]

    // Clean base64 data
    const cleanB64 = base64Data.replace(/\s/g, "")
    if (cleanB64.length < 100) return null
    if (cleanB64.length > MAX_SIZE * 1.37) return null // base64 overhead ~37%

    const ext = IMAGE_EXTENSIONS[mime] || "png"
    const ts = Date.now()
    const filePath = join(tmpDir, `${FILE_PREFIX}${ts}.${ext}`)

    // Decode base64 to buffer
    const buffer = Buffer.from(cleanB64, "base64")
    if (buffer.length < 100 || buffer.length > MAX_SIZE) return null

    writeFileSync(filePath, buffer)
    return filePath
  } catch (e) {
    // Provide specific error messages for common failures
    if (e.code === "ENOSPC") {
      console.error(`[image-paste-saver] Disk full — cannot save image to ${tmpDir}`)
    } else if (e.code === "EACCES" || e.code === "EPERM") {
      console.error(`[image-paste-saver] Permission denied — cannot write to ${e.path || tmpDir}`)
    } else if (e.code === "EROFS") {
      console.error("[image-paste-saver] Filesystem is read-only — cannot save image")
    } else {
      console.error("[image-paste-saver] Error saving image:", e.message)
    }
    return null
  }
}

/**
 * Clean up stale plugin temp files older than maxAge
 * @param {string} tmpDir - Directory to clean
 * @param {number} maxAge - Max age in milliseconds
 */
function cleanupStaleFiles(tmpDir, maxAge) {
  try {
    if (!existsSync(tmpDir)) return
    const now = Date.now()
    const files = readdirSync(tmpDir)
    for (const file of files) {
      if (!file.startsWith(FILE_PREFIX)) continue
      try {
        const filePath = join(tmpDir, file)
        const stat = statSync(filePath)
        if (now - stat.mtimeMs > maxAge) {
          unlinkSync(filePath)
        }
      } catch {
        // File may have been deleted by another process — ignore
      }
    }
  } catch {
    // Cannot read directory — ignore, not critical
  }
}

/**
 * Plugin entry point (server-side plugin)
 *
 * Uses the chat.message hook which is called when a new message is received,
 * before the message is sent to the LLM. This allows us to intercept image
 * attachments and save them to disk.
 */
export const server = async ({ client, directory }, options) => {
  /** @type {Set<string>} Track saved files for cleanup on dispose */
  const savedFiles = new Set()

  // Resolve temp directory path (project/.opencode/tmp/)
  const tmpDir = ensureTmpDir(directory)

  // On startup, clean up stale files from previous sessions (crash recovery)
  cleanupStaleFiles(tmpDir, STALE_FILE_MAX_AGE_MS)

  return {
    /**
     * dispose hook — called when the plugin is unloaded or OpenCode exits.
     * Deletes all temp files created during this session.
     */
    dispose: async () => {
      for (const filePath of savedFiles) {
        try {
          unlinkSync(filePath)
        } catch {
          // Already deleted or permission issue — ignore
        }
      }
      savedFiles.clear()
    },

    /**
     * chat.message hook - Called when a new message is received
     *
     * This hook has access to:
     * - input: { sessionID, agent, model, messageID, variant }
     * - output: { message: UserMessage, parts: Part[] }
     *
     * Parts can include FilePart with type="file" and mime starting with "image/"
     * The image data is in the `url` field as a data URL (data:image/png;base64,...)
     */
    "chat.message": async (input, output) => {
      try {
        if (!output || !output.parts || !Array.isArray(output.parts)) return

        const savedPaths = []
        const indicesToRemove = []

        // Process each part looking for images
        for (let i = 0; i < output.parts.length; i++) {
          const part = output.parts[i]

          // Check if this is a file part with an image
          if (part.type === "file" && part.url && part.mime?.startsWith("image/")) {
            const filePath = saveImageFromDataUrl(part.url, tmpDir)
            if (filePath) {
              savedPaths.push(filePath)
              savedFiles.add(filePath)
              indicesToRemove.push(i)
            }
          }
        }

        // If we saved any images, replace image parts with text instruction
        if (savedPaths.length > 0) {
          const instruction = savedPaths
            .map((p) => `[Image saved to: ${p}]`)
            .join("\n")

          // Collect user's original text content (preserve non-image parts)
          const userTextParts = output.parts
            .filter((_, i) => !indicesToRemove.includes(i))
            .filter((p) => p.type === "text" && p.text?.trim())
            .map((p) => p.text.trim())
          
          const userText = userTextParts.join("\n")

          // Remove image parts (in reverse order to preserve indices)
          for (let i = indicesToRemove.length - 1; i >= 0; i--) {
            output.parts.splice(indicesToRemove[i], 1)
          }

          // Build combined message: image instruction + user's original text
          let combinedText = `${instruction}\n`
          
          if (userText) {
            combinedText += `\nUser's message: ${userText}\n`
          }
          
          combinedText += `\nPlease analyze the images by delegating to @vision-dev: "Analyze the images at: ${savedPaths.join(", ")}"`
          
          if (userText) {
            combinedText += ` and respond to the user's message above.`
          }

          // Remove all existing text parts (we'll replace with combined)
          output.parts = output.parts.filter((p) => p.type !== "text")

          // Add combined instruction as a text part
          output.parts.unshift({
            type: "text",
            text: combinedText,
          })
        }
      } catch (e) {
        console.error("[image-paste-saver] Error in chat.message hook:", e.message)
      }
    },
  }
}

export default server
