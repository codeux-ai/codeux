# Error Messages

This page provides a reference for common error messages you might encounter, what they mean, and how to fix them.

| Error Code | Meaning | Fix |
| :--- | :--- | :--- |
| `ERR_CONNECTION_REFUSED` | The target machine actively refused the connection. This usually means the service is not running on the expected port or a firewall is blocking access. | Ensure the target service is started. Verify the port number. Check firewall and proxy settings. |
| `ERR_NAME_NOT_RESOLVED` | The hostname could not be resolved to an IP address. | Check your internet connection. Verify the hostname is spelled correctly and DNS is configured properly. |
| `ERR_NETWORK_CHANGED` | The network connection was interrupted or changed during the request. | Retry the request. Ensure stable network connectivity. |
| `400 Bad Request` | The server could not understand the request due to invalid syntax or parameters. | Verify the request payload, headers, and URL parameters match the expected format. |
| `401 Unauthorized` | Authentication is required and has failed or has not yet been provided. | Check that your API key or authentication token is valid, unexpired, and properly included in the request headers. |
| `403 Forbidden` | The server understood the request but refuses to authorize it. The client's identity is known, but they lack necessary permissions. | Verify your account has the correct roles or permissions to access the resource. |
| `404 Not Found` | The server cannot find the requested resource. | Check the URL for typos. Ensure the resource has not been deleted or moved. |
| `409 Conflict` | The request could not be completed due to a conflict with the current state of the resource. | This often happens during concurrent updates. Fetch the latest state of the resource and try the operation again. |
| `429 Too Many Requests` | The user has sent too many requests in a given amount of time (rate limiting). | Implement exponential backoff and retry logic. Check your rate limits and upgrade your plan if necessary. |
| `500 Internal Server Error` | The server encountered an unexpected condition that prevented it from fulfilling the request. | This is an error on the server side. Check the server logs, or try again later. Contact support if the issue persists. |
| `502 Bad Gateway` | The server, while acting as a gateway or proxy, received an invalid response from the upstream server. | Wait and retry. This usually indicates a temporary issue with upstream services or load balancers. |
| `503 Service Unavailable` | The server is not ready to handle the request, usually because it is overloaded or down for maintenance. | Try again later. Check the service status page for ongoing maintenance or incidents. |
| `504 Gateway Timeout` | The server, while acting as a gateway or proxy, did not get a response in time from the upstream server. | The upstream service might be slow or unresponsive. Try again later or optimize the request. |
