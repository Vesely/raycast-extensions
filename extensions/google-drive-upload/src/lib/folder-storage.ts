import { LocalStorage } from "@raycast/api";

const DEFAULT_FOLDER_KEY = "default-folder";

export interface DefaultFolder {
  id: string;
  name: string;
  accountId: string; // Associate with account
}

export async function setDefaultFolder(folder: DefaultFolder): Promise<void> {
  await LocalStorage.setItem(DEFAULT_FOLDER_KEY, JSON.stringify(folder));
}

export async function getDefaultFolder(accountId?: string): Promise<DefaultFolder | undefined> {
  const data = await LocalStorage.getItem<string>(DEFAULT_FOLDER_KEY);
  if (!data) return undefined;

  const folder = JSON.parse(data) as DefaultFolder;

  // If accountId is provided, only return the default if it matches
  if (accountId && folder.accountId !== accountId) {
    return undefined;
  }

  return folder;
}
