# Resolving Sync Issues

## Overview
By the end of this guide, users will be able to resolve common synchronization discrepancies between their local application state and the server state.

::: info
Synchronization issues typically occur when working offline or switching between devices. Ensure you have an active internet connection before proceeding.
:::

## Prerequisites
* Active internet connection
* Familiarity with your specific client (Web app vs. Desktop app)

## Steps

### Manually force a sync (Desktop App)
To force a sync on the Desktop app:

1. **Open the Settings menu**
   Click the gear icon in the top right corner of the application.
2. **Navigate to Network**
   Select the Network tab from the sidebar.
3. **Trigger Force Sync**
   Click the **Force Sync** button.

### Resolve a 'Conflicting Edit' warning
If you encounter a 'Conflicting Edit' warning, follow these steps:

1. **Review changes**
   A dialog box will display both your local changes and the server's current state.
2. **Select resolution**
   Choose either **Keep Local** or **Keep Server** to resolve the conflict.
3. **Confirm**
   Click the **Apply** button to confirm your choice.

### Clear the local application cache
If persistent sync issues occur, you may need to clear your local cache.

::: tip
Clearing your cache will not delete any un-synced data. Your unsaved drafts are stored separately and will be preserved.
:::

#### For the Web App:
1. **Open Developer Tools**
   Press `F12` or `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac).
2. **Navigate to Application tab**
   Click the **Application** tab at the top of the developer tools.
3. **Clear Storage**
   Under the Storage section, select **Local Storage** and then clear the data for your current domain. Do not clear IndexedDB, as that is where unsaved drafts are stored.

#### For the Desktop App:
1. **Open Application Menu**
   Click the main application menu (e.g., File, Edit, View).
2. **Navigate to Help**
   Select **Help** > **Troubleshooting**.
3. **Clear Cache**
   Click the **Clear Local Cache** button. This action is safe and will not result in data loss for un-synced work.

## Expected Result
Your application should now be fully synced with the server state, and any warnings should be resolved. You can verify this by checking the sync indicator icon, which should show a green checkmark.
