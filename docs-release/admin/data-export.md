# Data Export

## Before you start
* You must have **Owner** permissions for the workspace to trigger a full data export.

::: info
Data exports do not include raw audit logs unless explicitly specified in the export configuration.
:::

## Steps

1. **Navigate to Workspace Settings**
   Log in to Code UX and click on **Workspace Settings** in the main navigation menu.

2. **Access Data Portability**
   Select the **Data Portability** tab to view your export options.

3. **Trigger the Export**
   Click the **Export Full Workspace** button.

4. **Wait for Processing**
   Large exports may take several hours to process depending on the amount of data and attachments in your workspace.

5. **Download the Archive**
   Once the export finishes processing, you will receive an email link containing the secure download URL. This is the explicit delivery method for your data export. Click the link in the email to download your archive.

## Expected result
You should receive a `.zip` archive downloaded to your local machine. Upon extracting the archive, you will find the following structure:
* `projects/` and `tasks/` folders containing your workspace data.
* `CSV` files detailing structured data like task histories, user lists, and project metadata.
* `attachments/` folder containing all uploaded files and media associated with your tasks and projects.
