import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  LocalStorage,
  Color,
  Clipboard,
  popToRoot,
  open,
} from "@raycast/api";
import { useState, useEffect } from "react";
import { dirname } from "path";
import {
  createOAuthClient,
  authorize,
  getAccounts,
  addAccount,
  getDefaultAccount,
  getValidAccessToken,
  setDefaultAccount,
} from "./lib/auth";
import { uploadFileWithRetry, ensureFolder, listFolders, buildFolderPath } from "./lib/google-drive";
import {
  getSelectedFinderFiles,
  getAllFiles,
  isDirectory,
  formatFileSize,
  getTotalSize,
  extractFolderStructure,
} from "./lib/file-utils";
import { GoogleAccount, UploadResult, FileMetadata, GoogleDriveFolder } from "./lib/types";
import { getDefaultFolder, setDefaultFolder, DefaultFolder } from "./lib/folder-storage";

const LAST_USED_ACCOUNT_KEY = "last-used-account-id";

interface FolderWithPath extends GoogleDriveFolder {
  path: string;
}

export default function Command() {
  const [isLoading, setIsLoading] = useState(true);
  const [folders, setFolders] = useState<FolderWithPath[]>([]);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [account, setAccount] = useState<GoogleAccount | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [showAccountSelection, setShowAccountSelection] = useState(false);
  const [defaultAccountIdState, setDefaultAccountIdState] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [defaultFolder, setDefaultFolderState] = useState<DefaultFolder | undefined>();
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        // Get selected files from Finder
        const selectedPaths = await getSelectedFinderFiles();

        if (selectedPaths.length === 0) {
          setError("No files selected. Please select files or folders in Finder.");
          setIsLoading(false);
          return;
        }

        // Get all files
        const allFiles = getAllFiles(selectedPaths);
        if (allFiles.length === 0) {
          setError("No files to upload");
          setIsLoading(false);
          return;
        }

        setFiles(allFiles);

        // Get accounts
        const allAccounts = await getAccounts();
        setAccounts(allAccounts);

        if (allAccounts.length === 0) {
          // Need to authenticate
          const toast = await showToast({
            style: Toast.Style.Animated,
            title: "Authenticating...",
          });

          const providerId = `google-drive-${Date.now()}`;
          const client = createOAuthClient(providerId);
          const token = await authorize(client);
          const newAccount = await addAccount(token, providerId);

          toast.style = Toast.Style.Success;
          toast.title = "Authenticated";
          toast.message = newAccount.email;

          // Reload accounts
          const updatedAccounts = await getAccounts();
          setAccounts(updatedAccounts);
          setAccount(newAccount);
          setSelectedAccountId(newAccount.id);

          // Load folders
          await loadFolders(newAccount);
        } else if (allAccounts.length === 1) {
          // Only one account, use it automatically
          const selectedAccount = allAccounts[0];
          setAccount(selectedAccount);
          setSelectedAccountId(selectedAccount.id);
          await loadFolders(selectedAccount);
        } else {
          // Multiple accounts - show selection
          setShowAccountSelection(true);
          // Prefill with default or last used account
          const defaultAccount = await getDefaultAccount();
          const lastUsedId = await LocalStorage.getItem<string>(LAST_USED_ACCOUNT_KEY);
          const prefilledId = lastUsedId || defaultAccount?.id || allAccounts[0].id;
          setSelectedAccountId(prefilledId);
          setIsLoading(false);
        }
      } catch (err) {
        setError((err as Error).message);
        setIsLoading(false);
      }
    }

    init();
  }, []);

  async function loadFolders(acc: GoogleAccount) {
    try {
      // Load default folder immediately
      const defaultFld = await getDefaultFolder(acc.id);
      setDefaultFolderState(defaultFld);

      // Stop loading state immediately so "My Drive" is available
      setIsLoading(false);

      // Start background folder loading
      setIsFoldersLoading(true);

      // Fetch folders in background
      const accessToken = await getValidAccessToken(acc);

      const allFolders = await listFolders(accessToken);

      // Build folder map for path resolution
      const folderMap = new Map<string, GoogleDriveFolder>();
      allFolders.forEach((folder) => {
        folderMap.set(folder.id, folder);
      });

      // Build paths for all folders (synchronously - much faster!)
      const foldersWithPaths: FolderWithPath[] = allFolders.map((folder) => ({
        ...folder,
        path: buildFolderPath(folder.id, folderMap),
      }));

      setFolders(foldersWithPaths);
      setIsFoldersLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setIsLoading(false);
      setIsFoldersLoading(false);
    }
  }

  async function handleSetDefaultFolder(folder: { id: string; name: string }) {
    if (!account) return;

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Setting default folder...",
    });

    try {
      const newDefaultFolder: DefaultFolder = {
        id: folder.id,
        name: folder.name,
        accountId: account.id,
      };

      await setDefaultFolder(newDefaultFolder);
      setDefaultFolderState(newDefaultFolder);

      toast.style = Toast.Style.Success;
      toast.title = "Default folder set";
      toast.message = folder.name;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to set default folder";
      toast.message = (error as Error).message;
    }
  }

  async function handleAddAccount() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Connecting to Google...",
      message: "Opening authentication in your browser",
    });

    try {
      const providerId = `google-drive-${Date.now()}`;
      const client = createOAuthClient(providerId);
      const token = await authorize(client);
      const newAccount = await addAccount(token, providerId);

      toast.style = Toast.Style.Success;
      toast.title = "Account added";
      toast.message = newAccount.email;

      // Reload accounts
      const updatedAccounts = await getAccounts();
      setAccounts(updatedAccounts);
      setAccount(newAccount);
      setSelectedAccountId(newAccount.id);
      setShowAccountSelection(false);

      // Load folders
      await loadFolders(newAccount);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to add account";
      toast.message = (error as Error).message;
    }
  }

  async function handleSelectAccount(accountId: string) {
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) return;

    setIsLoading(true);
    setAccount(selectedAccount);
    setSelectedAccountId(accountId);
    setShowAccountSelection(false);

    // Store last used account
    await LocalStorage.setItem(LAST_USED_ACCOUNT_KEY, accountId);

    // Load folders for selected account
    await loadFolders(selectedAccount);
  }

  async function handleOpenManageAccounts() {
    try {
      // Try to open the manage-accounts command using raycast:// URL scheme
      await open("raycast://extensions/davidvesely/google-drive-upload/manage-accounts");
    } catch {
      // Fallback: pop to root and show message
      await popToRoot();
      await showToast({
        style: Toast.Style.Success,
        title: "Opening Manage Accounts",
        message: "Please run 'Manage Google Drive Accounts' command",
      });
    }
  }

  async function handleUpload(folderId: string, folderName: string) {
    if (!account) return;

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Uploading...",
    });

    try {
      const accessToken = await getValidAccessToken(account);

      // Track folder IDs for nested structure
      const folderIdMap = new Map<string, string | undefined>();
      if (folderId !== "root") {
        folderIdMap.set(".", folderId);
      }

      // Get original paths for folder detection
      const selectedPaths = await getSelectedFinderFiles();
      const hasFolders = selectedPaths.some((path) => isDirectory(path));
      const needsStructure = files.some((f) => f.relativePath && dirname(f.relativePath) !== ".");

      // Create folder structure if needed
      if (needsStructure && hasFolders) {
        try {
          toast.title = "Creating folder structure...";
        } catch {
          // Ignore toast errors
        }
        const folderStructure = extractFolderStructure(files);

        const sortedFolders = Array.from(folderStructure.keys()).sort((a, b) => {
          const aDepth = a.split("/").length;
          const bDepth = b.split("/").length;
          return aDepth - bDepth;
        });

        for (const folderPath of sortedFolders) {
          const parts = folderPath.split("/");
          const folderNamePart = parts[parts.length - 1];
          const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
          const parentId = folderIdMap.get(parentPath);

          const folder = await ensureFolder(folderNamePart, accessToken, parentId);
          folderIdMap.set(folderPath, folder.id);
        }
      }

      // Upload files
      const results: UploadResult[] = [];
      let uploaded = 0;

      for (const file of files) {
        uploaded++;
        try {
          toast.title = `Uploading ${uploaded}/${files.length}`;
          toast.message = file.name || "Uploading file...";
        } catch {
          // Ignore toast errors
        }

        try {
          // Determine parent folder for this file
          let parentId: string | undefined = folderId === "root" ? undefined : folderId;
          if (file.relativePath && hasFolders) {
            const fileDir = dirname(file.relativePath);
            if (fileDir !== "." && folderIdMap.has(fileDir)) {
              parentId = folderIdMap.get(fileDir);
            }
          }

          const uploadedFile = await uploadFileWithRetry(file.path, file.name, file.mimeType, accessToken, parentId);

          results.push({
            success: true,
            file: uploadedFile,
            localPath: file.path,
          });
        } catch (error) {
          results.push({
            success: false,
            error: (error as Error).message,
            localPath: file.path,
          });
        }
      }

      // Store last used account
      if (account.id) {
        try {
          await LocalStorage.setItem(LAST_USED_ACCOUNT_KEY, account.id);
        } catch {
          // Ignore storage errors
        }
      }

      // Show results
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      try {
        if (failed === 0) {
          toast.style = Toast.Style.Success;
          toast.title = `✓ Uploaded ${successful} file${successful > 1 ? "s" : ""}`;

          // Copy URL to clipboard
          try {
            if (successful === 1 && results[0].file?.webViewLink && results[0].file.webViewLink.trim()) {
              await Clipboard.copy(results[0].file.webViewLink);
              toast.message = "Link copied to clipboard";
            } else if (folderId !== "root" && folderId) {
              const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
              await Clipboard.copy(folderUrl);
              toast.message = "Folder link copied to clipboard";
            } else {
              toast.message = folderName ? `Uploaded to ${folderName}` : "Upload complete";
            }
          } catch {
            toast.message = folderName ? `Uploaded to ${folderName}` : "Upload complete";
          }

          // Close the extension after successful upload
          await popToRoot();
        } else if (successful > 0) {
          toast.style = Toast.Style.Success;
          toast.title = `Uploaded ${successful}, failed ${failed}`;
          toast.message = "Some files could not be uploaded";
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = "Upload failed";
          toast.message = `All ${failed} file${failed > 1 ? "s" : ""} failed`;
        }
      } catch {
        // Fallback toast update - don't set message if it causes errors
        try {
          toast.style = Toast.Style.Success;
          toast.title = `Uploaded ${successful} file${successful > 1 ? "s" : ""}`;
        } catch {
          // Ignore toast errors
        }
      }
    } catch (err) {
      try {
        toast.style = Toast.Style.Failure;
        toast.title = "Upload failed";
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage && errorMessage.trim()) {
          toast.message = errorMessage;
        }
      } catch {
        // Ignore toast errors
      }
    }
  }

  if (error) {
    return (
      <List>
        <List.EmptyView title="Error" description={error} icon={{ source: Icon.XMarkCircle, tintColor: Color.Red }} />
      </List>
    );
  }

  // Load default account ID when accounts change
  useEffect(() => {
    async function loadDefaultAccount() {
      const defaultAcc = await getDefaultAccount();
      setDefaultAccountIdState(defaultAcc?.id);
    }
    if (accounts.length > 0) {
      loadDefaultAccount();
    }
  }, [accounts]);

  const totalSize = getTotalSize(files);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Upload ${files.length} file${files.length > 1 ? "s" : ""} (${formatFileSize(totalSize)})`}
      searchBarPlaceholder={showAccountSelection ? "Search accounts..." : "Search folders..."}
    >
      {showAccountSelection && !isLoading ? (
        <List.Section title="Select Google Account">
          {accounts
            .sort((a, b) => {
              // Default account always at top
              if (a.id === defaultAccountIdState) return -1;
              if (b.id === defaultAccountIdState) return 1;
              // Otherwise maintain alphabetical order by name/email
              const aName = (a.name || a.email).toLowerCase();
              const bName = (b.name || b.email).toLowerCase();
              return aName.localeCompare(bName);
            })
            .map((acc) => {
              const isDefault = acc.id === defaultAccountIdState;
              const isSelected = acc.id === selectedAccountId;
              return (
                <List.Item
                  key={acc.id}
                  title={acc.name || acc.email}
                  subtitle={acc.email}
                  icon={{
                    source: Icon.PersonCircle,
                    tintColor: isSelected ? Color.Blue : isDefault ? Color.Green : Color.SecondaryText,
                  }}
                  accessories={
                    isDefault
                      ? [
                          {
                            tag: {
                              value: "Default",
                              color: Color.Green,
                            },
                          },
                        ]
                      : []
                  }
                  actions={
                    <ActionPanel>
                      <Action
                        title="Select Account"
                        icon={{ source: Icon.Check, tintColor: Color.Blue }}
                        onAction={() => handleSelectAccount(acc.id)}
                      />
                      {!isDefault && (
                        <Action
                          title="Set as Default"
                          icon={{ source: Icon.Star, tintColor: Color.Yellow }}
                          onAction={async () => {
                            await setDefaultAccount(acc.id);
                            setDefaultAccountIdState(acc.id);
                            const updatedAccounts = await getAccounts();
                            setAccounts(updatedAccounts);
                          }}
                        />
                      )}
                      <Action
                        title="Add Account"
                        icon={{ source: Icon.Plus, tintColor: Color.SecondaryText }}
                        shortcut={{ modifiers: ["cmd"], key: "n" }}
                        onAction={handleAddAccount}
                      />
                      <Action
                        title="Manage Accounts"
                        icon={{ source: Icon.Gear, tintColor: Color.SecondaryText }}
                        shortcut={{ modifiers: ["cmd"], key: "m" }}
                        onAction={handleOpenManageAccounts}
                      />
                    </ActionPanel>
                  }
                />
              );
            })}
          <List.Item
            title="Add Account"
            subtitle="Connect a new Google account"
            icon={{ source: Icon.Plus, tintColor: Color.SecondaryText }}
            actions={
              <ActionPanel>
                <Action
                  title="Add Account"
                  icon={{ source: Icon.Plus, tintColor: Color.SecondaryText }}
                  shortcut={{ modifiers: ["cmd"], key: "n" }}
                  onAction={handleAddAccount}
                />
                <Action
                  title="Manage Accounts"
                  icon={{ source: Icon.Gear, tintColor: Color.SecondaryText }}
                  shortcut={{ modifiers: ["cmd"], key: "m" }}
                  onAction={handleOpenManageAccounts}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : !isLoading ? (
        <List.Section
          title="Select destination folder"
          subtitle={
            isFoldersLoading ? `Loading folders...` : folders.length > 0 ? `${folders.length} folders` : undefined
          }
        >
          {[
            // Add default folder at the very top if it's not root
            ...(defaultFolder && defaultFolder.id !== "root" && defaultFolder.accountId === account?.id
              ? folders.filter((f) => f.id === defaultFolder.id)
              : []),
            // Always add "My Drive" root (first position if it's default or no default, second if another folder is default)
            {
              id: "root",
              name: "My Drive",
              path: "",
            } as FolderWithPath,
            // Add all other folders sorted by path
            ...folders
              .filter((f) => !(defaultFolder?.id === f.id && defaultFolder?.accountId === account?.id))
              .sort((a, b) => a.path.localeCompare(b.path)),
          ].map((folder) => {
            const isDefault = defaultFolder?.id === folder.id && defaultFolder?.accountId === account?.id;
            const isRoot = folder.id === "root";
            const displayPath = folder.path && folder.path.trim() ? folder.path : undefined;
            return (
              <List.Item
                key={folder.id}
                title={folder.name}
                subtitle={displayPath}
                icon={{
                  source: isRoot ? Icon.HardDrive : Icon.Folder,
                  tintColor: isDefault ? Color.Green : isRoot ? Color.Blue : Color.Yellow,
                }}
                accessories={
                  isDefault
                    ? [
                        {
                          tag: {
                            value: "Default",
                            color: Color.Green,
                          },
                        },
                      ]
                    : undefined
                }
                actions={
                  <ActionPanel>
                    <Action
                      title="Upload to This Folder"
                      icon={{ source: Icon.Upload, tintColor: Color.Blue }}
                      onAction={() => handleUpload(folder.id, folder.name)}
                    />
                    {!isDefault && (
                      <Action
                        title="Set as Default Folder"
                        icon={{ source: Icon.Star, tintColor: Color.Yellow }}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
                        onAction={() => handleSetDefaultFolder({ id: folder.id, name: folder.name })}
                      />
                    )}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : (
        !isLoading && (
          <List.EmptyView
            title="No folders found"
            description="Unable to load folders from Google Drive"
            icon={Icon.Folder}
          />
        )
      )}
    </List>
  );
}
