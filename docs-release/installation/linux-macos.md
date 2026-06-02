# Linux and macOS Installation

This guide will walk you through the process of installing the desktop application on a Linux or macOS system using the provided installer packages.

## Before you start

* You must have root or `sudo` privileges to install software on your machine.
* For macOS, you must be running macOS 10.15 (Catalina) or later.
* For Linux, you must be running a modern Debian/Ubuntu-based or RedHat/Fedora-based distribution.
* Ensure you have downloaded the correct installer package (`.dmg` for macOS, `.deb` or `.rpm` for Linux) from the latest release.

## Steps

1. **Locate the Installer**
   Navigate to the folder where you downloaded the installation file.

2. **Run the Installer (macOS)**
   Double-click the **`.dmg`** file to mount it. Drag the application icon into the **Applications** folder shortcut provided in the window.

3. **Run the Installer (Linux - Debian/Ubuntu)**
   Open your terminal in the download folder and execute the installation command using your package manager.
   ```bash
   sudo dpkg -i codeux_*.deb
   sudo apt-get install -f
   ```

4. **Run the Installer (Linux - RedHat/Fedora)**
   Open your terminal in the download folder and execute the installation command.
   ```bash
   sudo rpm -i codeux_*.rpm
   ```

5. **Launch the Application**
   Open your system's application launcher (or Spotlight on macOS) and search for **Code UX**. Click the application icon to launch it.

## Expected Result

The Code UX desktop application should open, displaying the login or setup screen. You are now ready to begin using the application natively on your system.