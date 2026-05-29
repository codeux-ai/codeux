# Web Browser Installation

You can use the web-hosted version of the app directly in your browser without downloading the desktop application. This guide explains the supported browsers, required settings, and differences compared to the native desktop apps.

## Prerequisites

- A supported web browser: Google Chrome (v90+), Mozilla Firefox (v88+), Apple Safari (v14+), or Microsoft Edge (v90+).
- An active internet connection.

## Configuration Steps

### 1. Required Browser Settings

To ensure the web app functions correctly, you must enable certain browser settings:

- **Cookies**: Must be enabled for session management and authentication.
- **Local Storage**: Must be enabled to save user preferences and temporary application state.

::: warning
If your browser is set to "Strict" tracking prevention or blocks third-party cookies, some integrations may fail to load. Please add an exception for the web app domain.
:::

### 2. Installing as a PWA (Progressive Web App)

For a more native-like experience, you can install the web app as a PWA. This allows you to launch the app from your home screen or dock and provides a dedicated window without browser tabs.

**On Desktop (Chrome/Edge):**
1. Open the web app in your browser.
2. Click the installation icon (often a screen with a down arrow) on the right side of the URL bar.
3. Click "Install" in the prompt.

**On Mobile (Safari/iOS):**
1. Open the web app in Safari.
2. Tap the "Share" icon at the bottom of the screen.
3. Scroll down and tap "Add to Home Screen".
4. Tap "Add" in the top right corner.

## Feature Differences

The web-hosted version provides the core functionality of the application, but some features are restricted due to browser security models. Be aware of the following feature parity gaps:

| Feature | Desktop App | Web Browser App |
| :--- | :--- | :--- |
| **Core Application** | Full support | Full support |
| **Native Notifications** | Yes | Yes (Requires explicit browser permission) |
| **Local File Access** | Unrestricted access | Requires manual file uploads (Sandboxed) |
| **Offline Mode** | Fully supported | Limited (PWA caching only) |
| **Background Processing** | Yes | Suspended when tab is inactive |

## Expected Result

You will have successfully configured your browser to use the web-hosted app, optionally installed it as a PWA, and understand the feature differences compared to the desktop version.
