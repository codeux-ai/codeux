# GitHub Integration Setup

Connect your GitHub repositories to sync commits, branches, and pull requests directly to your project tasks.

## Prerequisites

- Administrator access to the project workspace.
- For GitHub Cloud: The ability to install a GitHub App on the target organization or repository.
- For GitHub Enterprise: Permission to create a new OAuth app or GitHub App in your enterprise environment.

## 1. Install or Configure the GitHub App

The setup process differs slightly depending on whether you are using GitHub Cloud or GitHub Enterprise.

### For GitHub Cloud

1. Navigate to **Settings > Integrations** in the project workspace.
2. Click **Connect** next to the GitHub integration.
3. You will be redirected to GitHub to authorize the official GitHub App.
4. Choose whether to install the app on all repositories or select specific repositories.
5. Click **Install & Authorize**.

### For GitHub Enterprise

1. Navigate to **Settings > Integrations** in the project workspace.
2. Select **Add Custom Integration** and choose **GitHub Enterprise**.
3. In your GitHub Enterprise account, go to **Settings > Developer settings > GitHub Apps** and click **New GitHub App**.
4. Configure the app with the webhook URL and permissions specified in the project workspace setup wizard.
5. Generate a private key and copy the App ID, Client ID, and Client Secret.
6. Enter these details back into the project workspace and click **Connect**.

## 2. Link a Repository to a Project

Once the integration is connected, you must link specific repositories to your projects.

1. Go to your project's **Settings > Linked Repositories**.
2. Click **Link Repository**.
3. Select your GitHub organization and choose the repository from the dropdown list.
4. Click **Save Link**.

## 3. Link Commits and Pull Requests to Tasks

You can automatically link your GitHub activity to specific tasks by including the task ID in your branch names, commit messages, or pull request titles.

Use the following syntax in your commit message or PR description:

`Fixes PROJ-123`
`Resolves PROJ-123`
`Closes PROJ-123`

You can also just reference the task without closing it:

`Ref PROJ-123`

## Expected Result

- In your project's **Settings > Integrations**, GitHub will show as "Connected".
- Commits containing the task syntax (e.g., `Fixes PROJ-123`) will appear in the activity feed of task `PROJ-123`.
