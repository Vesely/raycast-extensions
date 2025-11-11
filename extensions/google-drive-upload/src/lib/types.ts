export interface GoogleAccount {
  id: string;
  email: string;
  name?: string;
  accessToken: string;
  providerId: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
  parents?: string[];
}

export interface UploadResult {
  success: boolean;
  file?: GoogleDriveFile;
  error?: string;
  localPath: string;
}

export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  isDirectory: boolean;
  relativePath?: string;
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export interface StoredAccounts {
  accounts: GoogleAccount[];
  defaultAccountId?: string;
}
