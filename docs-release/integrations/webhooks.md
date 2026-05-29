# Webhook Setup

## Overview
Webhooks allow your application to receive real-time HTTP notifications when certain events occur within your workspace. By the end of this guide, you will have configured a webhook, tested an event, and learned how to verify incoming requests.

::: info
You need workspace administrator privileges to configure webhooks.
:::

## Prerequisites
* A running server endpoint capable of receiving HTTPS POST requests.
* Administrator access to the dashboard.

## Steps

1. **Navigate to Webhook Settings**
   Go to **Settings** > **Integrations** > **Webhooks** and click **Add Webhook**.

2. **Configure the Webhook URL**
   Enter your server endpoint in the **Payload URL** field. This must be an HTTPS URL.

3. **Select Event Triggers**
   Choose the specific events you want to subscribe to (e.g., `task.created`, `task.updated`).

4. **Save and Test**
   Click **Save**. You can then click **Test Webhook** to send a sample payload to your URL.

## Example Payload

When an event triggers, a POST request is sent to your webhook URL with a JSON payload similar to this:

```json
{
  "event": "task.created",
  "timestamp": "2023-10-27T10:00:00Z",
  "workspace_id": "ws_12345",
  "data": {
    "task_id": "task_67890",
    "title": "Implement webhooks",
    "status": "open"
  }
}
```

## Security and Reliability

### Verifying Webhook Signatures
To ensure the request came from us, we include an `X-Webhook-Signature` header in every payload. This signature is an HMAC hex digest generated using your webhook secret and the raw request body.

### Retry Policy
If your server responds with a non-2xx status code or times out, we will retry delivering the webhook up to 3 times with exponential backoff (e.g., after 5 minutes, 30 minutes, and 2 hours).

## Expected Result
You should receive the test payload at your server endpoint and the dashboard should display a "Webhook test successful" message.