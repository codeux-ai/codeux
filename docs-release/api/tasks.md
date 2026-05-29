# Tasks API

The Tasks API allows you to manage tasks within a project programmatically.

## Endpoints

### List Tasks

Retrieve a list of tasks for a specific project. You can filter by sprint ID using query parameters.

**GET** `/api/projects/:projectId/tasks`

**Query Parameters**
- `sprintId` (string, optional): Filter tasks by a specific sprint.

**Response Example**
```json
[
  {
    "id": "tsk_123",
    "projectId": "prj_123",
    "sprintId": "spr_1",
    "taskKey": "TSK-1",
    "title": "Implement login",
    "promptMarkdown": "Create login page with email and password.",
    "description": "User login functionality.",
    "status": "pending",
    "priority": "high",
    "executorType": "jules",
    "agentPresetId": null,
    "sortOrder": 1,
    "dependsOnTaskIds": [],
    "isIndependent": false,
    "isMerged": false,
    "mergeIndicator": null,
    "sourceType": null,
    "sourcePath": null,
    "createdAt": "2023-10-02T09:00:00Z",
    "updatedAt": "2023-10-02T09:00:00Z"
  }
]
```

**Error Codes**
- `400 Bad Request`: Failed to list tasks.

### Create Task

Create a new task in a specific project.

**POST** `/api/projects/:projectId/tasks`

**Request Body Parameters**

| Field | Type | Required | Description |
|---|---|---|---|
| `sprintId` | string | Yes | The ID of the sprint the task belongs to. |
| `taskKey` | string | No | Optional key for the task. |
| `title` | string | Yes | The title of the task. |
| `promptMarkdown` | string | No | Detailed prompt or instructions. |
| `description` | string | No | Task description. |
| `status` | string | No | The initial status. |
| `priority` | string | No | Task priority (`low`, `medium`, `high`). |
| `executorType` | string | No | Executor assignment type (e.g., `jules`, `human`). |
| `agentPresetId` | string | No | Assigned agent ID. |
| `sortOrder` | integer | No | Sorting order number. |
| `dependsOnTaskIds` | array of strings | No | List of task IDs this task depends on. |
| `isIndependent` | boolean | No | Whether the task is independent. |
| `isMerged` | boolean | No | Whether the task has been merged. |
| `mergeIndicator` | string | No | Merge indicator. |
| `sourceType` | string | No | Type of source. |
| `sourcePath` | string | No | Source path location. |

**Request Example**
```json
{
  "sprintId": "spr_1",
  "title": "Update dashboard",
  "priority": "medium",
  "executorType": "jules"
}
```

**Response Example**
```json
{
  "id": "tsk_124",
  "projectId": "prj_123",
  "sprintId": "spr_1",
  "taskKey": "TSK-2",
  "title": "Update dashboard",
  "promptMarkdown": "",
  "description": "",
  "status": "pending",
  "priority": "medium",
  "executorType": "jules",
  "agentPresetId": null,
  "sortOrder": 2,
  "dependsOnTaskIds": [],
  "isIndependent": false,
  "isMerged": false,
  "mergeIndicator": null,
  "sourceType": null,
  "sourcePath": null,
  "createdAt": "2023-10-10T10:00:00Z",
  "updatedAt": "2023-10-10T10:00:00Z"
}
```

**Error Codes**
- `400 Bad Request`: Failed to create task.

### Update Task

Update an existing task. Note: We use `PATCH` for updates.

**PATCH** `/api/tasks/:taskId`

**Request Body Parameters**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | The title of the task. |
| `promptMarkdown` | string | No | Detailed prompt or instructions. |
| `description` | string | No | Task description. |
| `status` | string | No | The new status. |
| `priority` | string | No | Task priority (`low`, `medium`, `high`). |
| `executorType` | string | No | Executor assignment type (e.g., `jules`, `human`). |
| `agentPresetId` | string | No | Assigned agent ID. |
| `sortOrder` | integer | No | Sorting order number. |
| `dependsOnTaskIds` | array of strings | No | List of task IDs this task depends on. |
| `isIndependent` | boolean | No | Whether the task is independent. |
| `isMerged` | boolean | No | Whether the task has been merged. |
| `mergeIndicator` | string | No | Merge indicator. |
| `sourceType` | string | No | Type of source. |
| `sourcePath` | string | No | Source path location. |

**Request Example**
```json
{
  "status": "completed",
  "isMerged": true
}
```

**Response Example**
```json
{
  "id": "tsk_124",
  "projectId": "prj_123",
  "sprintId": "spr_1",
  "taskKey": "TSK-2",
  "title": "Update dashboard",
  "promptMarkdown": "",
  "description": "",
  "status": "completed",
  "priority": "medium",
  "executorType": "jules",
  "agentPresetId": null,
  "sortOrder": 2,
  "dependsOnTaskIds": [],
  "isIndependent": false,
  "isMerged": true,
  "mergeIndicator": null,
  "sourceType": null,
  "sourcePath": null,
  "createdAt": "2023-10-10T10:00:00Z",
  "updatedAt": "2023-10-10T12:00:00Z"
}
```

**Error Codes**
- `400 Bad Request`: Failed to update task.

### Delete Task

Delete a task. Note: We use `DELETE` for removal.

**DELETE** `/api/tasks/:taskId`

**Response Example**
```json
{
  "ok": true
}
```

**Error Codes**
- `400 Bad Request`: Failed to delete task.
