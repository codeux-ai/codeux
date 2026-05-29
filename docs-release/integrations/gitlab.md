# GitLab Integration

## Before you start
You will need a GitLab account with permissions to generate Personal Access Tokens (PAT). Make sure you have administrator access to the GitLab repository you wish to integrate with the application.

## Steps

1. **Log in** to your GitLab account.
2. Navigate to your **User Settings** by clicking your avatar in the top right corner and selecting **Edit profile**.
3. In the left sidebar, click on **Access Tokens**.
4. Click on **Add new token**.
5. Enter a **Token name** (e.g., "Sprint OS Integration").
6. Set an optional **Expiration date**.
7. Under **Select scopes**, explicitly check the following permissions:
   - `api`
   - `read_repository`
8. Click the **Create personal access token** button.
9. **Copy** the generated token immediately, as it will not be shown again.
10. Open the Sprint OS app and navigate to **Settings**.
11. Click on **Integrations** in the left sidebar.
12. Find the GitLab integration and click **Configure**.
13. **Paste** your generated token into the **Personal Access Token** field.
14. Enter your **GitLab Server URL** (e.g., `https://gitlab.com` or your self-hosted instance URL).
15. Click **Save Settings**.

## Limitations
- **Webhook Latency**: There may be occasional latency in webhook deliveries from GitLab to our application. This can delay the synchronization of issues and pull requests by up to a few minutes.
- **Large Monorepos**: Parsing very large repositories may take longer during initial setup.

## Expected result
After completing these steps, the GitLab integration status should show as **Connected** with a green dot in the **Integrations** dashboard. You should now be able to select GitLab repositories for your connected agents to interact with.
