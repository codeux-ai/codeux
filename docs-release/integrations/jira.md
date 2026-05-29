# Set up Jira Integration

## Overview
This guide provides step-by-step instructions for setting up the Jira integration to import and sync issues. By the end of this guide, you will have successfully connected your Jira workspace and configured the issue synchronization.

::: info
The Jira integration requires an active Jira Cloud or Server instance with API access enabled.
:::

## Prerequisites
* Jira Admin access to your organization's workspace.
* An active API token generated from your Jira account.

::: warning
API tokens provide full access to your account based on your permissions. Never share your API token in public channels, chat messages, or commit it to version control. Treat it as a highly sensitive password.
:::

## Steps

1. **Navigate to Integrations**
   Log into the application and navigate to **Settings > Integrations** from the main dashboard sidebar.

2. **Select Jira Integration**
   Locate the **Jira** option from the list of available integrations and click the **Connect** button.

3. **Enter Credentials**
   In the configuration modal, provide your Jira instance URL (e.g., `https://your-domain.atlassian.net`) and the API Token you generated.

4. **Map Fields**
   Review and map the necessary fields (such as Status, Priority, and Assignee) between Jira and the application, then save your configuration.

::: tip
You can always revisit the field mapping settings later if you add custom fields to your Jira projects.
:::

## Sync Behavior
The Jira integration supports robust synchronization for issues. Depending on your configuration, you can choose between one-way or two-way sync:
* **One-way sync:** Issues are imported from Jira into the application, but changes made locally do not push back to Jira.
* **Two-way sync:** Updates (such as status changes and comments) are mirrored seamlessly between Jira and the application.

## Troubleshooting

| Issue | Potential Cause | Solution |
|-------|-----------------|----------|
| **Authentication Failed** | Incorrect URL or invalid API token. | Verify that the Jira URL is correct and ensure the API token has not expired or been revoked. Regenerate the token if necessary. |
| **Sync Timeout** | Network latency or too many issues syncing at once. | Check your network connection. If importing a large project, try limiting the initial sync scope using JQL filters. |

## Expected Result
You should see a "Connected" badge next to the Jira integration in the Settings page. You can verify the connection by checking if recent Jira issues have started populating in your project dashboard.
