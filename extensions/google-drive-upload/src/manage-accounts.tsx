import { List, ActionPanel, Action, Icon, confirmAlert, Alert, showToast, Toast, Color } from "@raycast/api";
import React, { useEffect, useState } from "react";
import {
  getAccounts,
  createOAuthClient,
  authorize,
  addAccount,
  removeAccount,
  setDefaultAccount,
  getDefaultAccount,
} from "./lib/auth";
import { GoogleAccount } from "./lib/types";

export default function ManageAccounts() {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  async function loadAccounts() {
    setIsLoading(true);
    try {
      const accts = await getAccounts();
      setAccounts(accts);

      const defaultAcct = await getDefaultAccount();
      setDefaultAccountId(defaultAcct?.id);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load accounts",
        message: (error as Error).message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

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
      const account = await addAccount(token, providerId);

      toast.style = Toast.Style.Success;
      toast.title = "Google account connected";
      toast.message = account.email;

      await loadAccounts();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Authentication failed";
      toast.message = (error as Error).message;
    }
  }

  async function handleRemoveAccount(account: GoogleAccount) {
    const confirmed = await confirmAlert({
      title: "Remove Account",
      message: `Are you sure you want to remove ${account.email}?`,
      primaryAction: {
        title: "Remove",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "Removing account...",
      });

      try {
        await removeAccount(account.id);

        toast.style = Toast.Style.Success;
        toast.title = "Account removed";
        toast.message = account.email;

        await loadAccounts();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to remove account";
        toast.message = (error as Error).message;
      }
    }
  }

  async function handleSetDefault(account: GoogleAccount) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Setting default account...",
    });

    try {
      await setDefaultAccount(account.id);

      // Update state immediately
      setDefaultAccountId(account.id);

      toast.style = Toast.Style.Success;
      toast.title = "Default account set";
      toast.message = account.email;

      await loadAccounts();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to set default";
      toast.message = (error as Error).message;
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search Google accounts...">
      {accounts.length === 0 && !isLoading ? (
        <List.EmptyView
          title="No Google accounts connected"
          description="Add a Google account to start uploading files to Google Drive"
          icon={{ source: Icon.Cloud, tintColor: Color.Blue }}
          actions={
            <ActionPanel>
              <Action
                title="Add Google Account"
                icon={{ source: Icon.Plus, tintColor: Color.Blue }}
                onAction={handleAddAccount}
              />
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title="Google Drive Accounts">
          {accounts
            .sort((a, b) => {
              // Default account always at top
              if (a.id === defaultAccountId) return -1;
              if (b.id === defaultAccountId) return 1;
              // Otherwise maintain alphabetical order by name/email
              const aName = (a.name || a.email).toLowerCase();
              const bName = (b.name || b.email).toLowerCase();
              return aName.localeCompare(bName);
            })
            .map((account) => {
              const isDefault = account.id === defaultAccountId;

              return (
                <List.Item
                  key={account.id}
                  title={account.name || account.email}
                  subtitle={account.email}
                  icon={{
                    source: Icon.Cloud,
                    tintColor: isDefault ? Color.Blue : Color.SecondaryText,
                  }}
                  accessories={
                    isDefault
                      ? [
                          {
                            tag: {
                              value: "Default",
                              color: Color.Blue,
                            },
                          },
                        ]
                      : undefined
                  }
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section>
                        {!isDefault && (
                          <Action title="Set as Default" icon={Icon.Star} onAction={() => handleSetDefault(account)} />
                        )}
                        <Action
                          title="Add Google Account"
                          icon={{ source: Icon.Plus, tintColor: Color.Blue }}
                          shortcut={{ modifiers: ["cmd"], key: "n" }}
                          onAction={handleAddAccount}
                        />
                      </ActionPanel.Section>
                      <ActionPanel.Section>
                        <Action
                          title="Remove Account"
                          icon={Icon.Trash}
                          style={Action.Style.Destructive}
                          shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
                          onAction={() => handleRemoveAccount(account)}
                        />
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              );
            })}
        </List.Section>
      )}
    </List>
  );
}
