# Fix Broken External Connections

## Before you start
This guide will help you resolve broken connections with external services like Jira, GitHub, and GitLab. By the end of this guide, you will be able to diagnose integration errors, re-authenticate expired sessions, and inspect webhook deliveries.

::: info
Ensure you have the necessary permissions in the external services (Jira, GitHub, GitLab) to generate new tokens or modify webhook settings before proceeding.
:::

## Steps

1. **Check for specific integration errors**
   Compare the error message you are seeing with the common integration errors in the table below to determine the appropriate fix.

   | Integration | Error | Solution |
   | --- | --- | --- |
   | GitHub | `Repository not found` | Check that the repository exists, is accessible to your account, and the token has the `repo` scope. |
   | Jira | `Unauthorized` | Your authentication token or OAuth session is invalid or expired. Follow the steps below to re-authenticate. |
   | GitLab | `404 Not Found` | Verify the project path and ensure your access token has the `api` scope. |

2. **Re-authenticate an expired OAuth session**
   If you encounter an `Unauthorized` error or suspect your session has expired, you must reconnect your account.
   * Navigate to the **Settings** page in the dashboard.
   * Select the **Integrations** tab.
   * Locate the problematic integration (e.g., Jira, GitHub, or GitLab).
   * Click the **Disconnect** button next to the integration.
   * Click **Connect** to start the OAuth flow and authorize the application again.

3. **View webhook delivery history to check payloads**
   If data is not synchronizing correctly between the systems, check the webhook delivery logs.
   * Go to your project's **Settings** in the external service (e.g., GitHub or GitLab repository settings, or Jira webhook settings).
   * Navigate to the **Webhooks** section.
   * Select the webhook configured for our service.
   * Switch to the **Recent Deliveries** or **History** tab.
   * Click on a specific failed delivery to view the HTTP response code, error message, and the exact payload that was sent.

## Expected result
You should see a successful connection status on the **Integrations** page, and actions triggered between the systems should reflect immediately without errors.
