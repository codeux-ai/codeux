# SDKs & Examples

This section provides ready-to-use code examples for interacting with our API using popular languages and libraries.

## JavaScript (Fetch) - Create a Task

This example demonstrates how to create a new task using the native `fetch` API in JavaScript.

```javascript
// Replace <YOUR_API_TOKEN> with your actual API key
const API_KEY = "<YOUR_API_TOKEN>";

async function createTask() {
  try {
    const response = await fetch("https://api.example.com/v1/tasks", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "New Task",
        description: "This is a new task created via the API."
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Task created successfully:", data);
  } catch (error) {
    console.error("Error creating task:", error);
  }
}

createTask();
```

## Python (Requests) - List Projects

This example demonstrates how to list projects using the popular `requests` library in Python.

```python
import requests

# Replace <YOUR_API_TOKEN> with your actual API key
API_KEY = "<YOUR_API_TOKEN>"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def list_projects():
    try:
        response = requests.get(
            "https://api.example.com/v1/projects",
            headers=HEADERS
        )
        response.raise_for_status()

        projects = response.json()
        print("Projects retrieved successfully:", projects)
    except requests.exceptions.RequestException as e:
        print("Error listing projects:", e)

if __name__ == "__main__":
    list_projects()
```
