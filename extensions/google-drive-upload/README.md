# Google Drive Upload

Upload files and folders to Google Drive directly from Finder.

![Google Drive Upload](https://img.shields.io/badge/Raycast-Extension-FF6363?logo=raycast&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 📤 Upload files and folders from Finder selection
- 👥 Multiple Google account support
- 📁 Preserve folder structure during upload
- ⭐ Set default upload destination folder
- 🔄 Automatic token refresh

## Setup

The extension works out-of-the-box - no configuration needed!

1. Install the extension in Raycast
2. Run `Manage Google Drive Accounts` command
3. Click "Add Account" and follow the OAuth flow
4. Authorize the extension

That's it! You're ready to upload files.

### Optional: Use Your Own OAuth Client ID

If you want to use your own Google OAuth credentials:

1. Go to [Google Cloud Console - Credentials](https://console.developers.google.com/apis/credentials)
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. Choose application type: **"iOS"** (required for PKCE)
4. Enter Bundle ID: **`com.raycast`**
5. Click **"Create"**
6. Copy the Client ID
7. Open Raycast Settings → Extensions → Google Drive Upload
8. Paste your Client ID into the **"Custom OAuth Client ID"** field

**Note:** The iOS application type is required for PKCE (Proof Key for Code Exchange), which allows secure OAuth without a client secret.

## Usage

### Upload Files

1. Select files or folders in Finder
2. Run `Upload to Google Drive` command
3. Choose destination folder
4. Files upload with progress tracking

### Manage Accounts

- **Add Account**: Connect additional Google accounts
- **Set Default**: Choose your primary account
- **Remove Account**: Disconnect accounts

## Commands

- **Upload to Google Drive** - Upload selected Finder items
- **Manage Google Drive Accounts** - Manage connected accounts

## Privacy

- Secure OAuth 2.0 authentication
- Tokens stored locally in Raycast
- Only accesses files created by this extension
- All API calls go directly to Google

## Troubleshooting

### "Invalid client" error
- This usually means the OAuth app needs to be verified or you need to add your email as a test user
- Check that the redirect URI is exactly `https://raycast.com/redirect`

### "This app is blocked" warning
- Normal for personal OAuth apps in testing mode
- Click "Advanced" → "Go to [App Name] (unsafe)"
- Your app is safe - you created it!

### "No files selected"
- Make sure files/folders are selected in Finder
- Finder must be the active application

## Requirements

- macOS
- Raycast 1.50.0+
- Google account

## License

MIT
