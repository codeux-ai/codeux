# Linux Installation Guide

This guide provides step-by-step instructions on how to install the Electron client on Linux distributions.

## Prerequisites

- **Supported Distributions:** Ubuntu 20.04+, Debian 11+, Fedora 34+, and other major Linux distributions supporting `.deb` packages or AppImage.
- **Permissions:** You must have `sudo` privileges to install `.deb` packages.

## Installation Options

You can install the client using either the AppImage (portable) or the `.deb` package (installed system-wide).

### Option 1: AppImage (Recommended for Portability)

The AppImage format allows you to run the application without installing it system-wide.

1. **Download the AppImage:**
   Download the latest `.AppImage` file from the release page.

2. **Make the file executable:**
   Open your terminal and navigate to the directory where the file was downloaded (e.g., `~/Downloads`), then run:
   ```bash
   chmod +x Client-x86_64.AppImage
   ```

3. **Run the AppImage:**
   ```bash
   ./Client-x86_64.AppImage
   ```

### Option 2: Debian Package (.deb)

For Debian-based distributions like Ubuntu or Debian, you can install the `.deb` package system-wide.

1. **Download the `.deb` package:**
   Download the latest `.deb` file from the release page.

2. **Install the package:**
   Open your terminal, navigate to the download directory, and run the following command (adjust the filename as needed):
   ```bash
   sudo dpkg -i client_amd64.deb
   ```

3. **Resolve dependencies (if any):**
   If you encounter dependency errors during installation, run:
   ```bash
   sudo apt-get install -f
   ```

## Expected Result

Once installed or executed, the Electron client window should open, allowing you to sign in and use the application. If installed via `.deb`, the application should also be searchable in your desktop environment's application launcher.

## Troubleshooting

### Missing Application Icon

If you are using the AppImage and the application icon does not appear in your launcher or taskbar, you can integrate it manually by creating a `.desktop` file.

1. Create a `.desktop` file in your local applications directory:
   ```bash
   nano ~/.local/share/applications/client.desktop
   ```

2. Add the following content, adjusting the paths to where you saved the AppImage and the icon:
   ```ini
   [Desktop Entry]
   Name=Client
   Exec=/path/to/your/Client-x86_64.AppImage
   Icon=/path/to/your/icon.png
   Type=Application
   Categories=Utility;
   ```

3. Update the desktop database to apply the changes:
   ```bash
   update-desktop-database ~/.local/share/applications
   ```
