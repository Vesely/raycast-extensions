import { readdirSync, statSync } from "fs";
import { join, basename, dirname, relative } from "path";
import { runAppleScript } from "@raycast/utils";
import mime from "mime-types";
import { FileMetadata } from "./types";

// Get selected files from Finder using AppleScript
export async function getSelectedFinderFiles(): Promise<string[]> {
  const script = `
    tell application "Finder"
      set selectedItems to selection
      if selectedItems is {} then
        return ""
      end if
      
      set itemPaths to {}
      repeat with anItem in selectedItems
        set end of itemPaths to POSIX path of (anItem as alias)
      end repeat
      
      set AppleScript's text item delimiters to linefeed
      return itemPaths as text
    end tell
  `;

  try {
    const result = await runAppleScript(script);
    if (!result || result.trim() === "") {
      return [];
    }
    return result
      .trim()
      .split("\n")
      .filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

// Check if a path is a directory
export function isDirectory(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Get file metadata
export function getFileMetadata(path: string, basePath?: string): FileMetadata {
  const stats = statSync(path);
  const fileName = basename(path);
  const mimeType = mime.lookup(path) || "application/octet-stream";

  let relativePath: string | undefined;
  if (basePath) {
    relativePath = relative(basePath, path);
  }

  return {
    path,
    name: fileName,
    size: stats.size,
    mimeType,
    isDirectory: stats.isDirectory(),
    relativePath,
  };
}

// Recursively walk through a directory and return all files
export function walkDirectory(dirPath: string, basePath?: string): FileMetadata[] {
  const files: FileMetadata[] = [];
  const base = basePath || dirPath;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      // Skip hidden files and system files
      if (entry.name.startsWith(".")) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively walk subdirectories
        const subFiles = walkDirectory(fullPath, base);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(getFileMetadata(fullPath, base));
      }
    }
  } catch {
    // Ignore directory errors
  }

  return files;
}

// Get all files from a list of paths (handles both files and directories)
export function getAllFiles(paths: string[]): FileMetadata[] {
  const allFiles: FileMetadata[] = [];

  for (const path of paths) {
    if (isDirectory(path)) {
      const dirFiles = walkDirectory(path, dirname(path));
      allFiles.push(...dirFiles);
    } else {
      allFiles.push(getFileMetadata(path));
    }
  }

  return allFiles;
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

// Get the total size of all files
export function getTotalSize(files: FileMetadata[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

// Extract folder structure from file paths
export function extractFolderStructure(files: FileMetadata[]): Map<string, string[]> {
  const structure = new Map<string, string[]>();

  for (const file of files) {
    if (!file.relativePath) continue;

    const dir = dirname(file.relativePath);
    if (dir && dir !== ".") {
      const parts = dir.split("/");
      let currentPath = "";

      for (let i = 0; i < parts.length; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        if (!structure.has(currentPath)) {
          structure.set(currentPath, []);
        }
      }
    }
  }

  return structure;
}
