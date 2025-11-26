import { createReadStream } from "fs";
import FormData from "form-data";
import fetch from "node-fetch";
import { GoogleDriveFile, GoogleDriveFolder } from "./types";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

interface DriveFileMetadata {
  name: string;
  mimeType?: string;
  parents?: string[];
}

// Upload a single file to Google Drive
export async function uploadFile(
  filePath: string,
  fileName: string,
  mimeType: string,
  accessToken: string,
  parentFolderId?: string,
): Promise<GoogleDriveFile> {
  const metadata: DriveFileMetadata = {
    name: fileName,
    mimeType,
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata), {
    contentType: "application/json",
  });
  form.append("file", createReadStream(filePath), {
    filename: fileName,
    contentType: mimeType,
  });

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,parents,size,createdTime,modifiedTime`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: form as any,
    },
  );

  if (!response.ok) {
    // Check for authentication errors
    if (response.status === 401) {
      throw new Error("AUTHENTICATION_EXPIRED");
    }
    const errorText = await response.text();
    throw new Error(`Failed to upload file: ${response.status} ${errorText}`);
  }

  return (await response.json()) as GoogleDriveFile;
}

// Create a folder in Google Drive
export async function createFolder(
  folderName: string,
  accessToken: string,
  parentFolderId?: string,
): Promise<GoogleDriveFolder> {
  const metadata: DriveFileMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const response = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,webViewLink,parents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    // Check for authentication errors
    if (response.status === 401) {
      throw new Error("AUTHENTICATION_EXPIRED");
    }
    const errorText = await response.text();
    throw new Error(`Failed to create folder: ${response.status} ${errorText}`);
  }

  return (await response.json()) as GoogleDriveFolder;
}

// List all folders in Google Drive with their paths
export async function listFolders(accessToken: string): Promise<GoogleDriveFolder[]> {
  const allFolders: GoogleDriveFolder[] = [];
  let pageToken: string | undefined;

  // Fetch all folders (paginated)
  do {
    const query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    let url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=files(id,name,webViewLink,parents),nextPageToken&orderBy=name`;

    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check for authentication errors
      if (response.status === 401) {
        throw new Error("AUTHENTICATION_EXPIRED");
      }
      throw new Error(`Failed to list folders: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { files: GoogleDriveFolder[]; nextPageToken?: string };
    allFolders.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFolders;
}

// Build folder path by traversing parents (shows parent folders, not the folder itself)
export function buildFolderPath(folderId: string, folderMap: Map<string, GoogleDriveFolder>): string {
  const pathParts: string[] = [];
  const folder = folderMap.get(folderId);

  if (!folder) return "";

  // Start from the parent, not the folder itself
  let currentId: string | undefined = folder.parents?.[0];

  // Traverse up to 10 levels to avoid infinite loops
  for (let i = 0; i < 10 && currentId && currentId !== "root"; i++) {
    const parentFolder = folderMap.get(currentId);
    if (!parentFolder) break;

    pathParts.unshift(parentFolder.name);
    currentId = parentFolder.parents?.[0];
  }

  // If folder is directly in root, return "My Drive"
  if (pathParts.length === 0 && folder.parents?.[0] === "root") {
    return "My Drive";
  }

  // Always prepend "My Drive" if we have a path and ended at root
  if (pathParts.length > 0 && currentId === "root") {
    pathParts.unshift("My Drive");
  }

  return pathParts.join(" > ");
}

// Check if a folder exists and create it if not
export async function ensureFolder(
  folderName: string,
  accessToken: string,
  parentFolderId?: string,
): Promise<GoogleDriveFolder> {
  // Try to find existing folder
  let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentFolderId) {
    query += ` and '${parentFolderId}' in parents`;
  } else {
    query += " and 'root' in parents";
  }

  const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink,parents)`;

  const searchResponse = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (searchResponse.ok) {
    const data = (await searchResponse.json()) as { files: GoogleDriveFolder[] };
    if (data.files && data.files.length > 0) {
      return data.files[0];
    }
  } else if (searchResponse.status === 401) {
    // Check for authentication errors
    throw new Error("AUTHENTICATION_EXPIRED");
  }

  // Folder doesn't exist, create it
  return createFolder(folderName, accessToken, parentFolderId);
}

// Upload file with retry logic
export async function uploadFileWithRetry(
  filePath: string,
  fileName: string,
  mimeType: string,
  accessToken: string,
  parentFolderId?: string,
  maxRetries = 3,
): Promise<GoogleDriveFile> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const uploadedFile = await uploadFile(filePath, fileName, mimeType, accessToken, parentFolderId);

      // Make the file public (shareable with link)
      try {
        await makeFilePublic(uploadedFile.id, accessToken);
      } catch {
        // Don't fail the upload if making public fails
      }

      return uploadedFile;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error("Upload failed after retries");
}

// Make a file public (shareable with anyone who has the link)
export async function makeFilePublic(fileId: string, accessToken: string): Promise<void> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "reader",
      type: "anyone",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to make file public: ${response.status} ${errorText}`);
  }
}
