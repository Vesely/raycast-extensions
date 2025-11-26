import { OAuth, LocalStorage, getPreferenceValues } from "@raycast/api";
import { GoogleAccount, GoogleUserInfo, StoredAccounts } from "./types";

const STORAGE_KEY = "google-drive-accounts";

const DEFAULT_OAUTH_CLIENT_ID = "389780480859-1in9j915akqi6sbk2ad8nnd9apj9spf1.apps.googleusercontent.com";

function getClientId(): string {
  const preferences = getPreferenceValues<Preferences>();
  return preferences.oauthClientId?.trim() || DEFAULT_OAUTH_CLIENT_ID;
}

export function createOAuthClient(providerId: string = "google-drive"): OAuth.PKCEClient {
  return new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.AppURI,
    providerName: "Google",
    providerIcon: "icon.png",
    providerId,
    description: "Connect your Google Drive account",
  });
}

async function fetchTokens(authRequest: OAuth.AuthorizationRequest, authCode: string): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", getClientId());
  params.append("code", authCode);
  params.append("verifier", authRequest.codeVerifier);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", authRequest.redirectURI);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("fetch tokens error:", errorText);
    throw new Error("Failed to authenticate with Google. Please try again.");
  }

  return (await response.json()) as OAuth.TokenResponse;
}

async function refreshTokens(refreshToken: string): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", getClientId());
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("refresh tokens error:", errorText);

    // Check for specific error types
    let errorMessage = "Failed to refresh access token. Please re-authenticate your account.";
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error === "invalid_grant" || errorData.error === "invalid_token") {
        errorMessage = "Authentication expired. Please re-authenticate your account.";
      }
    } catch {
      // If we can't parse the error, use the default message
    }

    throw new Error(errorMessage);
  }

  const tokenResponse = (await response.json()) as OAuth.TokenResponse;
  tokenResponse.refresh_token = tokenResponse.refresh_token ?? refreshToken;
  return tokenResponse;
}

export async function authorize(client: OAuth.PKCEClient): Promise<string> {
  const tokenSet = await client.getTokens();
  if (tokenSet?.accessToken) {
    if (tokenSet.refreshToken && tokenSet.isExpired()) {
      await client.setTokens(await refreshTokens(tokenSet.refreshToken));
      const updatedTokenSet = await client.getTokens();
      return updatedTokenSet?.accessToken || "";
    }
    return tokenSet.accessToken;
  }

  const authRequest = await client.authorizationRequest({
    endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: getClientId(),
    scope:
      "openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
  });

  const { authorizationCode } = await client.authorize(authRequest);
  const tokenResponse = await fetchTokens(authRequest, authorizationCode);
  await client.setTokens(tokenResponse);

  return tokenResponse.access_token;
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to get user info:", errorText);
    throw new Error("Failed to get user information from Google. Please try again.");
  }

  return (await response.json()) as GoogleUserInfo;
}

export async function getStoredAccounts(): Promise<StoredAccounts> {
  const data = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!data) {
    return { accounts: [] };
  }
  return JSON.parse(data);
}

export async function saveAccounts(accounts: GoogleAccount[]): Promise<void> {
  const stored = await getStoredAccounts();
  stored.accounts = accounts;
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export async function addAccount(accessToken: string, providerId: string): Promise<GoogleAccount> {
  const userInfo = await getUserInfo(accessToken);
  const accountId = userInfo.sub || userInfo.email;

  const account: GoogleAccount = {
    id: accountId,
    email: userInfo.email,
    name: userInfo.name,
    accessToken,
    providerId,
  };

  const stored = await getStoredAccounts();
  const existingIndex = stored.accounts.findIndex((a) => a.id === account.id);

  if (existingIndex >= 0) {
    stored.accounts[existingIndex] = account;
  } else {
    stored.accounts.push(account);
  }

  if (stored.accounts.length === 1 && !stored.defaultAccountId) {
    stored.defaultAccountId = account.id;
  }

  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  return account;
}

export async function removeAccount(accountId: string): Promise<void> {
  const stored = await getStoredAccounts();
  stored.accounts = stored.accounts.filter((a) => a.id !== accountId);

  if (stored.defaultAccountId === accountId) {
    stored.defaultAccountId = stored.accounts.length > 0 ? stored.accounts[0].id : undefined;
  }

  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export async function getAccounts(): Promise<GoogleAccount[]> {
  const stored = await getStoredAccounts();
  return stored.accounts;
}

export async function getDefaultAccount(): Promise<GoogleAccount | undefined> {
  const stored = await getStoredAccounts();
  if (!stored.defaultAccountId) {
    return stored.accounts[0];
  }
  return stored.accounts.find((a) => a.id === stored.defaultAccountId);
}

export async function setDefaultAccount(accountId: string): Promise<void> {
  const stored = await getStoredAccounts();
  stored.defaultAccountId = accountId;
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export async function getValidAccessToken(account: GoogleAccount): Promise<string> {
  const client = createOAuthClient(account.providerId);
  const tokenSet = await client.getTokens();

  if (tokenSet?.accessToken) {
    if (tokenSet.refreshToken && tokenSet.isExpired()) {
      try {
        const refreshedTokens = await refreshTokens(tokenSet.refreshToken);
        await client.setTokens(refreshedTokens);
        const updatedTokenSet = await client.getTokens();
        return updatedTokenSet?.accessToken || "";
      } catch (error) {
        // Refresh token is invalid or expired - need to re-authenticate
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("invalid_grant") || errorMessage.includes("invalid_token")) {
          throw new Error("AUTHENTICATION_EXPIRED");
        }
        throw error;
      }
    }
    return tokenSet.accessToken;
  }

  // No tokens in client - might need to re-authenticate
  throw new Error("AUTHENTICATION_EXPIRED");
}

export async function reAuthenticateAccount(account: GoogleAccount): Promise<GoogleAccount> {
  // Create a new provider ID for re-authentication
  const providerId = `google-drive-${Date.now()}`;
  const client = createOAuthClient(providerId);
  const token = await authorize(client);
  const userInfo = await getUserInfo(token);

  // Update the existing account with new tokens
  const stored = await getStoredAccounts();
  const accountIndex = stored.accounts.findIndex((a) => a.id === account.id);

  if (accountIndex >= 0) {
    stored.accounts[accountIndex] = {
      id: account.id, // Keep the same account ID
      email: userInfo.email,
      name: userInfo.name,
      accessToken: token,
      providerId,
    };
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return stored.accounts[accountIndex];
  }

  // If account not found, add it as new
  return await addAccount(token, providerId);
}
