# View and Export Audit Logs

## Overview
Compliance and security admins can track workspace activity via Audit Logs. This guide explains how to view tracked events, filter logs, and export them to CSV.

::: info
Audit Logs provide a historical record of significant actions within your workspace, helping you ensure compliance and monitor security.
:::

## Prerequisites
* You must have **Workspace Admin** or **Security Admin** permissions.

::: warning
**Log Retention Notice:** Log history retention is limited based on your billing plan. Older logs are permanently deleted once they exceed your plan's retention period. Please export important logs regularly.
:::

## Tracked Events
The Audit Log automatically records the following critical events:
* **Login**: Records successful and failed login attempts, including IP and timestamp.
* **Delete Project**: Logs when a project is deleted and by whom.
* **Permission Change**: Captures modifications to user roles and access levels.

## Steps

1. **Navigate to Audit Logs**
   From the main dashboard, go to **Settings** and select **Audit Logs** from the left-hand menu.

2. **Filter the Logs**
   Use the filter controls at the top of the table to narrow down the results:
   * **By User**: Select a specific user from the dropdown to see their activity.
   * **By Date**: Use the date picker to define a start and end date.
   * **By Event Type**: Check the boxes for the event types you want to view (e.g., Login, Delete Project).

3. **Export to CSV**
   Once you have filtered the logs to show the desired information, click the **Export CSV** button in the top right corner. The file will automatically download to your device.

## Expected Result
You should be able to view the filtered list of events in the dashboard and successfully download a CSV file containing the same data.
