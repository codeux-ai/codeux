# macOS Installation Guide

## Overview
Install the application on your macOS device. By the end of this guide, you will have successfully downloaded, installed, and opened the application, overcoming any macOS Gatekeeper restrictions if they appear.

::: info
This guide is specific to macOS. If you are using Windows or Linux, please refer to their respective installation guides.
:::

## Prerequisites
* A Mac computer running a modern version of macOS.
* Administrative privileges to install applications and adjust System Settings.

## Steps

1. **Download the Application**
   Navigate to the releases page and download the appropriate `.dmg` file for your Mac's architecture:
   * **Apple Silicon (M1/M2/M3/M4)**: Download the file ending in `arm64.dmg` or `-mac-arm64.dmg`.
   * **Intel**: Download the file ending in `x64.dmg` or `-mac-x64.dmg`.

   ::: tip
   To check your architecture, click the Apple logo () in the menu bar, select **About This Mac**, and check the **Chip** or **Processor** information.
   :::

2. **Mount the Disk Image**
   Locate the downloaded `.dmg` file using **Finder**. Double-click the `.dmg` file to mount it.

3. **Install the Application**
   In the window that appears, drag the application icon into the **Applications** folder shortcut provided next to it.

4. **Open the Application**
   Open **Finder**, navigate to the **Applications** folder, and double-click the application icon to launch it.

## Troubleshooting: macOS Gatekeeper

If you see an error message stating **"App cannot be opened because the developer cannot be verified"**, follow these steps to bypass Gatekeeper:

1. **Click "Cancel"** on the warning dialog.
2. Open **System Settings** (from the Apple menu ).
3. Navigate to **Privacy & Security**.
4. Scroll down to the **Security** section.
5. You should see a message saying the application was blocked from use because it is not from an identified developer. Click the **Open Anyway** button next to it.
6. When prompted, enter your Mac's administrator password or use Touch ID to confirm.
7. Click **Open** in the final confirmation dialog. The app will now launch and be saved as an exception in your security settings.

## Expected Result
You should see the application successfully launched and running on your Mac without any security prompts.
