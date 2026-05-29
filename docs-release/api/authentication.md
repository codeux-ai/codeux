# Authentication

To use our API, you must authenticate all of your requests. We use Bearer tokens to verify your identity and ensure you have the correct permissions.

::: info
Your API tokens carry the same privileges as your user account. Keep them secure and never share them or commit them into version control.
:::

## Passing the Bearer Token

You must provide a valid API token in the `Authorization` HTTP header of every request, prefixed with the word `Bearer`.

**Header Format:**

```http
Authorization: Bearer <YOUR_API_TOKEN>
```

### Example Request

Here is how you pass the Bearer token using `curl`:

```bash
curl -X GET "https://api.example.com/v1/users/me" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"
```

## Failed Authentication Example

If you omit the `Authorization` header, provide an invalid token, or your token has expired, the API will respond with a `401 Unauthorized` status code.

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or missing Bearer token."
  }
}
```

::: warning
If your token is compromised, you must immediately revoke it via the Developer Dashboard and generate a new one.
:::
